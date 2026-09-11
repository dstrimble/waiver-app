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
 * The waiver-signed call for one waiver. Each waiver here covers one person.
 * A parent's name on it means a parent signed for a child: the parent is the
 * signer and the child the one who trains. Otherwise they signed for
 * themselves and are both.
 */
export function buildWaiverSignedPayload(waiver) {
  const name = String(waiver.name || "").trim();
  const parentName = String(waiver.parent_name || "").trim();
  return {
    signer: {
      name: parentName || name,
      email: String(waiver.email || "").trim().toLowerCase(),
    },
    participants: [{ name }],
    waiver_id: `waiver_${waiver.id}`,
    signed_at: new Date(waiver.submitted_at).toISOString(),
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

/** Send one waiver and record how it went. Throws on failure, after recording it. */
async function syncRow(row, config) {
  try {
    await post(buildWaiverSignedPayload(row), config);
  } catch (err) {
    const message = err?.message || String(err);
    try {
      await pool.query(
        `UPDATE waiver_submissions
            SET mattracker_error = $2, mattracker_attempts = mattracker_attempts + 1
          WHERE id = $1`,
        [row.id, message.slice(0, 1000)]
      );
    } catch (dbErr) {
      console.error(`Could not record the MatTracker failure for waiver ${row.id}:`, dbErr);
    }
    throw new Error(message);
  }

  await pool.query(
    `UPDATE waiver_submissions
        SET mattracker_synced_at = now(), mattracker_error = NULL,
            mattracker_attempts = mattracker_attempts + 1
      WHERE id = $1`,
    [row.id]
  );
}

/** Right after a submission is stored. Never throws. */
export async function syncNewWaiver(waiver) {
  const config = getMatTrackerConfig();
  if (!config.enabled || !String(waiver.email || "").trim()) return;
  try {
    await syncRow(waiver, config);
  } catch (err) {
    console.error(`MatTracker setup for waiver ${waiver.id} failed; it will be retried: ${err.message}`);
  }
}

const DUE_SQL = `
  SELECT id, name, parent_name, email, submitted_at
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
  for (const row of rows) {
    try {
      await syncRow(row, config);
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
    "SELECT id, name, parent_name, email, submitted_at, archived_at FROM waiver_submissions WHERE id = $1",
    [id]
  );
  if (!rows.length) return { status: "not-found" };
  if (rows[0].archived_at) return { status: "archived" };
  if (!String(rows[0].email || "").trim()) return { status: "no-email" };

  await syncRow(rows[0], config);
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
