// SAVE AS: app/delivery/page.jsx
// Delivery board page. Server-rendered; roles admin, cashier, rider
// (kitchen staff are redirected to /kitchen). The role rule is applied
// SERVER-side when loading orders: riders get only orders assigned to
// them, exactly like GET /api/delivery. The feed shows active delivery
// orders plus orders completed today (local day), newest first. Rider
// assignment controls render only for admin/cashier.

import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/ui";
import DeliveryBoard from "@/components/DeliveryBoard";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { prisma } from "@/lib/prisma";

const ACTIVE_STATUSES = ["RECEIVED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];

export default async function DeliveryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "kitchen") redirect("/kitchen");
  if (!["admin", "cashier", "rider"].includes(user.role)) redirect("/login");

  const settings = await getSettings();

  // Local midnight: "today" follows the shop's wall clock, not UTC.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const where = {
    type: "DELIVERY",
    OR: [
      { status: { in: ACTIVE_STATUSES } },
      { status: "COMPLETED", updatedAt: { gte: todayStart } },
    ],
  };
  if (user.role === "rider") {
    where.riderId = user.id;
  }

  const [rows, riders] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      include: {
        rider: { select: { id: true, name: true, email: true } },
        payments: { select: { amount: true, status: true } },
      },
    }),
    user.role === "rider"
      ? Promise.resolve([])
      : prisma.user.findMany({
          where: { role: "rider", isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true },
        }),
  ]);

  // Plain objects for the client board: Dates become ISO strings.
  const orders = rows.map((order) => {
    const paidTotal = order.payments.reduce(
      (sum, payment) => (payment.status === "PAID" ? sum + payment.amount : sum),
      0,
    );
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      type: order.type,
      status: order.status,
      paymentStatus: order.paymentStatus,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      deliveryAddress: order.deliveryAddress,
      notes: order.notes,
      grandTotal: order.grandTotal,
      riderId: order.riderId,
      rider: order.rider,
      createdAt: order.createdAt.toISOString(),
      paidTotal,
      remaining: Math.max(0, order.grandTotal - paidTotal),
    };
  });

  const shellUser = { name: user.name, email: user.email, role: user.role };
  const canAssign = user.role === "admin" || user.role === "cashier";

  return (
    <AppShell user={shellUser}>
      <div className="space-y-5">
        <PageHeader
          title="Delivery"
          description={
            canAssign
              ? "Active deliveries and orders completed today. Assign riders and track COD collection."
              : "Your assigned deliveries, newest first."
          }
        />
        <DeliveryBoard
          orders={orders}
          riders={riders}
          canAssign={canAssign}
          currency={settings.currency}
        />
      </div>
    </AppShell>
  );
}
