// SAVE AS: app/page.jsx
// Landing page: the restaurant's public front door. Guests see the
// menu with delivery/takeaway ordering right on the page (the same
// ordering experience as /order, which keeps working for shared
// links). Logged-in staff never see this page — they are redirected
// to their role's home screen (order takers to New order, kitchen to
// the Kitchen display, riders to Delivery, admins to the Dashboard),
// so the restaurant PC opens straight onto the right screen after
// login. No marketing claims here: name, address, and phone all come
// from Settings.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, homeForRole } from "@/lib/session";
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

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeForRole(user.role));

  const [settings, menu] = await Promise.all([
    getPublicSettings(),
    getPublishedMenu(),
  ]);
  const plain = plainSettings(settings);

  return (
    <div>
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <p className="text-sm font-bold tracking-tight">{plain.restaurantName}</p>
          <div className="flex items-center gap-3 text-sm">
            {plain.phone ? (
              <a href={`tel:${plain.phone}`} className="text-slate-300 hover:text-white">
                {plain.phone}
              </a>
            ) : null}
            <Link
              href="/login"
              className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
            >
              Staff login
            </Link>
          </div>
        </div>
      </header>
      <PublicOrderClient menu={menu} settings={plain} />
    </div>
  );
}
