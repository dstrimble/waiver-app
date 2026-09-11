import { pool } from "./db.js";
import { dayKey, displayTimezone } from "./memberStats.js";

// Waivers are how trial guests come in, so the question worth answering is how
// many of them go on to pay. Each waiver is matched to Squarespace by email.
// Anyone who had paid before they signed is left out: they were a current or
// past member signing paperwork, not a guest deciding whether to join.
const DAY_MS = 86400000;
// Some people pay on the spot and sign the waiver a moment later.
const SAME_VISIT_MS = DAY_MS;

/** One row per waiver email: when they first signed, and whether they got the follow-up. */
export async function loadWaiverSigners() {
  const { rows } = await pool.query(
    `SELECT lower(btrim(email)) AS email,
            min(submitted_at) AS signed_at,
            bool_or(followup_sent_at IS NOT NULL) AS followed_up
       FROM waiver_submissions
      WHERE archived_at IS NULL AND btrim(COALESCE(email, '')) <> ''
      GROUP BY 1`
  );
  return rows;
}

function summarize(outcomes) {
  const joined = outcomes.filter((o) => o.daysToJoin !== null).length;
  return {
    signers: outcomes.length,
    joined,
    rate: outcomes.length ? joined / outcomes.length : 0,
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * How many waiver signers became paying members, overall, by the month they
 * signed, and split by whether they were sent the one-week follow-up email.
 */
export function buildConversionStats(signers, orders, { timeZone = displayTimezone() } = {}) {
  // Every paid membership charge per email. Add Child counts: a parent who
  // signs their child's waiver and then pays for them has converted.
  const chargesByEmail = new Map();
  for (const order of orders) {
    if (order.paymentState !== "PAID" || !order.email) continue;
    if (!order.items.some((item) => item.type === "PAYWALL_PRODUCT")) continue;
    const list = chargesByEmail.get(order.email) || [];
    list.push(Date.parse(order.createdOn));
    chargesByEmail.set(order.email, list);
  }

  let alreadyPaying = 0;
  const outcomes = [];
  for (const signer of signers) {
    const signedAt = new Date(signer.signed_at).getTime();
    const charges = chargesByEmail.get(signer.email) || [];
    if (charges.some((t) => t < signedAt - SAME_VISIT_MS)) {
      alreadyPaying += 1;
      continue;
    }
    const joinedAt = charges.filter((t) => t >= signedAt - SAME_VISIT_MS).sort((a, b) => a - b)[0];
    outcomes.push({
      month: dayKey(signedAt, timeZone).slice(0, 7),
      followedUp: Boolean(signer.followed_up),
      daysToJoin: joinedAt === undefined ? null : Math.max(0, Math.round((joinedAt - signedAt) / DAY_MS)),
    });
  }

  const months = [...new Set(outcomes.map((o) => o.month))].sort();
  return {
    ...summarize(outcomes),
    alreadyPaying,
    medianDaysToJoin: median(outcomes.filter((o) => o.daysToJoin !== null).map((o) => o.daysToJoin)),
    followUp: {
      sent: summarize(outcomes.filter((o) => o.followedUp)),
      notSent: summarize(outcomes.filter((o) => !o.followedUp)),
    },
    byMonth: months.map((month) => ({ month, ...summarize(outcomes.filter((o) => o.month === month)) })),
  };
}
