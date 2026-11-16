// SAVE AS: app/api/public/menu/route.js
// Public menu read for QR / online ordering pages. No auth: the menu is
// public by design. Returns the public Settings (restaurant name,
// currency, tax/fee config — no secrets live in Settings) plus the
// published menu from the 60s cache. Generous rate limit: this endpoint
// is hit on every customer page load.

import { getPublishedMenu } from "@/lib/menu-data";
import { getPublicSettings } from "@/lib/settings-data";
import { checkRateLimit } from "@/lib/rate-limit";

function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
}

function publicSettingsShape(settings) {
  return {
    restaurantName: settings.restaurantName,
    address: settings.address ?? null,
    phone: settings.phone ?? null,
    currency: settings.currency,
    taxRate: settings.taxRate,
    taxEnabled: settings.taxEnabled,
    serviceChargeRate: settings.serviceChargeRate,
    serviceChargeEnabled: settings.serviceChargeEnabled,
    deliveryFee: settings.deliveryFee,
    freeDeliveryThreshold: settings.freeDeliveryThreshold,
    minOrderAmount: settings.minOrderAmount,
    publicUrl: settings.publicUrl ?? null,
    receiptFooter: settings.receiptFooter ?? null,
  };
}

export async function GET(request) {
  const { allowed } = await checkRateLimit(
    `ratelimit:public-menu:${clientIp(request)}`,
    120,
    60,
  );
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please try again in a moment." },
      { status: 429 },
    );
  }

  const [settings, menu] = await Promise.all([
    getPublicSettings(),
    getPublishedMenu(),
  ]);

  return Response.json({
    settings: publicSettingsShape(settings),
    menu,
  });
}
