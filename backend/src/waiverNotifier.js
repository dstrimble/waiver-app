import { pool } from "./db.js";
import { isMailerConfigured, sendMail } from "./mailer.js";
import { getSiteConfig } from "./siteConfig.js";
import { buildGymEmail, buildMemberEmail } from "./waiverEmails.js";
import { renderWaiverPdf, waiverPdfFilename } from "./waiverPdf.js";

// One email pair covers everyone on a submission, so its outcome is written to
// every row the submission was stored under.
async function recordOutcome(submission, error) {
  const ids = (Array.isArray(submission.ids) ? submission.ids : [submission.id]).filter(Boolean);
  if (!ids.length) return;
  try {
    await pool.query(
      `UPDATE waiver_submissions
       SET notification_sent_at = $2, notification_error = $3
       WHERE id = ANY($1)`,
      [ids, error ? null : new Date(), error ? String(error).slice(0, 1000) : null]
    );
  } catch (err) {
    console.error(`Could not record notification status for waiver ${ids.join(", ")}:`, err);
  }
}

/**
 * Email the signed waiver PDF to the gym and to the person who signed it - one
 * of each for a whole family, with every person on the one PDF.
 *
 * Always resolves: a delivery failure is logged and stored on the submission
 * rather than surfaced to the guest, whose waiver is already saved.
 *
 * @param {object} submission Waiver data in camelCase, including `id`.
 * @returns {Promise<{sent: boolean, skipped?: boolean, error?: string}>}
 */
export async function sendWaiverNotifications(submission) {
  const config = getSiteConfig();

  if (!isMailerConfigured()) {
    const message = "SMTP is not configured; waiver notification email was not sent.";
    console.warn(message);
    await recordOutcome(submission,message);
    return { sent: false, skipped: true, error: message };
  }

  try {
    const pdf = await renderWaiverPdf(submission, { gymName: config.gymName });
    const attachments = [
      {
        filename: waiverPdfFilename(submission),
        content: pdf,
        contentType: "application/pdf",
      },
    ];

    const recipients = [];
    if (config.notifyEmail) {
      recipients.push({
        label: "gym",
        to: config.notifyEmail,
        replyTo: submission.email || undefined,
        ...buildGymEmail(submission, config),
      });
    }
    if (submission.email) {
      recipients.push({
        label: "member",
        to: submission.email,
        replyTo: config.replyTo || config.notifyEmail || undefined,
        ...buildMemberEmail(submission, config),
      });
    }

    // Send independently so a bad guest address still gets the gym its copy.
    const results = await Promise.allSettled(
      recipients.map((message) => sendMail({ ...message, attachments }))
    );

    const failures = results
      .map((result, index) =>
        result.status === "rejected"
          ? `${recipients[index].label}: ${result.reason?.message || result.reason}`
          : null
      )
      .filter(Boolean);

    if (failures.length) {
      const message = failures.join("; ");
      console.error(`Waiver ${submission.id} notification partially failed: ${message}`);
      await recordOutcome(submission,message);
      return { sent: failures.length < recipients.length, error: message };
    }

    await recordOutcome(submission,null);
    return { sent: true };
  } catch (err) {
    const message = err?.message || String(err);
    console.error(`Waiver ${submission.id} notification failed:`, err);
    await recordOutcome(submission,message);
    return { sent: false, error: message };
  }
}
