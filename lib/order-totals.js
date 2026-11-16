// SAVE AS: lib/order-totals.js
// Recompute an existing order's totals after add-items / discount
// changes. Runs inside the caller's transaction (tx) so the totals
// update commits atomically with the change that triggered it.
//
// PRICES ALWAYS COME FROM SNAPSHOTS, NEVER CLIENT INPUT: unit prices
// and addon prices are read from the stored OrderItem / OrderItemAddon
// rows, and tax/service/delivery rates come from the order's stored
// applied-rate snapshots (taxRateApplied, serviceChargeRateApplied,
// deliveryFeeApplied). The client only ever sends menu-item ids and
// quantities; checkout APIs resolve prices from the database. The
// stored discount is PRESERVED — this helper never invents or clears
// a discount. The free-delivery threshold is the only live Settings
// read here, and it only ever zeroes an already-snapshotted fee.

import { roundMoney } from "@/lib/format";

export async function recomputeOrderTotals(tx, orderId) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { addons: true } } },
  });
  if (!order) return null;

  let subtotal = 0;
  for (const item of order.items) {
    const addonSum = item.addons.reduce(
      (sum, addon) => sum + roundMoney(addon.price),
      0,
    );
    const lineTotal =
      (roundMoney(item.unitPrice) + addonSum) * roundMoney(item.quantity);
    subtotal += lineTotal;
    // Keep stored line totals consistent with their snapshots.
    if (lineTotal !== item.lineTotal) {
      await tx.orderItem.update({
        where: { id: item.id },
        data: { lineTotal },
      });
    }
  }
  subtotal = roundMoney(subtotal);

  const discount = roundMoney(order.discount);
  const taxable = subtotal - discount;
  const tax = roundMoney((taxable * roundMoney(order.taxRateApplied)) / 100);
  const serviceCharge = roundMoney(
    (taxable * roundMoney(order.serviceChargeRateApplied)) / 100,
  );

  let deliveryFee = 0;
  if (order.type === "DELIVERY") {
    deliveryFee = roundMoney(order.deliveryFeeApplied);
    const settings = await tx.setting.findUnique({ where: { id: 1 } });
    const threshold = roundMoney(settings?.freeDeliveryThreshold);
    if (threshold > 0 && subtotal >= threshold) deliveryFee = 0;
  }

  const grandTotal = subtotal - discount + tax + serviceCharge + deliveryFee;

  return tx.order.update({
    where: { id: orderId },
    data: { subtotal, tax, serviceCharge, deliveryFee, grandTotal },
  });
}
