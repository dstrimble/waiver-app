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

CREATE INDEX IF NOT EXISTS idx_waiver_submitted_at
  ON waiver_submissions (submitted_at DESC);

CREATE TABLE IF NOT EXISTS admin_auth (
  id            SMALLINT PRIMARY KEY CHECK (id = 1),
  password_hash TEXT        NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
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
