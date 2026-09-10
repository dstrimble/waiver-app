import { Router } from "express";
import { pool } from "../db.js";
import { hashPasscode, verifyPasscode } from "../adminPasscode.js";
import { sendFollowUpNow } from "../followUpEmails.js";
import { getWaiverStats } from "../waiverStats.js";

export const adminRouter = Router();

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function isAuthorizedPasscode(passcode) {
  const provided = String(passcode || "").trim();
  if (!provided) return false;

  const backdoorPasscode = String(process.env.ADMIN_PASSCODE || "").trim();
  if (backdoorPasscode && provided === backdoorPasscode) {
    return true;
  }

  const result = await pool.query(
    "SELECT password_hash FROM admin_auth WHERE id = 1 LIMIT 1"
  );
  const row = result.rows[0];
  if (!row?.password_hash) return false;

  return verifyPasscode(provided, row.password_hash);
}

async function requireAdmin(req, res, next) {
  try {
    const provided = String(req.headers["x-admin-passcode"] || "").trim();
    const ok = await isAuthorizedPasscode(provided);
    if (!ok) {
      return res.status(401).json({ error: "Unauthorized." });
    }
    return next();
  } catch (err) {
    console.error("Admin auth check failed:", err);
    return res.status(500).json({ error: "Could not verify admin access." });
  }
}

adminRouter.post("/verify", requireAdmin, (_req, res) => {
  return res.json({ ok: true });
});

adminRouter.post("/change-passcode", requireAdmin, async (req, res) => {
  const currentPasscode = String(req.body?.currentPasscode || "").trim();
  const newPasscode = String(req.body?.newPasscode || "").trim();
  const confirmPasscode = String(req.body?.confirmPasscode || "").trim();

  if (!currentPasscode) {
    return res.status(400).json({ error: "Current passcode is required." });
  }
  if (!newPasscode) {
    return res.status(400).json({ error: "New passcode is required." });
  }
  if (newPasscode.length < 8) {
    return res.status(400).json({ error: "New passcode must be at least 8 characters." });
  }
  if (newPasscode !== confirmPasscode) {
    return res.status(400).json({ error: "New passcode and confirmation do not match." });
  }

  const currentOk = await isAuthorizedPasscode(currentPasscode);
  if (!currentOk) {
    return res.status(401).json({ error: "Current passcode is incorrect." });
  }

  try {
    const passwordHash = await hashPasscode(newPasscode);
    await pool.query(
      `INSERT INTO admin_auth (id, password_hash)
       VALUES (1, $1)
       ON CONFLICT (id)
       DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [passwordHash]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("Failed to update admin passcode:", err);
    return res.status(500).json({ error: "Could not update admin passcode." });
  }
});

adminRouter.get("/waivers", requireAdmin, async (req, res) => {
  const start = String(req.query.start || "").trim();
  const end = String(req.query.end || "").trim();

  if (start && !isDateOnly(start)) {
    return res.status(400).json({ error: "start must be YYYY-MM-DD." });
  }
  if (end && !isDateOnly(end)) {
    return res.status(400).json({ error: "end must be YYYY-MM-DD." });
  }

  if (start && end && start > end) {
    return res.status(400).json({ error: "start must be on or before end." });
  }

  try {
    const filters = [];
    const params = [];
    if (start) {
      params.push(start);
      filters.push(`submitted_at::date >= $${params.length}`);
    }
    if (end) {
      params.push(end);
      filters.push(`submitted_at::date <= $${params.length}`);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT
        id, submitted_at, interests, name, parent_name, address, city, state,
        zip, cell_phone, home_phone, email, date_of_birth,
        other_gym_member, membership_expires, heard_about, looking_for,
        accepted, signature_name, signature_data_url,
        notification_sent_at, notification_error,
        followup_sent_at, followup_error, followup_eligible
      FROM waiver_submissions
      ${whereClause}
      ORDER BY submitted_at DESC
      LIMIT 500`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error("Failed to load waivers:", err);
    return res.status(500).json({ error: "Could not load waivers." });
  }
});

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Send the one-week follow-up immediately instead of waiting for the sweep.
 *
 * Shares the sweep's claim, so the automatic send is suppressed afterwards and
 * the guest never receives two.
 */
adminRouter.post("/waivers/:id/followup", requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid waiver id." });

  try {
    const result = await sendFollowUpNow(id);

    switch (result.status) {
      case "sent":
        return res.json({ ok: true, sentTo: result.email });
      case "already-sent":
        return res
          .status(409)
          .json({ error: "A follow-up has already been sent for this waiver." });
      case "not-found":
        return res.status(404).json({ error: "Waiver not found." });
      case "no-email":
        return res.status(400).json({ error: "This waiver has no email address." });
      case "no-smtp":
        return res.status(503).json({ error: "SMTP is not configured, so no email was sent." });
      default:
        return res.status(500).json({ error: "Could not send the follow-up." });
    }
  } catch (err) {
    console.error(`Manual follow-up for waiver ${id} failed:`, err);
    // The claim was released, so the sweep can still pick this up later.
    return res.status(502).json({ error: `Could not send the follow-up: ${err.message}` });
  }
});

/** Permanently delete a waiver, signature and all. */
adminRouter.delete("/waivers/:id", requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid waiver id." });

  try {
    const { rows } = await pool.query(
      "DELETE FROM waiver_submissions WHERE id = $1 RETURNING id, name",
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Waiver not found." });

    console.warn(`Waiver ${id} (${rows[0].name}) was deleted by an admin.`);
    return res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error(`Failed to delete waiver ${id}:`, err);
    return res.status(500).json({ error: "Could not delete waiver." });
  }
});

/** Aggregates for the admin charts - counted in SQL, never shipped row by row. */
adminRouter.get("/stats", requireAdmin, async (_req, res) => {
  try {
    return res.json(await getWaiverStats());
  } catch (err) {
    console.error("Failed to build waiver stats:", err);
    return res.status(500).json({ error: "Could not load stats." });
  }
});
