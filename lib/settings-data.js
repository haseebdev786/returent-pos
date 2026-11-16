// SAVE AS: lib/settings-data.js
// Single-row Settings (id = 1) with safe defaults. UI code must NEVER
// hardcode the restaurant name, tax, or fees — always read Settings
// (via getSettings) so the admin panel stays the one source of truth.
// Reads go through the 60s cache; a missing row returns defaults, so a
// fresh database renders instead of crashing.

import { prisma } from "@/lib/prisma";
import { getCachedSettings } from "@/lib/cache";

export const SETTING_DEFAULTS = {
  restaurantName: "My Restaurant",
  currency: "Rs",
  taxRate: 0,
  taxEnabled: false,
  serviceChargeRate: 0,
  serviceChargeEnabled: false,
  deliveryFee: 0,
  freeDeliveryThreshold: 0,
  minOrderAmount: 0,
  receiptFooter: "Thank you! Visit again.",
  address: null,
  phone: null,
  publicUrl: null,
};

async function fetchSettingsRow() {
  try {
    return await prisma.setting.findUnique({ where: { id: 1 } });
  } catch {
    return null;
  }
}

export async function getSettings() {
  const row = await getCachedSettings(fetchSettingsRow);
  if (!row) return { ...SETTING_DEFAULTS };
  return { ...SETTING_DEFAULTS, ...row };
}

/**
 * Same values as getSettings, safe for public pages: Settings hold no
 * secrets, so public ordering pages may read the same merged object.
 * Kept as a separate export so later phases can restrict fields here
 * without touching every public caller.
 */
export async function getPublicSettings() {
  return getSettings();
}
