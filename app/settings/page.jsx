// SAVE AS: app/settings/page.jsx
// Settings page — admin only. Wraps AppShell itself, following the
// dashboard-layout pattern. Non-admin staff get an honest
// access-denied message inside the shell and NO settings data is
// fetched for them. Loads the merged Settings (defaults fill any
// missing row) and renders the client form with plain, serializable
// initial values — no Dates cross to the client.

import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getCurrentUser, hasRole, ROLE_LABELS } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { EmptyState, PageHeader } from "@/components/ui";
import SettingsForm from "@/components/SettingsForm";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const shellUser = { name: user.name, email: user.email, role: user.role };

  if (!hasRole(user, "admin")) {
    const homeHref =
      user.role === "kitchen"
        ? "/kitchen"
        : user.role === "rider"
          ? "/delivery"
          : "/dashboard";
    const homeLabel =
      user.role === "kitchen"
        ? "Kitchen display"
        : user.role === "rider"
          ? "Delivery"
          : "Dashboard";
    return (
      <AppShell user={shellUser}>
        <div className="space-y-4">
          <PageHeader
            title="Settings"
            description="Restaurant details, taxes, charges and receipt options."
          />
          <EmptyState
            icon="ban"
            title="Access denied"
            description={`Settings are available to admins only. You are signed in as ${ROLE_LABELS[user.role] ?? user.role}.`}
            action={
              <Link href={homeHref} className="btn btn-primary">
                Go to {homeLabel}
              </Link>
            }
          />
        </div>
      </AppShell>
    );
  }

  const settings = await getSettings();
  const initialSettings = {
    restaurantName: settings.restaurantName ?? "",
    address: settings.address ?? "",
    phone: settings.phone ?? "",
    currency: settings.currency ?? "",
    taxRate: settings.taxRate ?? 0,
    taxEnabled: settings.taxEnabled ?? false,
    serviceChargeRate: settings.serviceChargeRate ?? 0,
    serviceChargeEnabled: settings.serviceChargeEnabled ?? false,
    deliveryFee: settings.deliveryFee ?? 0,
    freeDeliveryThreshold: settings.freeDeliveryThreshold ?? 0,
    minOrderAmount: settings.minOrderAmount ?? 0,
    publicUrl: settings.publicUrl ?? "",
    receiptFooter: settings.receiptFooter ?? "",
  };

  return (
    <AppShell user={shellUser}>
      <div className="space-y-4">
        <PageHeader
          title="Settings"
          description="Restaurant details, taxes, charges and receipt options. Changes apply to new orders."
        />
        <SettingsForm initialSettings={initialSettings} />
      </div>
    </AppShell>
  );
}
