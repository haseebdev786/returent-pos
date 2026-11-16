// SAVE AS: app/orders/[id]/page.jsx
// Staff order detail: header, customer/table, items BY BATCH with
// snapshot prices, totals, payments + remaining, and timeline.
// Server-rendered; roles admin, cashier. All mutations live in the
// client component/OrderActions.jsx, which receives a plain serialized
// order object (dates as ISO strings — Date objects cannot cross to
// client components). Missing orders render the 404 page.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { Badge, Icon, PageHeader } from "@/components/ui";
import OrderActions from "@/components/OrderActions";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { getPublishedMenu } from "@/lib/menu-data";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatPKR } from "@/lib/format";

const STATUS_LABELS = {
  RECEIVED: "Received",
  PREPARING: "Preparing",
  READY: "Ready",
  OUT_FOR_DELIVERY: "Out for delivery",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
const STATUS_TONES = {
  RECEIVED: "blue",
  PREPARING: "amber",
  READY: "green",
  OUT_FOR_DELIVERY: "orange",
  COMPLETED: "emerald",
  CANCELLED: "red",
};
const BATCH_LABELS = { RECEIVED: "Received", PREPARING: "Preparing", READY: "Ready" };
const BATCH_TONES = { RECEIVED: "blue", PREPARING: "amber", READY: "green" };
const TYPE_LABELS = { DINE_IN: "Dine-in", TAKEAWAY: "Takeaway", DELIVERY: "Delivery" };
const PAYMENT_LABELS = { UNPAID: "Unpaid", PAID: "Paid", REFUNDED: "Refunded" };
const PAYMENT_TONES = { UNPAID: "amber", PAID: "green", REFUNDED: "slate" };
const METHOD_LABELS = {
  CASH: "Cash",
  CARD: "Card",
  JAZZCASH: "JazzCash",
  EASYPAISA: "EasyPaisa",
  COD: "Cash on delivery",
};

export default async function OrderDetailPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "kitchen") redirect("/kitchen");
  if (user.role === "rider") redirect("/delivery");

  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) notFound();

  const [order, settings, menu, riders] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      include: {
        table: { select: { id: true, code: true, name: true } },
        rider: { select: { id: true, name: true, email: true } },
        batches: {
          orderBy: { batchNumber: "asc" },
          include: {
            items: {
              orderBy: { id: "asc" },
              include: { addons: { orderBy: { id: "asc" } } },
            },
          },
        },
        payments: {
          orderBy: { createdAt: "asc" },
          include: { receivedBy: { select: { id: true, name: true, email: true } } },
        },
      },
    }),
    getSettings(),
    getPublishedMenu(),
    prisma.user.findMany({
      where: { role: "rider", isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);
  if (!order) notFound();

  const money = (amount) => formatPKR(amount, settings.currency);
  const paidTotal = order.payments.reduce(
    (sum, payment) => (payment.status === "PAID" ? sum + payment.amount : sum),
    0,
  );
  const remaining = Math.max(0, order.grandTotal - paidTotal);

  // Plain object for the client actions panel: no Dates, no Prisma
  // values — only the fields the actions need.
  const orderForClient = {
    id: order.id,
    orderNumber: order.orderNumber,
    type: order.type,
    status: order.status,
    paymentStatus: order.paymentStatus,
    subtotal: order.subtotal,
    discount: order.discount,
    discountReason: order.discountReason,
    riderId: order.riderId,
    waiterCalledAt: order.waiterCalledAt ? order.waiterCalledAt.toISOString() : null,
    billRequestedAt: order.billRequestedAt ? order.billRequestedAt.toISOString() : null,
  };

  const shellUser = { name: user.name, email: user.email, role: user.role };

  return (
    <AppShell user={shellUser}>
      <div className="space-y-5">
        <PageHeader
          title={order.orderNumber}
          description={`${TYPE_LABELS[order.type] || order.type} · Placed ${formatDateTime(order.createdAt)}`}
          actions={
            <Link href="/orders" className="btn btn-secondary">
              <Icon name="arrowLeft" className="h-4 w-4" />
              All orders
            </Link>
          }
        />

        <div className="flex flex-wrap gap-2">
          <Badge tone={STATUS_TONES[order.status] || "slate"}>
            {STATUS_LABELS[order.status] || order.status}
          </Badge>
          <Badge tone={PAYMENT_TONES[order.paymentStatus] || "slate"}>
            {PAYMENT_LABELS[order.paymentStatus] || order.paymentStatus}
          </Badge>
          {order.waiterCalledAt ? <Badge tone="amber">Waiter called</Badge> : null}
          {order.billRequestedAt ? <Badge tone="amber">Bill requested</Badge> : null}
          {order.rider ? <Badge tone="green">Rider: {order.rider.name}</Badge> : null}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            <section className="card card-pad space-y-2">
              <h2 className="section-title">Customer &amp; table</h2>
              <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Customer</dt>
                  <dd className="font-medium text-slate-900">{order.customerName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Phone</dt>
                  <dd className="font-medium text-slate-900">
                    {order.customerPhone ? (
                      <a href={`tel:${order.customerPhone}`} className="link">
                        {order.customerPhone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Table</dt>
                  <dd className="font-medium text-slate-900">
                    {order.table ? `${order.table.name} (${order.table.code})` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Delivery address</dt>
                  <dd className="font-medium break-words text-slate-900">
                    {order.deliveryAddress || "—"}
                  </dd>
                </div>
              </dl>
              {order.notes ? (
                <p className="text-sm text-slate-700">
                  <span className="text-slate-500">Notes: </span>
                  {order.notes}
                </p>
              ) : null}
              {order.cancelledReason ? (
                <p className="text-sm text-red-700">
                  Cancellation reason: {order.cancelledReason}
                </p>
              ) : null}
            </section>

            {order.batches.map((batch) => (
              <section key={batch.id} className="card card-pad space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="section-title">Batch {batch.batchNumber}</h2>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">
                      {formatDateTime(batch.createdAt)}
                    </span>
                    <Badge tone={BATCH_TONES[batch.status] || "slate"}>
                      {BATCH_LABELS[batch.status] || batch.status}
                    </Badge>
                  </span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {batch.items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          {item.itemName}
                          {item.variantName ? ` (${item.variantName})` : ""} x {item.quantity}
                        </p>
                        {item.addons.map((addon) => (
                          <p key={addon.id} className="pl-3 text-xs text-slate-500">
                            + {addon.addonName} — {money(addon.price)} each
                          </p>
                        ))}
                        {item.note ? (
                          <p className="pl-3 text-xs text-slate-500">Note: {item.note}</p>
                        ) : null}
                        <p className="text-xs text-slate-500">
                          {money(item.unitPrice)} each + addons
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-slate-900">
                        {money(item.lineTotal)}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <section className="card card-pad space-y-2">
              <h2 className="section-title">Totals</h2>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">Subtotal</dt>
                  <dd>{money(order.subtotal)}</dd>
                </div>
                {order.discount > 0 ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-600">
                      Discount
                      {order.discountReason ? ` (${order.discountReason})` : ""}
                    </dt>
                    <dd>-{money(order.discount)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">
                    Tax{order.taxRateApplied ? ` (${order.taxRateApplied}%)` : ""}
                  </dt>
                  <dd>{money(order.tax)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">
                    Service charge
                    {order.serviceChargeRateApplied
                      ? ` (${order.serviceChargeRateApplied}%)`
                      : ""}
                  </dt>
                  <dd>{money(order.serviceCharge)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">Delivery fee</dt>
                  <dd>{money(order.deliveryFee)}</dd>
                </div>
                <div className="flex justify-between gap-2 border-t border-slate-100 pt-2 text-base font-bold">
                  <dt>Grand total</dt>
                  <dd>{money(order.grandTotal)}</dd>
                </div>
              </dl>
            </section>

            <section className="card card-pad space-y-3">
              <h2 className="section-title">Payments</h2>
              {order.payments.length === 0 ? (
                <p className="section-desc">No payments recorded yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {order.payments.map((payment) => (
                    <li key={payment.id} className="flex justify-between gap-3 py-2 text-sm">
                      <div>
                        <p className="font-medium text-slate-900">
                          {METHOD_LABELS[payment.method] || payment.method}
                          {payment.reference ? ` (${payment.reference})` : ""}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(payment.createdAt)}
                          {payment.receivedBy ? ` · by ${payment.receivedBy.name}` : ""}
                          {payment.status !== "PAID" ? ` · ${payment.status}` : ""}
                        </p>
                      </div>
                      <p className="shrink-0 font-semibold">{money(payment.amount)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-between gap-2 border-t border-slate-100 pt-2 text-sm">
                <span className="text-slate-600">Paid</span>
                <span className="font-semibold">{money(paidTotal)}</span>
              </div>
              <div className="flex justify-between gap-2 text-sm font-bold">
                <span>Remaining</span>
                <span>{money(remaining)}</span>
              </div>
            </section>

            <section className="card card-pad space-y-1 text-sm text-slate-600">
              <h2 className="section-title">Timeline</h2>
              <p>Created: {formatDateTime(order.createdAt)}</p>
              <p>Last updated: {formatDateTime(order.updatedAt)}</p>
              {order.waiterCalledAt ? (
                <p>Waiter called: {formatDateTime(order.waiterCalledAt)}</p>
              ) : null}
              {order.billRequestedAt ? (
                <p>Bill requested: {formatDateTime(order.billRequestedAt)}</p>
              ) : null}
            </section>
          </div>

          <div className="lg:col-span-2">
            <OrderActions
              order={orderForClient}
              menu={menu}
              riders={riders}
              currency={settings.currency}
              paidTotal={paidTotal}
              remaining={remaining}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
