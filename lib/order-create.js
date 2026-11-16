// SAVE AS: lib/order-create.js
// SERVER-SIDE ONLY. Prices an order's lines from the database and builds
// order totals. NEVER import from a client component, and NEVER trust a
// price or total sent by the client — the client sends only menu-item
// ids, variant/addon ids, quantities and notes; every price here comes
// from a MenuItem / MenuItemVariant / Addon row.
//
// priceOrderLines runs inside the caller's Prisma transaction (tx) so
// pricing and order creation commit atomically. On any invalid line it
// throws an Error with `code = "ORDER_VALIDATION"`; API routes map that
// to HTTP 400, and any other error to 500.
//
// buildOrderTotals mirrors lib/menu-data.js computeTotals EXACTLY
// (same rounding, same free-delivery-threshold check on the subtotal,
// tax/service only when enabled) but honours a discount. computeTotals
// cannot be reused directly: it hardcodes discount: 0 by design
// (discounts are applied by the API layer). With discount = 0 the two
// helpers return identical totals. The returned object also carries the
// applied-rate snapshots (taxRateApplied, serviceChargeRateApplied,
// deliveryFeeApplied) that the Order row must store, because
// lib/order-totals.js recomputeOrderTotals re-derives later totals from
// those snapshots — never from live Settings.

import { roundMoney } from "@/lib/format";

const MAX_LINES = 50;
const MAX_QUANTITY = 99;
const MAX_NOTE_LENGTH = 500;

function validationError(message) {
  const error = new Error(message);
  error.code = "ORDER_VALIDATION";
  return error;
}

function toLineId(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw validationError(`${label} must be a positive integer.`);
  }
  return n;
}

/**
 * Price client-submitted lines against the live menu.
 *
 * @param {object} tx - Prisma transaction client (never the global prisma).
 * @param {Array<{menuItemId: number, variantId?: number|null, addonIds?: number[], quantity: number, note?: string}>} lines
 * @param {object} _settings - Accepted for signature symmetry with the
 *   checkout flow; pricing needs no Settings (prices come from menu rows).
 * @returns {Promise<{lines: Array<{menuItemId: number, itemName: string, variantName: string|null, unitPrice: number, quantity: number, note: string|null, lineTotal: number, addons: Array<{addonName: string, price: number}>}>, subtotal: number}>}
 */
export async function priceOrderLines(tx, lines, _settings) {
  void _settings;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw validationError("At least one item is required.");
  }
  if (lines.length > MAX_LINES) {
    throw validationError(`At most ${MAX_LINES} lines per order.`);
  }

  const priced = [];

  for (const [index, raw] of lines.entries()) {
    const label = `Line ${index + 1}`;
    if (!raw || typeof raw !== "object") {
      throw validationError(`${label}: invalid item.`);
    }

    const menuItemId = toLineId(raw.menuItemId, `${label}: menuItemId`);
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw validationError(
        `${label}: quantity must be between 1 and ${MAX_QUANTITY}.`,
      );
    }
    const note =
      typeof raw.note === "string" ? raw.note.trim().slice(0, MAX_NOTE_LENGTH) : null;

    const item = await tx.menuItem.findUnique({
      where: { id: menuItemId },
      include: {
        variants: true,
        addonGroups: {
          include: { group: { include: { addons: true } } },
        },
      },
    });
    if (!item) {
      throw validationError(`${label}: menu item no longer exists.`);
    }
    if (!item.isActive) {
      throw validationError(`${label}: "${item.name}" is not available.`);
    }
    if (item.isSoldOut) {
      throw validationError(`${label}: "${item.name}" is sold out.`);
    }

    // Variant: optional, but when given it must belong to this item.
    let variantName = null;
    let priceDelta = 0;
    if (raw.variantId !== undefined && raw.variantId !== null) {
      const variantId = toLineId(raw.variantId, `${label}: variantId`);
      const variant = item.variants.find((v) => v.id === variantId);
      if (!variant) {
        throw validationError(
          `${label}: that variant does not belong to "${item.name}".`,
        );
      }
      variantName = variant.name;
      priceDelta = roundMoney(variant.priceDelta);
    }

    const unitPrice = roundMoney(item.price) + priceDelta;
    if (unitPrice < 0) {
      throw validationError(`${label}: "${item.name}" has an invalid price.`);
    }

    // Addons: every id must belong to a group linked to this item.
    // Duplicate ids in one line are collapsed (one addon selected once).
    const rawAddonIds = Array.isArray(raw.addonIds) ? raw.addonIds : [];
    const addonIds = [
      ...new Set(rawAddonIds.map((id) => toLineId(id, `${label}: addonId`))),
    ];

    const addonById = new Map();
    for (const link of item.addonGroups) {
      for (const addon of link.group.addons) {
        addonById.set(addon.id, { addon, group: link.group });
      }
    }
    for (const addonId of addonIds) {
      if (!addonById.has(addonId)) {
        throw validationError(
          `${label}: that extra does not belong to "${item.name}".`,
        );
      }
    }

    // Per-group required / maxSelect enforcement, per line.
    for (const link of item.addonGroups) {
      const group = link.group;
      const selectedInGroup = addonIds.filter(
        (addonId) => addonById.get(addonId).group.id === group.id,
      );
      if (group.required && selectedInGroup.length === 0) {
        throw validationError(
          `${label}: "${item.name}" requires a choice from "${group.name}".`,
        );
      }
      if (selectedInGroup.length > group.maxSelect) {
        throw validationError(
          `${label}: at most ${group.maxSelect} choice(s) from "${group.name}".`,
        );
      }
    }

    const addons = addonIds.map((addonId) => {
      const { addon } = addonById.get(addonId);
      return { addonName: addon.name, price: roundMoney(addon.price) };
    });
    const addonSum = addons.reduce((sum, a) => sum + a.price, 0);
    const lineTotal = (unitPrice + addonSum) * quantity;

    priced.push({
      menuItemId: item.id,
      itemName: item.name,
      variantName,
      unitPrice,
      quantity,
      note: note || null,
      lineTotal,
      addons,
    });
  }

  const subtotal = priced.reduce((sum, line) => sum + line.lineTotal, 0);

  return { lines: priced, subtotal: roundMoney(subtotal) };
}

/**
 * Discount-aware totals for priced lines. See the header comment for why
 * this does not delegate to computeTotals (which hardcodes discount 0).
 *
 * @param {Array<{lineTotal: number}>} pricedLines - from priceOrderLines.
 * @param {object} settings - merged Settings (see lib/settings-data.js).
 * @param {"DINE_IN" | "TAKEAWAY" | "DELIVERY"} orderType
 * @param {number} [discount=0] - whole PKR, clamped to [0, subtotal].
 * @returns {{subtotal: number, discount: number, tax: number, serviceCharge: number, deliveryFee: number, grandTotal: number, taxRateApplied: number, serviceChargeRateApplied: number, deliveryFeeApplied: number}}
 */
export function buildOrderTotals(pricedLines, settings, orderType, discount = 0) {
  const list = Array.isArray(pricedLines) ? pricedLines : [];
  const subtotal = roundMoney(
    list.reduce((sum, line) => sum + roundMoney(line.lineTotal), 0),
  );

  const clampedDiscount = Math.max(
    0,
    Math.min(roundMoney(discount), subtotal),
  );
  const taxable = subtotal - clampedDiscount;

  const taxRateApplied = settings?.taxEnabled ? roundMoney(settings.taxRate) : 0;
  const serviceChargeRateApplied = settings?.serviceChargeEnabled
    ? roundMoney(settings.serviceChargeRate)
    : 0;
  const tax = roundMoney((taxable * taxRateApplied) / 100);
  const serviceCharge = roundMoney(
    (taxable * serviceChargeRateApplied) / 100,
  );

  // Snapshot the flat fee for DELIVERY; recomputeOrderTotals applies the
  // free-delivery threshold itself, so the snapshot stays the raw fee.
  const deliveryFeeApplied =
    orderType === "DELIVERY" ? roundMoney(settings?.deliveryFee) : 0;
  let deliveryFee = 0;
  if (orderType === "DELIVERY") {
    const threshold = roundMoney(settings?.freeDeliveryThreshold);
    // Same rule as computeTotals: threshold compares against subtotal.
    if (!(threshold > 0 && subtotal >= threshold)) {
      deliveryFee = deliveryFeeApplied;
    }
  }

  const grandTotal =
    subtotal - clampedDiscount + tax + serviceCharge + deliveryFee;

  return {
    subtotal,
    discount: clampedDiscount,
    tax,
    serviceCharge,
    deliveryFee,
    grandTotal,
    taxRateApplied,
    serviceChargeRateApplied,
    deliveryFeeApplied,
  };
}
