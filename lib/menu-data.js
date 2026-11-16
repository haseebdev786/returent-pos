// SAVE AS: lib/menu-data.js
// Published-menu reads (cached) + the ONE pure totals helper used by
// every checkout/add-items API.
//
// TOTALS DECISION (locked): the totals shape is
//   { subtotal, discount, tax, serviceCharge, deliveryFee, grandTotal }
// Tax and service charge are SEPARATE fields. Service charge is never
// folded into tax, so receipts and reports can show each line honestly.
// computeTotals always returns discount: 0 — discounts are applied by
// the API layer (staff-entered, with a reason), never computed here.
// Delivery fee: 0 for DINE_IN/TAKEAWAY. For DELIVERY it is the Settings
// deliveryFee, unless freeDeliveryThreshold > 0 and subtotal reaches
// it, in which case 0. Minimum-order enforcement belongs to the API,
// not to this helper. All math uses Math.round on whole PKR.

import { prisma } from "@/lib/prisma";
import { getCachedMenu } from "@/lib/cache";
import { roundMoney } from "@/lib/format";

async function fetchPublishedMenu() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      items: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: {
          variants: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
          addonGroups: {
            include: {
              group: { include: { addons: { orderBy: { id: "asc" } } } },
            },
          },
        },
      },
    },
  });

  // Map to plain objects (no Dates in this shape) so the result is safe
  // to pass from server components to client components.
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    sortOrder: category.sortOrder,
    items: category.items.map((item) => ({
      id: item.id,
      categoryId: item.categoryId,
      name: item.name,
      description: item.description,
      price: item.price,
      imageUrl: item.imageUrl,
      isSoldOut: item.isSoldOut,
      sortOrder: item.sortOrder,
      variants: item.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        priceDelta: variant.priceDelta,
        sortOrder: variant.sortOrder,
      })),
      addonGroups: item.addonGroups.map((link) => ({
        id: link.id,
        group: {
          id: link.group.id,
          name: link.group.name,
          required: link.group.required,
          maxSelect: link.group.maxSelect,
          addons: link.group.addons.map((addon) => ({
            id: addon.id,
            name: addon.name,
            price: addon.price,
          })),
        },
      })),
    })),
  }));
}

export function getPublishedMenu() {
  return getCachedMenu(fetchPublishedMenu);
}

/**
 * Pure totals helper.
 * @param {Array<{unitPrice: number, quantity: number, addons?: Array<{price: number}>}>} items
 * @param {object} settings - merged Settings (see lib/settings-data.js)
 * @param {"DINE_IN" | "TAKEAWAY" | "DELIVERY"} orderType
 */
export function computeTotals(items, settings, orderType) {
  const list = Array.isArray(items) ? items : [];
  let subtotal = 0;
  for (const item of list) {
    const addonSum = (item.addons || []).reduce(
      (sum, addon) => sum + roundMoney(addon.price),
      0,
    );
    subtotal += (roundMoney(item.unitPrice) + addonSum) * roundMoney(item.quantity);
  }
  subtotal = roundMoney(subtotal);

  const discount = 0;
  const taxable = subtotal - discount;
  const tax = settings?.taxEnabled
    ? roundMoney((taxable * roundMoney(settings.taxRate)) / 100)
    : 0;
  const serviceCharge = settings?.serviceChargeEnabled
    ? roundMoney((taxable * roundMoney(settings.serviceChargeRate)) / 100)
    : 0;

  let deliveryFee = 0;
  if (orderType === "DELIVERY") {
    const threshold = roundMoney(settings?.freeDeliveryThreshold);
    if (!(threshold > 0 && subtotal >= threshold)) {
      deliveryFee = roundMoney(settings?.deliveryFee);
    }
  }

  const grandTotal = subtotal - discount + tax + serviceCharge + deliveryFee;

  return { subtotal, discount, tax, serviceCharge, deliveryFee, grandTotal };
}
