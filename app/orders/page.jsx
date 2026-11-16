// SAVE AS: app/orders/page.jsx
// Staff order list: paginated, filterable by status/type/search.
// Server-rendered; roles admin, cashier. Filters and pagination use
// plain GET links/forms (no client JS) so the list works with zero
// hydration. Page size is 20. Search matches order number, customer
// phone, or customer name — the same match as GET /api/orders.

import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { Badge, EmptyState, Icon, PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatPKR } from "@/lib/format";

const PAGE_SIZE = 20;
const ORDER_STATUSES = [
  "RECEIVED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
];
const ORDER_TYPES = ["DINE_IN", "TAKEAWAY", "DELIVERY"];

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
const TYPE_LABELS = { DINE_IN: "Dine-in", TAKEAWAY: "Takeaway", DELIVERY: "Delivery" };
const TYPE_TONES = { DINE_IN: "orange", TAKEAWAY: "blue", DELIVERY: "green" };
const PAYMENT_LABELS = { UNPAID: "Unpaid", PAID: "Paid", REFUNDED: "Refunded" };
const PAYMENT_TONES = { UNPAID: "amber", PAID: "green", REFUNDED: "slate" };

function pageHref(base, page) {
  const params = new URLSearchParams(base);
  params.set("page", String(page));
  return `/orders?${params.toString()}`;
}

export default async function OrdersPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "kitchen") redirect("/kitchen");
  if (user.role === "rider") redirect("/delivery");

  const params = (await searchParams) || {};
  const statusFilter = ORDER_STATUSES.includes(params.status) ? params.status : "";
  const typeFilter = ORDER_TYPES.includes(params.type) ? params.type : "";
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const page = Math.max(1, Number.parseInt(params.page || "1", 10) || 1);

  const settings = await getSettings();
  const money = (amount) => formatPKR(amount, settings.currency);

  const where = {};
  if (statusFilter) where.status = statusFilter;
  if (typeFilter) where.type = typeFilter;
  if (q) {
    where.OR = [
      { orderNumber: { contains: q, mode: "insensitive" } },
      { customerPhone: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        table: { select: { code: true, name: true } },
        payments: { select: { amount: true, status: true } },
        _count: { select: { batches: true } },
      },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const baseParams = {};
  if (statusFilter) baseParams.status = statusFilter;
  if (typeFilter) baseParams.type = typeFilter;
  if (q) baseParams.q = q;

  const shellUser = { name: user.name, email: user.email, role: user.role };

  return (
    <AppShell user={shellUser}>
      <div className="space-y-5">
        <PageHeader
          title="Orders"
          description={`${total} order${total === 1 ? "" : "s"}${statusFilter || typeFilter || q ? " matching the current filters" : ""}.`}
          actions={
            <Link href="/orders/new" className="btn btn-primary">
              <Icon name="plus" className="h-4 w-4" />
              New order
            </Link>
          }
        />

        <form method="get" className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="orders-q" className="label">
              Search
            </label>
            <input
              id="orders-q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Order number, phone, or name"
              className="input w-64 max-w-full"
            />
          </div>
          <div>
            <label htmlFor="orders-status" className="label">
              Status
            </label>
            <select id="orders-status" name="status" defaultValue={statusFilter} className="input w-auto">
              <option value="">All statuses</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="orders-type" className="label">
              Type
            </label>
            <select id="orders-type" name="type" defaultValue={typeFilter} className="input w-auto">
              <option value="">All types</option>
              {ORDER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-secondary">
            Filter
          </button>
          {statusFilter || typeFilter || q ? (
            <Link href="/orders" className="btn btn-ghost">
              Clear filters
            </Link>
          ) : null}
        </form>

        {orders.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="No orders found"
            description={
              statusFilter || typeFilter || q
                ? "No orders match the current filters."
                : "No orders yet. Create the first order from the counter."
            }
            action={
              <Link href="/orders/new" className="btn btn-primary">
                New order
              </Link>
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Customer</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Due</th>
                    <th>Placed</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const paidTotal = order.payments.reduce(
                      (sum, payment) =>
                        payment.status === "PAID" ? sum + payment.amount : sum,
                      0,
                    );
                    const remaining = Math.max(0, order.grandTotal - paidTotal);
                    return (
                      <tr key={order.id}>
                        <td>
                          <Link href={`/orders/${order.id}`} className="link font-semibold">
                            {order.orderNumber}
                          </Link>
                          <span className="block text-xs text-slate-500">
                            {order._count.batches} batch{order._count.batches === 1 ? "" : "es"}
                            {order.table ? ` · ${order.table.name} (${order.table.code})` : ""}
                          </span>
                        </td>
                        <td>
                          <Badge tone={TYPE_TONES[order.type] || "slate"}>
                            {TYPE_LABELS[order.type] || order.type}
                          </Badge>
                        </td>
                        <td>
                          <Badge tone={STATUS_TONES[order.status] || "slate"}>
                            {STATUS_LABELS[order.status] || order.status}
                          </Badge>
                        </td>
                        <td>
                          <Badge tone={PAYMENT_TONES[order.paymentStatus] || "slate"}>
                            {PAYMENT_LABELS[order.paymentStatus] || order.paymentStatus}
                          </Badge>
                        </td>
                        <td>
                          {order.customerName || order.customerPhone ? (
                            <>
                              <span className="block">{order.customerName || "—"}</span>
                              <span className="block text-xs text-slate-500">
                                {order.customerPhone || ""}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="text-right font-medium">{money(order.grandTotal)}</td>
                        <td className="text-right">{remaining > 0 ? money(remaining) : "—"}</td>
                        <td className="whitespace-nowrap">{formatDateTime(order.createdAt)}</td>
                        <td>
                          <Link href={`/orders/${order.id}`} className="link">
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <nav aria-label="Order pages" className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-600">
                Page {page} of {totalPages}
              </p>
              <p className="flex gap-2">
                {page > 1 ? (
                  <Link href={pageHref(baseParams, page - 1)} className="btn btn-secondary btn-sm">
                    Previous
                  </Link>
                ) : (
                  <span className="btn btn-secondary btn-sm pointer-events-none opacity-50">
                    Previous
                  </span>
                )}
                {page < totalPages ? (
                  <Link href={pageHref(baseParams, page + 1)} className="btn btn-secondary btn-sm">
                    Next
                  </Link>
                ) : (
                  <span className="btn btn-secondary btn-sm pointer-events-none opacity-50">
                    Next
                  </span>
                )}
              </p>
            </nav>
          </>
        )}
      </div>
    </AppShell>
  );
}
