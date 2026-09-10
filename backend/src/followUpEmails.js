import { pool } from "./db.js";
import { isMailerConfigured, sendMail } from "./mailer.js";
import { getSiteConfig } from "./siteConfig.js";
import { buildFollowUpEmail } from "./waiverEmails.js";

function envFlag(name, fallback) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * Waivers signed before this feature shipped are excluded by the
 * `followup_eligible` column rather than by anything here; see db.js.
 *
 * `graceDays` covers the other direction: a waiver stops being eligible a
 * short while after it comes due, so a batch that went unsent while the
 * service was down is passed over instead of arriving weeks late.
 */
export function getFollowUpConfig() {
  return {
    enabled: envFlag("FOLLOWUP_ENABLED", true),
    delayDays: envNumber("FOLLOWUP_DELAY_DAYS", 7),
    graceDays: envNumber("FOLLOWUP_GRACE_DAYS", 3),
    pollMinutes: envNumber("FOLLOWUP_POLL_MINUTES", 60),
    batchSize: envNumber("FOLLOWUP_BATCH_SIZE", 50),
  };
}

// Claim and send are separate so two backends (or an overlapping sweep) can
// never both pick up the same waiver: the UPDATE stamps the row inside the
// database, and SKIP LOCKED lets a second sweep move on to the next one.
const CLAIM_DUE_SQL = `
  UPDATE waiver_submissions AS w
     SET followup_sent_at = now()
    FROM (
      SELECT id
        FROM waiver_submissions
       WHERE followup_sent_at IS NULL
         AND followup_eligible
         AND archived_at IS NULL
         AND email IS NOT NULL
         AND submitted_at <= now() - make_interval(days => $1::int)
         AND submitted_at >  now() - make_interval(days => $2::int)
       ORDER BY submitted_at
       LIMIT $3
         FOR UPDATE SKIP LOCKED
    ) AS due
   WHERE w.id = due.id
  RETURNING w.id, w.name, w.email`;

async function releaseClaim(id, error) {
  try {
    await pool.query(
      `UPDATE waiver_submissions
          SET followup_sent_at = NULL, followup_error = $2
        WHERE id = $1`,
      [id, String(error).slice(0, 1000)]
    );
  } catch (err) {
    console.error(`Could not record follow-up failure for waiver ${id}:`, err);
  }
}

async function confirmClaim(id) {
  try {
    await pool.query(
      "UPDATE waiver_submissions SET followup_error = NULL WHERE id = $1",
      [id]
    );
  } catch (err) {
    console.error(`Could not clear follow-up error for waiver ${id}:`, err);
  }
}

/**
 * Send the one-week follow-up to everyone who has come due since the last run.
 *
 * A failed send releases that waiver's claim so the next sweep retries it, and
 * one bad address never stops the rest of the batch. Rejects only if the
 * database itself is unreachable, which the caller logs and shrugs off.
 *
 * @returns {Promise<{sent: number, failed: number, skipped?: boolean}>}
 */
export async function sendDueFollowUps() {
  const settings = getFollowUpConfig();
  if (!settings.enabled) return { sent: 0, failed: 0, skipped: true };

  if (!isMailerConfigured()) {
    console.warn("SMTP is not configured; follow-up emails were not sent.");
    return { sent: 0, failed: 0, skipped: true };
  }

  const config = getSiteConfig();
  const { rows } = await pool.query(CLAIM_DUE_SQL, [
    settings.delayDays,
    settings.delayDays + settings.graceDays,
    settings.batchSize,
  ]);

  let sent = 0;
  let failed = 0;

  // One at a time: the SMTP transport pools only two connections, and a
  // follow-up batch is never in a hurry.
  for (const row of rows) {
    try {
      await deliverClaimed(row, config);
      sent += 1;
    } catch (err) {
      console.error(`Follow-up email for waiver ${row.id} failed: ${err.message}`);
      failed += 1;
    }
  }

  return { sent, failed };
}

/**
 * Send to a row whose claim is already held, then settle the claim either way.
 *
 * The caller must have stamped `followup_sent_at` first - that stamp is the
 * claim, and this releases it again if the send fails.
 */
async function deliverClaimed(row, config) {
  try {
    await sendMail({
      to: row.email,
      replyTo: config.replyTo || config.notifyEmail || undefined,
      ...buildFollowUpEmail({ id: row.id, name: row.name, email: row.email }, config),
    });
    await confirmClaim(row.id);
  } catch (err) {
    const message = err?.message || String(err);
    await releaseClaim(row.id, message);
    throw new Error(message);
  }
}

/**
 * Send the follow-up to one waiver right now, at an admin's request.
 *
 * Deliberately ignores the delay, the grace window and `followup_eligible` -
 * this is a person choosing to send it. It still goes through the same claim,
 * so the automatic sweep will not send a second copy afterwards.
 *
 * @returns {Promise<{status: "sent"|"already-sent"|"not-found"|"no-email"|"archived"|"no-smtp", email?: string}>}
 */
export async function sendFollowUpNow(id) {
  if (!isMailerConfigured()) return { status: "no-smtp" };

  const existing = await pool.query(
    "SELECT id, email, followup_sent_at, archived_at FROM waiver_submissions WHERE id = $1",
    [id]
  );
  if (!existing.rows.length) return { status: "not-found" };
  if (existing.rows[0].archived_at) return { status: "archived" };
  if (!existing.rows[0].email) return { status: "no-email" };

  // Claim conditionally, so a manual send racing the sweep cannot double up.
  const claimed = await pool.query(
    `UPDATE waiver_submissions
        SET followup_sent_at = now()
      WHERE id = $1 AND followup_sent_at IS NULL AND archived_at IS NULL
      RETURNING id, name, email`,
    [id]
  );
  if (!claimed.rows.length) return { status: "already-sent" };

  const row = claimed.rows[0];
  await deliverClaimed(row, getSiteConfig());
  return { status: "sent", email: row.email };
}

let pollTimer = null;
let startupTimer = null;
let inFlight = false;

async function sweep() {
  // Skip rather than queue up: a slow batch should not stack sweeps behind it.
  if (inFlight) return;
  inFlight = true;
  try {
    const { sent, failed } = await sendDueFollowUps();
    if (sent || failed) {
      console.log(`Follow-up emails: ${sent} sent, ${failed} failed.`);
    }
  } catch (err) {
    console.error("Follow-up sweep failed:", err);
  } finally {
    inFlight = false;
  }
}

/** Run the sweep on an interval for as long as the server is up. */
export function startFollowUpScheduler() {
  const settings = getFollowUpConfig();
  if (!settings.enabled) {
    console.log("Follow-up emails are disabled (FOLLOWUP_ENABLED=false).");
    return false;
  }

  stopFollowUpScheduler();

  // A short first sweep after boot, so a restart does not push the next batch
  // out by a whole interval.
  startupTimer = setTimeout(sweep, 30_000);
  pollTimer = setInterval(sweep, settings.pollMinutes * 60_000);
  startupTimer.unref?.();
  pollTimer.unref?.();

  console.log(
    `Follow-up emails run every ${settings.pollMinutes} min for waivers ` +
      `${settings.delayDays} days old.`
  );
  return true;
}

export function stopFollowUpScheduler() {
  if (startupTimer) clearTimeout(startupTimer);
  if (pollTimer) clearInterval(pollTimer);
  startupTimer = null;
  pollTimer = null;
}
