import pg from "pg";
import { hashPasscode } from "./adminPasscode.js";

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "waiver_app",
  max: Number(process.env.PGPOOL_MAX) || 10,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS waiver_submissions (
  id                  BIGSERIAL PRIMARY KEY,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  interests           TEXT[] NOT NULL DEFAULT '{}',
  name                TEXT NOT NULL,
  parent_name         TEXT,
  address             TEXT,
  city                TEXT,
  state               TEXT,
  zip                 TEXT,
  cell_phone          TEXT,
  home_phone          TEXT,
  email               TEXT,
  date_of_birth       DATE,
  other_gym_member    TEXT,
  membership_expires  TEXT,
  heard_about         TEXT,
  looking_for         TEXT,
  waiver_text_version TEXT NOT NULL DEFAULT 'v1',
  accepted            BOOLEAN NOT NULL,
  signature_name      TEXT NOT NULL,
  signature_data_url  TEXT NOT NULL
);

-- Delivery status for the confirmation emails sent after a submission.
-- Added after the initial release, so applied separately from the CREATE above.
ALTER TABLE waiver_submissions
  ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ;
ALTER TABLE waiver_submissions
  ADD COLUMN IF NOT EXISTS notification_error   TEXT;

-- Delivery status for the follow-up email sent a week after signing. A NULL
-- followup_sent_at is the queue: the sweep claims a row by stamping it and
-- clears the stamp again if the send fails, so a row is never emailed twice.
ALTER TABLE waiver_submissions
  ADD COLUMN IF NOT EXISTS followup_sent_at TIMESTAMPTZ;
ALTER TABLE waiver_submissions
  ADD COLUMN IF NOT EXISTS followup_error   TEXT;

-- Only waivers signed from the moment this feature shipped get a follow-up;
-- nobody already in the table is mailed retroactively.
--
-- The two statements below do that without any migration bookkeeping. The
-- column is created defaulting to false, which back-fills every existing row
-- as ineligible in the same breath; the default is then flipped to true so
-- every waiver signed afterwards is eligible. Both are no-ops on later boots,
-- and they share one implicit transaction, so no submission can slip through
-- in between.
ALTER TABLE waiver_submissions
  ADD COLUMN IF NOT EXISTS followup_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE waiver_submissions
  ALTER COLUMN followup_eligible SET DEFAULT true;

-- Archiving hides a waiver from the admin list, the charts and the follow-up
-- queue without destroying the signed record, which is the document the gym
-- would rely on in a dispute. Restoring is just clearing this column.
ALTER TABLE waiver_submissions
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- MatTracker account setup for the person each waiver covers: when it went
-- through, the last failure, and how many tries it has had.
ALTER TABLE waiver_submissions
  ADD COLUMN IF NOT EXISTS mattracker_synced_at TIMESTAMPTZ;
ALTER TABLE waiver_submissions
  ADD COLUMN IF NOT EXISTS mattracker_error     TEXT;
ALTER TABLE waiver_submissions
  ADD COLUMN IF NOT EXISTS mattracker_attempts  INT NOT NULL DEFAULT 0;

-- Only waivers signed from the moment this shipped are sent, by the same
-- two-step as followup_eligible above: existing rows back-fill as false, then
-- the default flips to true for every waiver signed afterwards.
ALTER TABLE waiver_submissions
  ADD COLUMN IF NOT EXISTS mattracker_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE waiver_submissions
  ALTER COLUMN mattracker_eligible SET DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_waiver_mattracker_queue
  ON waiver_submissions (submitted_at)
  WHERE mattracker_synced_at IS NULL AND mattracker_eligible AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_waiver_submitted_at
  ON waiver_submissions (submitted_at DESC);

-- Keeps the follow-up sweep off a full table scan as the table grows.
-- Superseded by the queue index below, which also excludes archived rows.
DROP INDEX IF EXISTS idx_waiver_followup_pending;
CREATE INDEX IF NOT EXISTS idx_waiver_followup_queue
  ON waiver_submissions (submitted_at)
  WHERE followup_sent_at IS NULL AND followup_eligible AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_auth (
  id            SMALLINT PRIMARY KEY CHECK (id = 1),
  password_hash TEXT        NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Google accounts that have signed in to the admin page. Each starts pending
-- and sees nothing until an existing admin approves it; deleting the row
-- denies or revokes access.
CREATE TABLE IF NOT EXISTS admin_users (
  id           BIGSERIAL PRIMARY KEY,
  google_sub   TEXT        NOT NULL UNIQUE,
  email        TEXT        NOT NULL,
  name         TEXT        NOT NULL DEFAULT '',
  status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at  TIMESTAMPTZ,
  approved_by  TEXT
);

-- Sign-in sessions for approved Google admins, stored as token hashes.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT        PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
`;

async function seedAdminAuth() {
  const configured = String(process.env.ADMIN_PASSCODE || "").trim();
  if (!configured) return;

  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM admin_auth WHERE id = 1"
  );
  if (rows[0].count > 0) return;

  const passwordHash = await hashPasscode(configured);
  await pool.query("INSERT INTO admin_auth (id, password_hash) VALUES (1, $1)", [
    passwordHash,
  ]);
}

export async function initDb({ retries = 10, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query(SCHEMA);
      await seedAdminAuth();
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
