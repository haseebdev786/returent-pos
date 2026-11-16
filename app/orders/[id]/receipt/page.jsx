// SAVE AS: app/orders/[id]/receipt/page.jsx
// Standalone print page for an order receipt. NO AppShell — the page
// is only the receipt plus a .no-print toolbar (Back + Print), so
// nothing but the 80mm receipt reaches the printer. Server-rendered;
// roles admin, cashier. The @page rule below is scoped to THIS page
// only: app/globals.css deliberately carries no global @page rule
// (it would change margins for every printout), and documents that
// receipt printing sets its own page setup in the print view.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Icon } from "@/components/ui";
import PrintButton from "@/components/PrintButton";
import Receipt from "@/components/Receipt";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { prisma } from "@/lib/prisma";

export default async function ReceiptPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "kitchen") redirect("/kitchen");
  if (user.role === "rider") redirect("/delivery");

  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) notFound();

  const [order, settings] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      include: {
        table: { select: { id: true, code: true, name: true } },
        batches: {
          orderBy: { batchNumber: "asc" },
          include: {
            items: {
              orderBy: { id: "asc" },
              include: { addons: { orderBy: { id: "asc" } } },
            },
          },
        },
        payments: { orderBy: { createdAt: "asc" } },
      },
    }),
    getSettings(),
  ]);
  if (!order) notFound();

  return (
    <main className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <style>{`@page { size: 80mm auto; margin: 0; }`}</style>
      <div className="no-print mx-auto mb-4 flex w-full max-w-2xl flex-wrap items-center justify-between gap-2 px-4">
        <Link href={`/orders/${order.id}`} className="btn btn-secondary">
          <Icon name="arrowLeft" className="h-4 w-4" />
          Back to order
        </Link>
        <PrintButton />
      </div>
      <div className="mx-auto w-fit shadow-card print:shadow-none">
        <Receipt order={order} settings={settings} />
      </div>
    </main>
  );
}
