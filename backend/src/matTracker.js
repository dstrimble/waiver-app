import { pool } from "./db.js";

// Sets up MatTracker (spartracker) accounts for the people each waiver covers,
// so a member's account is waiting for them the first time they sign in with
// Google. MatTracker keys the call on our waiver id, so sending the same
// waiver twice - a retry, or an admin pressing the button - changes nothing.
//
// The call happens after the waiver is stored and never fails a submission.
// Its outcome is written to the row, and a sweep retries failures for about
// half a day before giving up; the admin page can send one again by hand.

const MAX_ATTEMPTS = 24;
const TIMEOUT_MS = 15_000;
// The immediate send gets a head start before the sweep will touch a waiver.
const SWEEP_AFTER = "2 minutes";

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function getMatTrackerConfig() {
  const url = String(process.env.SPARTRACKER_WAIVER_URL || "").trim();
  const token = String(process.env.SPARTRACKER_WAIVER_TOKEN || "").trim();
  return {
    url,
    token,
    enabled: Boolean(url && token),
    pollMinutes: envNumber("SPARTRACKER_RETRY_MINUTES", 30),
    batchSize: 25,
  };
}

/**
 * The waiver-signed call for one submission: the rows of a family signed
 * together, or a single row. A row with a parent's name was signed for by
 * that parent; a row without one is the signer, who trains too.
 */
export function buildWaiverSignedPayload(rowsOrRow) {
  const rows = Array.isArray(rowsOrRow) ? rowsOrRow : [rowsOrRow];
  const first = rows[0];
  const self = rows.find((row) => !String(row.parent_name || "").trim());
  return {
    signer: {
      name: String(self ? self.name : first.parent_name || "").trim(),
      email: String(first.email || "").trim().toLowerCase(),
    },
    participants: rows.map((row) => ({ name: String(row.name || "").trim() })),
    // Older waivers have no submission id; theirs is the row's own.
    waiver_id: `waiver_${first.submission_id || first.id}`,
    signed_at: new Date(first.submitted_at).toISOString(),
  };
}

async function post(payload, config) {
  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).trim().slice(0, 300);
    } catch {
      // the status is enough
    }
    throw new Error(`MatTracker returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
}

/** Send one submission's rows and record how it went on each. Throws on failure, after recording it. */
async function syncRows(rows, config) {
  const ids = rows.map((row) => row.id);
  try {
    await post(buildWaiverSignedPayload(rows), config);
  } catch (err) {
    const message = err?.message || String(err);
    try {
      await pool.query(
        `UPDATE waiver_submissions
            SET mattracker_error = $2, mattracker_attempts = mattracker_attempts + 1
          WHERE id = ANY($1)`,
        [ids, message.slice(0, 1000)]
      );
    } catch (dbErr) {
      console.error(`Could not record the MatTracker failure for waiver ${ids.join(", ")}:`, dbErr);
    }
    throw new Error(message);
  }

  await pool.query(
    `UPDATE waiver_submissions
        SET mattracker_synced_at = now(), mattracker_error = NULL,
            mattracker_attempts = mattracker_attempts + 1
      WHERE id = ANY($1)`,
    [ids]
  );
}

const ROW_COLUMNS = "id, name, parent_name, email, submitted_at, submission_id";

// A retry or a manual send may start from one row of a family; MatTracker
// should still hear about the whole family, minus anyone archived since.
async function withFamilies(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.submission_id || `row:${row.id}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const submissionIds = [...groups.keys()].filter((key) => !key.startsWith("row:"));
  if (submissionIds.length) {
    const { rows: family } = await pool.query(
      `SELECT ${ROW_COLUMNS} FROM waiver_submissions
        WHERE submission_id = ANY($1::uuid[]) AND archived_at IS NULL
        ORDER BY id`,
      [submissionIds]
    );
    for (const key of submissionIds) {
      const members = family.filter((row) => row.submission_id === key);
      if (members.length) groups.set(key, members);
    }
  }
  return [...groups.values()];
}

/** Right after a submission is stored, with every row it was stored under. Never throws. */
export async function syncNewWaiver(rowsOrRow) {
  const rows = Array.isArray(rowsOrRow) ? rowsOrRow : [rowsOrRow];
  const config = getMatTrackerConfig();
  if (!config.enabled || !rows.length || !String(rows[0].email || "").trim()) return;
  try {
    await syncRows(rows, config);
  } catch (err) {
    const ids = rows.map((row) => row.id).join(", ");
    console.error(`MatTracker setup for waiver ${ids} failed; it will be retried: ${err.message}`);
  }
}

const DUE_SQL = `
  SELECT ${ROW_COLUMNS}
    FROM waiver_submissions
   WHERE mattracker_synced_at IS NULL
     AND mattracker_eligible
     AND archived_at IS NULL
     AND btrim(COALESCE(email, '')) <> ''
     AND mattracker_attempts < $1
     AND submitted_at <= now() - interval '${SWEEP_AFTER}'
   ORDER BY submitted_at
   LIMIT $2`;

/**
 * Retry every waiver that has not reached MatTracker yet, including any signed
 * while the token was missing.
 *
 * @returns {Promise<{sent: number, failed: number, skipped?: boolean}>}
 */
export async function syncPendingWaivers() {
  const config = getMatTrackerConfig();
  if (!config.enabled) return { sent: 0, failed: 0, skipped: true };

  const { rows } = await pool.query(DUE_SQL, [MAX_ATTEMPTS, config.batchSize]);
  let sent = 0;
  let failed = 0;
  for (const family of await withFamilies(rows)) {
    try {
      await syncRows(family, config);
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, failed };
}

/**
 * Send one waiver now, at an admin's request - even one already sent, since
 * MatTracker treats a repeat as a no-op, and regardless of the retry limit.
 *
 * @returns {Promise<{status: "sent"|"not-found"|"archived"|"no-email"|"disabled"}>}
 */
export async function syncWaiverNow(id) {
  const config = getMatTrackerConfig();
  if (!config.enabled) return { status: "disabled" };

  const { rows } = await pool.query(
    `SELECT ${ROW_COLUMNS}, archived_at FROM waiver_submissions WHERE id = $1`,
    [id]
  );
  if (!rows.length) return { status: "not-found" };
  if (rows[0].archived_at) return { status: "archived" };
  if (!String(rows[0].email || "").trim()) return { status: "no-email" };

  const [family] = await withFamilies([rows[0]]);
  await syncRows(family, config);
  return { status: "sent" };
}

let pollTimer = null;
let startupTimer = null;
let inFlight = false;

async function sweep() {
  if (inFlight) return;
  inFlight = true;
  try {
    const { sent, failed } = await syncPendingWaivers();
    if (sent || failed) console.log(`MatTracker sync: ${sent} sent, ${failed} failed.`);
  } catch (err) {
    console.error("MatTracker sweep failed:", err);
  } finally {
    inFlight = false;
  }
}

/** Retry on an interval for as long as the server is up. */
export function startMatTrackerScheduler() {
  const config = getMatTrackerConfig();
  if (!config.enabled) {
    console.log("MatTracker sync is off (SPARTRACKER_WAIVER_URL or SPARTRACKER_WAIVER_TOKEN is unset).");
    return false;
  }

  stopMatTrackerScheduler();
  startupTimer = setTimeout(sweep, 45_000);
  pollTimer = setInterval(sweep, config.pollMinutes * 60_000);
  startupTimer.unref?.();
  pollTimer.unref?.();
  console.log(`MatTracker sync is on; retries run every ${config.pollMinutes} min.`);
  return true;
}

export function stopMatTrackerScheduler() {
  if (startupTimer) clearTimeout(startupTimer);
  if (pollTimer) clearInterval(pollTimer);
  startupTimer = null;
  pollTimer = null;
}
