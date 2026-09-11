import { Router } from "express";
import { pool } from "../db.js";
import { hashPasscode, verifyPasscode } from "../adminPasscode.js";
import { sendFollowUpNow } from "../followUpEmails.js";
import { syncWaiverNow } from "../matTracker.js";
import { getWaiverStats } from "../waiverStats.js";
import { getConversion, getMembersAndSales } from "../squarespaceStats.js";
import {
  approveAdminUser,
  createSession,
  deleteSession,
  findSessionUser,
  getGoogleClientId,
  listAdminUsers,
  notifyAccessRequest,
  removeAdminUser,
  upsertGoogleUser,
  verifyGoogleCredential,
} from "../adminUsers.js";

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

function bearerToken(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

// Admin routes accept either a Google session (Authorization: Bearer) or the
// passcode header. A Google admin is attached as req.adminUser.
async function requireAdmin(req, res, next) {
  try {
    const token = bearerToken(req);
    if (token) {
      const user = await findSessionUser(token);
      if (!user) {
        return res.status(401).json({ error: "Your admin session has ended. Sign in again." });
      }
      req.adminUser = user;
      return next();
    }

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

/** Public: which Google client the sign-in button should use, if any. */
adminRouter.get("/auth/config", (_req, res) => {
  return res.json({ googleClientId: getGoogleClientId() || null });
});

/**
 * Public: exchange a Google ID token for an admin session. Accounts that are
 * not yet approved get no session - just confirmation that their request is
 * on file - and the gym is emailed the first time one asks.
 */
adminRouter.post("/auth/google", async (req, res) => {
  if (!getGoogleClientId()) {
    return res.status(503).json({ error: "Google sign-in is not set up." });
  }

  let identity;
  try {
    identity = await verifyGoogleCredential(req.body?.credential);
  } catch (err) {
    console.warn("Google sign-in rejected:", err.message);
    return res.status(401).json({ error: "Google sign-in could not be verified. Try again." });
  }

  try {
    const user = await upsertGoogleUser(identity);
    if (user.status === "approved") {
      const token = await createSession(user.id);
      return res.json({
        status: "approved",
        token,
        user: { id: user.id, email: user.email, name: user.name },
      });
    }

    if (user.created) {
      notifyAccessRequest(user).catch((err) =>
        console.error(`Could not email the access request from ${user.email}:`, err)
      );
    }
    return res.json({ status: "pending", email: user.email });
  } catch (err) {
    console.error("Google sign-in failed:", err);
    return res.status(500).json({ error: "Could not sign in." });
  }
});

/** Who is signed in - used to pick a stored Google session back up. */
adminRouter.get("/auth/me", requireAdmin, (req, res) => {
  return res.json({ user: req.adminUser || null });
});

adminRouter.post("/auth/logout", requireAdmin, async (req, res) => {
  try {
    const token = bearerToken(req);
    if (token) await deleteSession(token);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Failed to end admin session:", err);
    return res.status(500).json({ error: "Could not sign out." });
  }
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

  const includeArchived = String(req.query.includeArchived || "") === "true";

  try {
    const filters = [];
    const params = [];
    if (!includeArchived) filters.push("archived_at IS NULL");
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
        followup_sent_at, followup_error, followup_eligible,
        mattracker_synced_at, mattracker_error, mattracker_eligible,
        archived_at
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
      case "archived":
        return res
          .status(409)
          .json({ error: "This waiver is archived. Restore it first to send a follow-up." });
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

/** Send one waiver to MatTracker now - a retry that ran out, or a second go. */
adminRouter.post("/waivers/:id/mattracker", requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid waiver id." });

  try {
    const result = await syncWaiverNow(id);
    switch (result.status) {
      case "sent":
        return res.json({ ok: true });
      case "not-found":
        return res.status(404).json({ error: "Waiver not found." });
      case "archived":
        return res.status(409).json({ error: "This waiver is archived. Restore it first." });
      case "no-email":
        return res.status(400).json({ error: "This waiver has no email address." });
      case "disabled":
        return res.status(503).json({ error: "MatTracker sync is not set up on this server." });
      default:
        return res.status(500).json({ error: "Could not send to MatTracker." });
    }
  } catch (err) {
    console.error(`Manual MatTracker send for waiver ${id} failed:`, err);
    return res.status(502).json({ error: `Could not send to MatTracker: ${err.message}` });
  }
});

/**
 * Archive or restore a waiver.
 *
 * Archiving takes the waiver out of the list, the charts and the follow-up
 * queue but keeps the signed record itself - that record is the document the
 * gym would rely on in a dispute, so nothing here destroys one.
 */
async function setArchived(req, res, archived) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid waiver id." });

  try {
    const { rows } = await pool.query(
      `UPDATE waiver_submissions
          SET archived_at = ${archived ? "now()" : "NULL"}
        WHERE id = $1
        RETURNING id, name, archived_at`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Waiver not found." });

    return res.json({ ok: true, id: rows[0].id, archivedAt: rows[0].archived_at });
  } catch (err) {
    console.error(`Failed to ${archived ? "archive" : "restore"} waiver ${id}:`, err);
    return res
      .status(500)
      .json({ error: `Could not ${archived ? "archive" : "restore"} the waiver.` });
  }
}

adminRouter.post("/waivers/:id/archive", requireAdmin, (req, res) => setArchived(req, res, true));
adminRouter.post("/waivers/:id/restore", requireAdmin, (req, res) => setArchived(req, res, false));

/** Aggregates for the admin charts - counted in SQL, never shipped row by row. */
adminRouter.get("/stats", requireAdmin, async (_req, res) => {
  try {
    return res.json(await getWaiverStats());
  } catch (err) {
    console.error("Failed to build waiver stats:", err);
    return res.status(500).json({ error: "Could not load stats." });
  }
});

// Members, sales and conversion are worked out from Squarespace orders, cached
// for half an hour; ?refresh=true pulls a fresh copy.
function squarespaceRoute(load) {
  return async (req, res) => {
    try {
      return res.json(await load({ refresh: req.query.refresh === "true" }));
    } catch (err) {
      console.error("Failed to load Squarespace data:", err);
      return res.status(502).json({ error: "Could not load data from Squarespace." });
    }
  };
}

/** Members and sales, for the membership page. */
adminRouter.get("/members", requireAdmin, squarespaceRoute(getMembersAndSales));

/** Waiver signers who became members, for the waiver page. */
adminRouter.get("/conversion", requireAdmin, squarespaceRoute(getConversion));

/** Google accounts that have asked for access, pending first. */
adminRouter.get("/users", requireAdmin, async (_req, res) => {
  try {
    return res.json(await listAdminUsers());
  } catch (err) {
    console.error("Failed to list admin users:", err);
    return res.status(500).json({ error: "Could not load admin access." });
  }
});

adminRouter.post("/users/:id/approve", requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid user id." });

  try {
    const approvedBy = req.adminUser?.email || "passcode";
    const user = await approveAdminUser(id, approvedBy);
    if (!user) return res.status(404).json({ error: "That request is no longer there." });
    return res.json({ ok: true, user });
  } catch (err) {
    console.error(`Failed to approve admin user ${id}:`, err);
    return res.status(500).json({ error: "Could not approve access." });
  }
});

/** Deny a pending request or remove an admin. */
adminRouter.delete("/users/:id", requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid user id." });
  if (req.adminUser && String(req.adminUser.id) === String(id)) {
    return res.status(400).json({ error: "You can't remove your own access." });
  }

  try {
    const user = await removeAdminUser(id);
    if (!user) return res.status(404).json({ error: "That account is no longer there." });
    return res.json({ ok: true });
  } catch (err) {
    console.error(`Failed to remove admin user ${id}:`, err);
    return res.status(500).json({ error: "Could not remove access." });
  }
});
