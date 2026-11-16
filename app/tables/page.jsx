// SAVE AS: app/tables/page.jsx
// Staff Tables page. Admin + cashier (cashiers need table status for
// the counter; only admins see the create/edit/delete forms — the APIs
// enforce that server-side too). Follows the locked shell pattern: the
// page wraps AppShell itself. Loads every table with its open order
// summary (order number / status / running total).

import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/ui";
import { getCurrentUser, hasRole, homeForRole, homeLabelForRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings-data";
import TablesAdminClient from "@/components/TablesAdminClient";

export default async function TablesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const shellUser = { name: user.name, email: user.email, role: user.role };

  if (!hasRole(user, ["admin", "cashier"])) {
    const homeHref = homeForRole(user.role);
    const homeLabel = homeLabelForRole(user.role);
    return (
      <AppShell user={shellUser}>
        <PageHeader
          title="Tables"
          description="Dining tables and their QR ordering links."
        />
        <p className="form-error mt-4">
          Your role cannot view tables. Ask an admin or cashier for help.
        </p>
        <p className="mt-4">
          <Link href={homeHref} className="btn btn-primary">
            Go to {homeLabel}
          </Link>
        </p>
      </AppShell>
    );
  }

  const settings = await getSettings();
  const tables = await prisma.table.findMany({ orderBy: { code: "asc" } });
  const openIds = tables
    .map((table) => table.currentOrderId)
    .filter((orderId) => orderId !== null);
  const openOrders =
    openIds.length > 0
      ? await prisma.order.findMany({
          where: { id: { in: openIds } },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            grandTotal: true,
          },
        })
      : [];
  const byId = new Map(openOrders.map((order) => [order.id, order]));

  return (
    <AppShell user={shellUser}>
      <PageHeader
        title="Tables"
        description="Dining tables and their QR ordering links. Table status is set by orders, not by hand."
      />
      <TablesAdminClient
        initialTables={tables.map((table) => ({
          ...table,
          openOrder: table.currentOrderId
            ? (byId.get(table.currentOrderId) ?? null)
            : null,
        }))}
        isAdmin={hasRole(user, "admin")}
        currency={settings.currency}
      />
    </AppShell>
  );
}
