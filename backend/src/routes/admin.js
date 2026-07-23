import { Router } from "express";
import { pool } from "../db.js";
import { hashPasscode, verifyPasscode } from "../adminPasscode.js";

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
        accepted, signature_name, signature_data_url
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
