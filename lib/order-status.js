// SAVE AS: lib/order-status.js
// THE ONE place order status is derived from batch states.
//
// RULE:
// - CANCELLED, COMPLETED and OUT_FOR_DELIVERY are STICKY. Once an order
//   reaches one of them, batch changes never move it backwards. Only an
//   explicit staff action (e.g. reopen) may change a sticky order, and
//   that action must not go through this helper.
// - Otherwise: all batches READY => READY; any batch PREPARING, or a
//   mix of READY and RECEIVED => PREPARING; all RECEIVED (or no
//   batches yet) => RECEIVED.
// Kitchen screens update BATCH status; this helper then recomputes the
// parent order. Never derive order status inline in a route — call
// recalcOrderStatus so every path follows the same rule.

const STICKY_STATUSES = new Set([
  "CANCELLED",
  "COMPLETED",
  "OUT_FOR_DELIVERY",
]);

export function deriveOrderStatus(batches, currentStatus) {
  if (STICKY_STATUSES.has(currentStatus)) return currentStatus;

  const list = Array.isArray(batches) ? batches : [];
  if (list.length === 0) return "RECEIVED";

  const states = list.map((batch) =>
    typeof batch === "string" ? batch : batch.status,
  );
  if (states.every((state) => state === "READY")) return "READY";
  if (
    states.some((state) => state === "PREPARING") ||
    states.some((state) => state === "READY")
  ) {
    return "PREPARING";
  }
  return "RECEIVED";
}

/**
 * Recompute an order's status from its batches inside the caller's
 * transaction. Updates the order ONLY when the derived status differs
 * and the order is not in a sticky state. Returns the (possibly
 * unchanged) status string.
 */
export async function recalcOrderStatus(tx, orderId) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true },
  });
  if (!order) return null;
  if (STICKY_STATUSES.has(order.status)) return order.status;

  const batches = await tx.orderBatch.findMany({
    where: { orderId },
    select: { status: true },
  });
  const derived = deriveOrderStatus(batches, order.status);
  if (derived !== order.status) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: derived },
    });
  }
  return derived;
}
