import { pool } from "./db.js";

// Buckets are computed in the gym's own timezone, so a waiver signed at 9pm
// local counts on the day the front desk would say it was signed.
function displayTimezone() {
  return String(process.env.DISPLAY_TIMEZONE || "").trim() || "America/New_York";
}

const AGE_BANDS = ["Under 13", "13-17", "18-29", "30-44", "45+", "Unknown"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const TOTALS_SQL = `
  SELECT
    count(*)::int                                                             AS all_time,
    count(*) FILTER (WHERE submitted_at >= now() - interval '30 days')::int    AS last_30,
    count(*) FILTER (WHERE submitted_at >= now() - interval '7 days')::int     AS last_7,
    count(*) FILTER (WHERE followup_sent_at IS NOT NULL)::int                  AS followups_sent,
    count(*) FILTER (WHERE followup_sent_at IS NULL AND followup_eligible)::int AS followups_pending,
    min(submitted_at)                                                         AS first_signed_at
  FROM waiver_submissions`;

const DAILY_SQL = `
  SELECT (submitted_at AT TIME ZONE $1)::date::text AS day, count(*)::int AS count
    FROM waiver_submissions
   GROUP BY 1
   ORDER BY 1`;

// interests is an array, so one waiver can land in several series. These are
// counts of interest *selections*, which the chart labels accordingly.
const DAILY_BY_INTEREST_SQL = `
  SELECT day, interest, count(*)::int AS count
    FROM (
      SELECT (submitted_at AT TIME ZONE $1)::date::text AS day,
             unnest(interests) AS interest
        FROM waiver_submissions
    ) AS spread
   GROUP BY 1, 2
   ORDER BY 1, 2`;

// Free-text field, so group case-insensitively and show the spelling people
// used most often for each group.
const HEARD_ABOUT_SQL = `
  SELECT COALESCE(mode() WITHIN GROUP (ORDER BY NULLIF(btrim(heard_about), '')), 'Not specified') AS label,
         count(*)::int AS count
    FROM waiver_submissions
   GROUP BY lower(COALESCE(NULLIF(btrim(heard_about), ''), 'not specified'))
   ORDER BY count DESC, label`;

const AGE_BANDS_SQL = `
  SELECT band, count(*)::int AS count
    FROM (
      SELECT CASE
               WHEN date_of_birth IS NULL THEN 'Unknown'
               WHEN date_of_birth > current_date THEN 'Unknown'
               WHEN extract(year FROM age(date_of_birth)) < 13 THEN 'Under 13'
               WHEN extract(year FROM age(date_of_birth)) < 18 THEN '13-17'
               WHEN extract(year FROM age(date_of_birth)) < 30 THEN '18-29'
               WHEN extract(year FROM age(date_of_birth)) < 45 THEN '30-44'
               ELSE '45+'
             END AS band
        FROM waiver_submissions
    ) AS banded
   GROUP BY 1`;

const WEEKDAY_SQL = `
  SELECT extract(isodow FROM (submitted_at AT TIME ZONE $1))::int AS dow, count(*)::int AS count
    FROM waiver_submissions
   GROUP BY 1`;

/**
 * Everything the admin charts plot, aggregated in the database.
 *
 * Deliberately returns counts rather than rows: the waiver table carries a
 * base64 signature image per row, which has no business crossing the wire to
 * draw a line chart.
 */
export async function getWaiverStats() {
  const tz = displayTimezone();

  const [totals, daily, byInterest, heardAbout, ageBands, weekday] = await Promise.all([
    pool.query(TOTALS_SQL),
    pool.query(DAILY_SQL, [tz]),
    pool.query(DAILY_BY_INTEREST_SQL, [tz]),
    pool.query(HEARD_ABOUT_SQL),
    pool.query(AGE_BANDS_SQL),
    pool.query(WEEKDAY_SQL, [tz]),
  ]);

  const row = totals.rows[0] || {};
  const ageByBand = new Map(ageBands.rows.map((r) => [r.band, r.count]));
  const countByDow = new Map(weekday.rows.map((r) => [r.dow, r.count]));

  return {
    timezone: tz,
    totals: {
      allTime: row.all_time ?? 0,
      last30: row.last_30 ?? 0,
      last7: row.last_7 ?? 0,
      followUpsSent: row.followups_sent ?? 0,
      followUpsPending: row.followups_pending ?? 0,
      firstSignedAt: row.first_signed_at ?? null,
    },
    daily: daily.rows,
    dailyByInterest: byInterest.rows,
    heardAbout: heardAbout.rows,
    // Fixed order and zero-filled, so the chart never has to invent a band.
    ageBands: AGE_BANDS.map((band) => ({ band, count: ageByBand.get(band) ?? 0 })),
    weekday: WEEKDAYS.map((label, index) => ({
      label,
      count: countByDow.get(index + 1) ?? 0,
    })),
  };
}
