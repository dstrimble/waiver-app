// Squarespace reports charges, not memberships, so membership is inferred: each
// paid charge covers its plan for one billing period, plus a grace window for a
// renewal that lands a few days late. A plan is active while any of its charges
// still covers today, and has lapsed once the last one runs out.
const DAY_MS = 86400000;
const MONTHLY_DAYS = 31;
const ANNUAL_DAYS = 366;
const GRACE_DAYS = 7;
// No plan is priced like this monthly; a charge this size is a year paid up front.
const ANNUAL_MIN_AMOUNT = 500;

// Member Areas plans come through the Orders API as this line item type.
const MEMBERSHIP_TYPE = "PAYWALL_PRODUCT";
// Add-on for a member's child. It is billed as its own plan but is not a
// membership in its own right, so it is counted separately from members.
const CHILD_PRODUCT = "Add Child";

export function displayTimezone() {
  return String(process.env.DISPLAY_TIMEZONE || "").trim() || "America/New_York";
}

/** Local calendar day as YYYY-MM-DD, so string comparison orders dates. */
export function dayKey(ms, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function lastDayOfMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function nextMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** One entry per membership plan charged, with the window that charge pays for. */
function chargesFor(order) {
  const start = Date.parse(order.createdOn);
  return order.items
    .filter((item) => item.type === MEMBERSHIP_TYPE)
    .map((item) => {
      // Judged on list price, so a discounted annual plan is still annual.
      const annual = item.unitPrice >= ANNUAL_MIN_AMOUNT;
      const days = (annual ? ANNUAL_DAYS : MONTHLY_DAYS) + GRACE_DAYS;
      return {
        product: item.product,
        isChild: item.product === CHILD_PRODUCT,
        paid: item.paid,
        annual,
        name: order.name,
        start,
        end: start + days * DAY_MS,
      };
    });
}

/** Merge overlapping charge windows into continuous spans. Input is sorted. */
function spansFor(charges) {
  const spans = [];
  for (const charge of charges) {
    const last = spans[spans.length - 1];
    if (last && charge.start <= last.end) {
      last.end = Math.max(last.end, charge.end);
    } else {
      spans.push({ start: charge.start, end: charge.end });
    }
  }
  return spans;
}

/**
 * Current members and month-by-month membership, derived from Squarespace
 * membership charges. Children added to a membership are tracked alongside
 * but never counted as members.
 */
export function buildMemberStats(orders, { now = Date.now(), timeZone = displayTimezone() } = {}) {
  const byEmail = new Map();
  for (const order of orders) {
    // Refunded charges never covered anyone.
    if (order.paymentState !== "PAID" || !order.email) continue;
    const charges = chargesFor(order);
    if (!charges.length) continue;
    byEmail.set(order.email, [...(byEmail.get(order.email) || []), ...charges]);
  }

  const accounts = [];
  for (const [email, charges] of byEmail) {
    charges.sort((a, b) => a.start - b.start);
    const memberCharges = charges.filter((c) => !c.isChild);
    const childCharges = charges.filter((c) => c.isChild);

    // Each plan is judged by its own latest charge, so a dropped plan falls
    // off even while the account keeps paying for another.
    const latestByPlan = new Map();
    for (const charge of charges) latestByPlan.set(charge.product, charge);
    const active = [...latestByPlan.values()].filter((c) => c.end >= now);

    accounts.push({
      email,
      name: [...charges].reverse().find((c) => c.name)?.name || "",
      memberSpans: spansFor(memberCharges),
      childSpans: spansFor(childCharges),
      memberSince: memberCharges.length ? new Date(memberCharges[0].start).toISOString() : null,
      lastChargedAt: new Date(charges[charges.length - 1].start).toISOString(),
      plans: active.filter((c) => !c.isChild).map((c) => c.product).sort(),
      addChild: active.some((c) => c.isChild),
      // What the account currently pays after discounts, split by period so a
      // year paid up front is never folded into a monthly figure.
      monthlyAmount: active.filter((c) => !c.annual).reduce((n, c) => n + c.paid, 0),
      annualAmount: active.filter((c) => c.annual).reduce((n, c) => n + c.paid, 0),
    });
  }

  const current = accounts
    .filter((a) => a.plans.length || a.addChild)
    .map(({ memberSpans, childSpans, ...account }) => account)
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

  return {
    totals: {
      members: current.filter((a) => a.plans.length).length,
      children: current.filter((a) => a.addChild).length,
      allTimeMembers: accounts.filter((a) => a.memberSpans.length).length,
    },
    timeline: buildTimeline(accounts, now, timeZone),
    current,
  };
}

function toDaySpans(spans, timeZone) {
  return spans.map((s) => ({ startDay: dayKey(s.start, timeZone), endDay: dayKey(s.end, timeZone) }));
}

/**
 * Members and children on the books at the end of each month, plus the member
 * spans that started and ended in it. A returning member counts as joining
 * again, so each month's change in members equals joined minus left.
 */
function buildTimeline(accounts, now, timeZone) {
  const members = toDaySpans(accounts.flatMap((a) => a.memberSpans), timeZone);
  const children = toDaySpans(accounts.flatMap((a) => a.childSpans), timeZone);
  const all = [...members, ...children];
  if (!all.length) return [];

  const today = dayKey(now, timeZone);
  const thisMonth = today.slice(0, 7);
  let month = all.reduce((min, s) => (s.startDay < min ? s.startDay : min), today).slice(0, 7);
  const activeOn = (spans, day) => spans.filter((s) => s.startDay <= day && s.endDay > day).length;

  const timeline = [];
  while (month <= thisMonth) {
    const partial = month === thisMonth;
    const asOf = partial ? today : lastDayOfMonth(month);
    timeline.push({
      month,
      partial,
      members: activeOn(members, asOf),
      children: activeOn(children, asOf),
      joined: members.filter((s) => s.startDay.slice(0, 7) === month).length,
      left: members.filter((s) => s.endDay.slice(0, 7) === month && s.endDay <= today).length,
    });
    month = nextMonth(month);
  }
  return timeline;
}
