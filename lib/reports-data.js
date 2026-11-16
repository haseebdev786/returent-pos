// SAVE AS: lib/reports-data.js
// Reporting queries for the dashboard and reports pages. Server-only:
// every function takes a Prisma client as its first argument so callers
// pass the shared `prisma` singleton (or a transaction client).
//
// SALES-COUNTING RULE (locked): sales figures count orders with status
// COMPLETED only. A bill is revenue once it is completed; orders still
// being prepared, ready, or out for delivery are open orders, never
// revenue, and are reported separately as open-order counts. Cancelled
// orders are EXCLUDED from every sales figure; only getCancelledOrders
// returns them, and it returns nothing else.
//
// DATE-RANGE RULE: every function takes [from, toExclusive) where `from`
// is local midnight at the start of the first chosen day and
// `toExclusive` is local midnight at the start of the day AFTER the
// last chosen day, so both chosen days are fully included. Callers
// build the pair with parseLocalDateKey + nextDayStart below. All
// filtering is on Order.createdAt (the day the bill was placed), so the
// payment breakdown reconciles with the sales summary for the same
// range: payments are counted by their bill's date, not by the payment
// row's own timestamp.
//
// FIELD DEFINITIONS (getSalesSummary): grossSales is the sum of order
// subtotals (menu + addons before discount, tax, service charge and
// delivery fee). discounts/tax/serviceCharge/deliveryFees are the sums
// of the stored order fields. grandTotal is the sum of stored order
// grand totals. All money is whole PKR (Int); sums default to 0 when
// the range has no completed bills.
//
// PAYMENT BREAKDOWN: only Payment rows with status PAID on COMPLETED
// orders are counted, so refunded payments never appear as takings.
// There is no cost data in V1, so no margin or cost-based figure is
// computed anywhere in this file.
//
// All queries are single Prisma aggregate/groupBy/findMany calls — no
// raw SQL and no per-row follow-up queries.

const ORDER_TYPE_ORDER = ["DINE_IN", "TAKEAWAY", "DELIVERY"];
const PAYMENT_METHOD_ORDER = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "COD"];

function assertRange(from, toExclusive) {
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
    throw new Error("Reports range start (from) must be a valid Date.");
  }
  if (!(toExclusive instanceof Date) || Number.isNaN(toExclusive.getTime())) {
    throw new Error("Reports range end (toExclusive) must be a valid Date.");
  }
  if (from >= toExclusive) {
    throw new Error("Reports range start must be before the range end.");
  }
}

/**
 * Parse a strict YYYY-MM-DD key (e.g. from <input type="date">) into a
 * local-midnight Date. Returns null for anything else, including
 * impossible calendar dates such as 2026-02-30. Built from date parts
 * with the local-time Date constructor — never from an ISO string, so
 * no UTC shift can move the day.
 */
export function parseLocalDateKey(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Local midnight at the start of the day after `date`. */
export function nextDayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

/**
 * Sales totals for COMPLETED orders in [from, toExclusive).
 * @returns {{bills: number, grossSales: number, discounts: number, tax: number, serviceCharge: number, deliveryFees: number, grandTotal: number}}
 */
export async function getSalesSummary(prisma, from, toExclusive) {
  assertRange(from, toExclusive);
  const result = await prisma.order.aggregate({
    where: {
      status: "COMPLETED",
      createdAt: { gte: from, lt: toExclusive },
    },
    _count: { _all: true },
    _sum: {
      subtotal: true,
      discount: true,
      tax: true,
      serviceCharge: true,
      deliveryFee: true,
      grandTotal: true,
    },
  });
  return {
    bills: result._count._all,
    grossSales: result._sum.subtotal ?? 0,
    discounts: result._sum.discount ?? 0,
    tax: result._sum.tax ?? 0,
    serviceCharge: result._sum.serviceCharge ?? 0,
    deliveryFees: result._sum.deliveryFee ?? 0,
    grandTotal: result._sum.grandTotal ?? 0,
  };
}

/**
 * Best-selling items from COMPLETED orders in [from, toExclusive),
 * ordered by revenue (then quantity). Grouped by menu item + snapshot
 * name, so renamed menu items and items whose menu row was deleted
 * still report under the name printed on the bill. `menuItemId` is
 * null for items with no surviving menu row.
 * @returns {Array<{menuItemId: number|null, itemName: string, qty: number, revenue: number}>}
 */
export async function getTopItems(prisma, from, toExclusive, limit = 10) {
  assertRange(from, toExclusive);
  const safeLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;
  const rows = await prisma.orderItem.groupBy({
    by: ["menuItemId", "itemName"],
    where: {
      order: {
        status: "COMPLETED",
        createdAt: { gte: from, lt: toExclusive },
      },
    },
    _sum: { quantity: true, lineTotal: true },
    orderBy: [
      { _sum: { lineTotal: "desc" } },
      { _sum: { quantity: "desc" } },
    ],
    take: safeLimit,
  });
  return rows.map((row) => ({
    menuItemId: row.menuItemId,
    itemName: row.itemName,
    qty: row._sum.quantity ?? 0,
    revenue: row._sum.lineTotal ?? 0,
  }));
}

/**
 * Completed bills and totals per order type in [from, toExclusive).
 * All three types are always returned (zero bills where a type had no
 * completed orders), in DINE_IN / TAKEAWAY / DELIVERY order.
 * @returns {Array<{type: string, bills: number, grandTotal: number}>}
 */
export async function getTypeBreakdown(prisma, from, toExclusive) {
  assertRange(from, toExclusive);
  const rows = await prisma.order.groupBy({
    by: ["type"],
    where: {
      status: "COMPLETED",
      createdAt: { gte: from, lt: toExclusive },
    },
    _count: { _all: true },
    _sum: { grandTotal: true },
  });
  const byType = new Map(
    rows.map((row) => [
      row.type,
      { bills: row._count._all, grandTotal: row._sum.grandTotal ?? 0 },
    ]),
  );
  return ORDER_TYPE_ORDER.map((type) => ({
    type,
    bills: byType.get(type)?.bills ?? 0,
    grandTotal: byType.get(type)?.grandTotal ?? 0,
  }));
}

/**
 * Paid payments per method for COMPLETED orders in [from, toExclusive).
 * Only Payment rows with status PAID are counted; the range applies to
 * the order's createdAt so this breakdown reconciles with
 * getSalesSummary for the same range. All five methods are always
 * returned (zero payments where a method was unused).
 * @returns {Array<{method: string, payments: number, amount: number}>}
 */
export async function getPaymentBreakdown(prisma, from, toExclusive) {
  assertRange(from, toExclusive);
  const rows = await prisma.payment.groupBy({
    by: ["method"],
    where: {
      status: "PAID",
      order: {
        status: "COMPLETED",
        createdAt: { gte: from, lt: toExclusive },
      },
    },
    _count: { _all: true },
    _sum: { amount: true },
  });
  const byMethod = new Map(
    rows.map((row) => [
      row.method,
      { payments: row._count._all, amount: row._sum.amount ?? 0 },
    ]),
  );
  return PAYMENT_METHOD_ORDER.map((method) => ({
    method,
    payments: byMethod.get(method)?.payments ?? 0,
    amount: byMethod.get(method)?.amount ?? 0,
  }));
}

/**
 * Cancelled orders in [from, toExclusive), newest first. This is the
 * only reporting function that returns cancelled orders, and it is
 * never mixed into sales figures.
 * @returns {Array<{orderNumber: string, type: string, grandTotal: number, cancelledReason: string|null, createdAt: Date}>}
 */
export async function getCancelledOrders(prisma, from, toExclusive) {
  assertRange(from, toExclusive);
  return prisma.order.findMany({
    where: {
      status: "CANCELLED",
      createdAt: { gte: from, lt: toExclusive },
    },
    orderBy: { createdAt: "desc" },
    select: {
      orderNumber: true,
      type: true,
      grandTotal: true,
      cancelledReason: true,
      createdAt: true,
    },
  });
}
