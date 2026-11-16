// SAVE AS: app/order/page.jsx
// Public online ordering page (takeaway / delivery). No login. Loads
// the public Settings and the published menu; all ordering UI lives in
// components/PublicOrderClient.jsx. After placing an order the client
// redirects to /order/[id]?token=... (the tracking page).

import { getPublicSettings } from "@/lib/settings-data";
import { getPublishedMenu } from "@/lib/menu-data";
import PublicOrderClient from "@/components/PublicOrderClient";

function plainSettings(settings) {
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

export default async function PublicOrderPage() {
  const [settings, menu] = await Promise.all([
    getPublicSettings(),
    getPublishedMenu(),
  ]);

  return (
    <PublicOrderClient menu={menu} settings={plainSettings(settings)} />
  );
}
