// SAVE AS: app/orders/new/page.jsx
// Staff manual order page. Server-rendered; roles admin, cashier.
// Loads the published menu, active tables, and Settings, then renders
// the client form. Accepts ?table=CODE (from the counter table map) to
// pre-select a dine-in table — the form still validates the table
// server-side on submit.

import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/ui";
import ManualOrderForm from "@/components/ManualOrderForm";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { getPublishedMenu } from "@/lib/menu-data";
import { prisma } from "@/lib/prisma";

export default async function NewOrderPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "kitchen") redirect("/kitchen");
  if (user.role === "rider") redirect("/delivery");

  const params = (await searchParams) || {};
  const initialTableCode = typeof params.table === "string" ? params.table.trim() : "";

  const [menu, tables, settings] = await Promise.all([
    getPublishedMenu(),
    prisma.table.findMany({
      where: { isActive: true },
      orderBy: [{ code: "asc" }],
      select: { id: true, code: true, name: true, seats: true, status: true },
    }),
    getSettings(),
  ]);

  const shellUser = { name: user.name, email: user.email, role: user.role };

  return (
    <AppShell user={shellUser}>
      <div className="space-y-5">
        <PageHeader
          title="New order"
          description="Take an order at the counter for dine-in, takeaway, or delivery."
        />
        <ManualOrderForm
          menu={menu}
          tables={tables}
          settings={settings}
          initialTableCode={initialTableCode}
        />
      </div>
    </AppShell>
  );
}
