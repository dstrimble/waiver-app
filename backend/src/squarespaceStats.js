import { getOrders, isSquarespaceConfigured } from "./squarespace.js";
import { buildMemberStats } from "./memberStats.js";
import { buildSalesStats } from "./salesStats.js";
import { buildConversionStats, loadWaiverSigners } from "./conversionStats.js";

// Both views read the same cached order pull, so opening one page after the
// other costs no extra Squarespace requests.

/** Members and sales, for the membership page. */
export async function getMembersAndSales({ refresh = false } = {}) {
  if (!isSquarespaceConfigured()) return { configured: false };
  const { orders, fetchedAt } = await getOrders({ refresh });
  return {
    configured: true,
    fetchedAt: new Date(fetchedAt).toISOString(),
    members: buildMemberStats(orders),
    sales: buildSalesStats(orders),
  };
}

/** How many waiver signers became members, for the waiver page. No member list. */
export async function getConversion({ refresh = false } = {}) {
  if (!isSquarespaceConfigured()) return { configured: false };
  const [{ orders, fetchedAt }, signers] = await Promise.all([
    getOrders({ refresh }),
    loadWaiverSigners(),
  ]);
  return {
    configured: true,
    fetchedAt: new Date(fetchedAt).toISOString(),
    conversion: buildConversionStats(signers, orders),
  };
}
