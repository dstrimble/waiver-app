// Read-only client for the Squarespace Commerce Orders API.
//
// Every order on the site comes through here: memberships sold through Member
// Areas (PAYWALL_PRODUCT line items - one order when someone joins, then one
// per renewal), shop items, and event sign-ups. Orders are cut down to the
// fields the admin page uses before they are kept.

const ORDERS_URL = "https://api.squarespace.com/1.0/commerce/orders";
const CACHE_MS = 30 * 60 * 1000;

function apiKey() {
  return String(process.env.SQUARESPACE_API_KEY || "").trim();
}

export function isSquarespaceConfigured() {
  return Boolean(apiKey());
}

function toOrder(order) {
  if (order.testmode) return null;
  const billing = order.billingAddress || {};

  // unitPricePaid is the list price. Discounts (a half-price first month, say)
  // are only given for the whole order, so they are spread across its lines
  // in proportion to each line's size to get what was actually paid.
  const subtotal = Number(order.subtotal?.value) || 0;
  const discount = Number(order.discountTotal?.value) || 0;
  const netShare = subtotal > 0 ? Math.max(0, 1 - discount / subtotal) : 1;

  return {
    id: order.id,
    createdOn: order.createdOn,
    email: String(order.customerEmail || "").trim().toLowerCase(),
    name: [billing.firstName, billing.lastName].filter(Boolean).join(" ").trim(),
    paymentState: order.paymentState,
    // Discount names, so staff discounts (the coaches') can be told apart.
    discounts: (order.discountLines || []).map((line) => String(line.name || "")),
    items: (order.lineItems || []).map((item) => {
      const unitPrice = Number(item.unitPricePaid?.value) || 0;
      const quantity = Number(item.quantity) || 1;
      return {
        product: item.productName,
        type: item.lineItemType,
        unitPrice,
        quantity,
        paid: Math.round(unitPrice * quantity * netShare * 100) / 100,
      };
    }),
  };
}

async function fetchOrders() {
  const key = apiKey();
  const orders = [];
  let cursor = null;

  do {
    const url = cursor ? `${ORDERS_URL}?cursor=${encodeURIComponent(cursor)}` : ORDERS_URL;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, "User-Agent": "waiver-app" },
    });
    if (!res.ok) {
      throw new Error(`Squarespace returned HTTP ${res.status}`);
    }
    const body = await res.json();
    for (const order of body.result || []) {
      const kept = toOrder(order);
      if (kept) orders.push(kept);
    }
    cursor = body.pagination?.hasNextPage ? body.pagination.nextPageCursor : null;
  } while (cursor);

  return orders;
}

// Paging through every order takes a few dozen requests, so the result is held
// for half an hour and concurrent callers share one fetch.
let cache = null;
let inflight = null;

export async function getOrders({ refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache;
  if (!inflight) {
    inflight = fetchOrders()
      .then((orders) => {
        cache = { orders, fetchedAt: Date.now() };
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function resetSquarespaceCache() {
  cache = null;
  inflight = null;
}
