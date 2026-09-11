import { getOrders, isSquarespaceConfigured } from "./squarespace.js";
import { buildMemberStats } from "./memberStats.js";
import { buildSalesStats } from "./salesStats.js";
import { buildConversionStats, loadWaiverSigners } from "./conversionStats.js";

/** Everything the admin page shows from Squarespace, off one cached order pull. */
export async function getSquarespaceStats({ refresh = false } = {}) {
  if (!isSquarespaceConfigured()) return { configured: false };
  const [{ orders, fetchedAt }, signers] = await Promise.all([
    getOrders({ refresh }),
    loadWaiverSigners(),
  ]);
  return {
    configured: true,
    fetchedAt: new Date(fetchedAt).toISOString(),
    members: buildMemberStats(orders),
    conversion: buildConversionStats(signers, orders),
    sales: buildSalesStats(orders),
  };
}
