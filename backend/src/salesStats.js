import { dayKey, displayTimezone, nextMonth } from "./memberStats.js";

// Sales are split by what was sold. Memberships are the Member Areas plans.
// Events are rank reviews and seminars, which are set up as Squarespace
// "services". Everything else - drinks, apparel, and the gear pre-orders that
// were also set up as services - is retail.
const EVENT_PATTERN = /rank review|seminar/i;

export const SALES_CATEGORIES = ["memberships", "retail", "events"];

function categoryOf(item) {
  if (item.type === "PAYWALL_PRODUCT") return "memberships";
  if (item.type === "SERVICE" && EVENT_PATTERN.test(item.product)) return "events";
  return "retail";
}

const round2 = (n) => Math.round(n * 100) / 100;

function emptyBucket() {
  return Object.fromEntries(SALES_CATEGORIES.map((c) => [c, 0]));
}

function sumMonths(months) {
  const totals = emptyBucket();
  for (const m of months) for (const c of SALES_CATEGORIES) totals[c] += m[c];
  for (const c of SALES_CATEGORIES) totals[c] = round2(totals[c]);
  return { ...totals, total: round2(SALES_CATEGORIES.reduce((n, c) => n + totals[c], 0)) };
}

/**
 * Sales per month by category, after discounts. Tax and shipping are left out,
 * and refunded orders count for nothing. Months with no sales are zero-filled.
 */
export function buildSalesStats(orders, { now = Date.now(), timeZone = displayTimezone() } = {}) {
  const byMonth = new Map();
  for (const order of orders) {
    if (order.paymentState !== "PAID") continue;
    const month = dayKey(Date.parse(order.createdOn), timeZone).slice(0, 7);
    const bucket = byMonth.get(month) || emptyBucket();
    for (const item of order.items) bucket[categoryOf(item)] += item.paid;
    byMonth.set(month, bucket);
  }

  const thisMonth = dayKey(now, timeZone).slice(0, 7);
  const months = [];
  let month = [...byMonth.keys()].sort()[0];
  while (month && month <= thisMonth) {
    const bucket = byMonth.get(month) || emptyBucket();
    const row = { month, partial: month === thisMonth };
    for (const c of SALES_CATEGORIES) row[c] = round2(bucket[c]);
    row.total = round2(SALES_CATEGORIES.reduce((n, c) => n + bucket[c], 0));
    months.push(row);
    month = nextMonth(month);
  }

  return {
    months,
    totals: {
      thisMonth: months.length ? months[months.length - 1].total : 0,
      last12: sumMonths(months.slice(-12)),
      allTime: sumMonths(months),
    },
  };
}
