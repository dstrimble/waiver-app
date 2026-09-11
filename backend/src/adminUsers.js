import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { pool } from "./db.js";
import { isMailerConfigured, sendMail } from "./mailer.js";
import { getSiteConfig } from "./siteConfig.js";

// Google sign-in for the admin page. Anyone can sign in with Google, but a new
// account only files a request: it sees nothing until an existing admin (by
// Google or by passcode) approves it. Removing an admin deletes the row, which
// ends their sessions with it.

const SESSION_DAYS = 30;

export function getGoogleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || "").trim();
}

let oauthClient = null;

/** Check an ID token from the Sign in with Google button and return who it names. */
export async function verifyGoogleCredential(credential) {
  if (!oauthClient) oauthClient = new OAuth2Client();
  const ticket = await oauthClient.verifyIdToken({
    idToken: String(credential || ""),
    audience: getGoogleClientId(),
  });
  const payload = ticket.getPayload() || {};
  if (!payload.email || !payload.email_verified) {
    throw new Error("Google has not verified this account's email address.");
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || "",
  };
}

/** Record a Google sign-in. New accounts start pending; `created` marks a first visit. */
export async function upsertGoogleUser({ sub, email, name }) {
  const { rows } = await pool.query(
    `INSERT INTO admin_users (google_sub, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (google_sub) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name, last_seen_at = now()
     RETURNING id, email, name, status, (xmax = 0) AS created`,
    [sub, email, name]
  );
  return rows[0];
}

// Only a hash of each session token is stored, so a database dump cannot be
// replayed as a login.
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query("DELETE FROM admin_sessions WHERE expires_at < now()");
  await pool.query(
    `INSERT INTO admin_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), userId, SESSION_DAYS]
  );
  return token;
}

/** The approved admin a session token belongs to, or null. */
export async function findSessionUser(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'approved'`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

export async function deleteSession(token) {
  await pool.query("DELETE FROM admin_sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function listAdminUsers() {
  const { rows } = await pool.query(
    `SELECT id, email, name, status, created_at, approved_at, approved_by
       FROM admin_users
      ORDER BY status = 'pending' DESC, created_at`
  );
  return rows;
}

export async function approveAdminUser(id, approvedBy) {
  const { rows } = await pool.query(
    `UPDATE admin_users
        SET status = 'approved', approved_at = now(), approved_by = $2
      WHERE id = $1
      RETURNING id, email, name, status`,
    [id, approvedBy]
  );
  return rows[0] || null;
}

/** Deny a request or revoke an admin. Their sessions go with the row. */
export async function removeAdminUser(id) {
  const { rows } = await pool.query("DELETE FROM admin_users WHERE id = $1 RETURNING id, email", [id]);
  return rows[0] || null;
}

/** Let the gym know someone is waiting, so a request does not sit unseen. */
export async function notifyAccessRequest(user) {
  if (!isMailerConfigured()) return;
  const { notifyEmail, gymName } = getSiteConfig();
  const who = user.name ? `${user.name} (${user.email})` : user.email;
  await sendMail({
    to: notifyEmail,
    subject: `Admin access request: ${user.name || user.email}`,
    text:
      `${who} signed in to the ${gymName} waiver admin page with Google and is ` +
      `waiting for access.\n\nSign in to the admin page and open "Admin access" to ` +
      `approve or deny the request. Until then they cannot see anything.`,
  });
}
