// SAVE AS: app/counter/page.jsx
// Counter home: table map, active orders, and pending table flags.
// Server-rendered; roles admin, cashier (kitchen/riders are redirected
// to their own homes). The page wraps AppShell itself, following the
// locked pattern from app/dashboard/layout.jsx. searchParams filters
// (status/type) apply to the active-orders list only; the table map
// always shows every active table. Client affordances (auto-refresh,
// flag clearing) live in components/CounterClient.jsx.

import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { Badge, EmptyState, Icon, PageHeader, StatCard } from "@/components/ui";
import { ClearFlagsButton, CounterRefreshControls } from "@/components/CounterClient";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatPKR } from "@/lib/format";

const OPEN_STATUSES = ["RECEIVED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];
const ORDER_STATUSES = [...OPEN_STATUSES, "COMPLETED", "CANCELLED"];
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
const TYPE_LABELS = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};
const TYPE_TONES = { DINE_IN: "orange", TAKEAWAY: "blue", DELIVERY: "green" };

function statusBadge(status) {
  return <Badge tone={STATUS_TONES[status] || "slate"}>{STATUS_LABELS[status] || status}</Badge>;
}

export default async function CounterPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "kitchen") redirect("/kitchen");
  if (user.role === "rider") redirect("/delivery");

  const params = (await searchParams) || {};
  const statusFilter = ORDER_STATUSES.includes(params.status) ? params.status : "";
  const typeFilter = ORDER_TYPES.includes(params.type) ? params.type : "";

  const settings = await getSettings();
  const money = (amount) => formatPKR(amount, settings.currency);

  const [tables, openOrders, flagOrders] = await Promise.all([
    prisma.table.findMany({
      where: { isActive: true },
      orderBy: [{ code: "asc" }],
    }),
    prisma.order.findMany({
      where: { status: { in: OPEN_STATUSES } },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        orderNumber: true,
        type: true,
        status: true,
        tableId: true,
        grandTotal: true,
        waiterCalledAt: true,
        billRequestedAt: true,
      },
    }),
    prisma.order.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        OR: [{ waiterCalledAt: { not: null } }, { billRequestedAt: { not: null } }],
      },
      orderBy: [{ createdAt: "asc" }],
      include: { table: { select: { code: true, name: true } } },
    }),
  ]);

  const openByTable = new Map();
  for (const order of openOrders) {
    if (order.tableId && !openByTable.has(order.tableId)) {
      openByTable.set(order.tableId, order);
    }
  }

  const listWhere = {};
  if (statusFilter) listWhere.status = statusFilter;
  else listWhere.status = { in: OPEN_STATUSES };
  if (typeFilter) listWhere.type = typeFilter;
  const activeOrders = await prisma.order.findMany({
    where: listWhere,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    include: {
      table: { select: { code: true, name: true } },
      payments: { select: { amount: true, status: true } },
    },
  });

  const occupiedCount = tables.filter((table) => table.status === "OCCUPIED").length;
  const shellUser = { name: user.name, email: user.email, role: user.role };

  return (
    <AppShell user={shellUser}>
      <div className="space-y-6">
        <PageHeader
          title="Counter"
          description="Tables, active orders, and tables asking for help."
          actions={
            <>
              <CounterRefreshControls />
              <Link href="/orders/new" className="btn btn-primary">
                <Icon name="plus" className="h-4 w-4" />
                New order
              </Link>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Free tables" value={tables.length - occupiedCount} icon="table" tone="green" />
          <StatCard title="Occupied tables" value={occupiedCount} icon="table" tone="orange" />
          <StatCard title="Open orders" value={openOrders.length} icon="receipt" tone="blue" />
          <StatCard
            title="Tables needing attention"
            value={flagOrders.length}
            hint="Waiter called or bill requested"
            icon="bell"
            tone="amber"
          />
        </div>

        {flagOrders.length > 0 ? (
          <section className="card card-pad space-y-3 border-amber-300 bg-amber-50">
            <h2 className="section-title">Tables needing attention</h2>
            <ul className="space-y-2">
              {flagOrders.map((order) => (
                <li
                  key={order.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {order.table ? `${order.table.name} (${order.table.code})` : order.orderNumber}
                      <span className="font-normal text-slate-500"> — {order.orderNumber}</span>
                    </p>
                    <p className="text-sm text-slate-600">
                      {[
                        order.waiterCalledAt
                          ? `Waiter called ${formatDateTime(order.waiterCalledAt)}`
                          : null,
                        order.billRequestedAt
                          ? `Bill requested ${formatDateTime(order.billRequestedAt)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/orders/${order.id}`} className="btn btn-secondary btn-sm">
                      Open order
                    </Link>
                    <ClearFlagsButton orderId={order.id} orderNumber={order.orderNumber} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="section-title">Tables</h2>
          {tables.length === 0 ? (
            <EmptyState
              icon="table"
              title="No tables yet"
              description="Add tables in Tables before seating dine-in orders."
              action={
                <Link href="/tables" className="btn btn-secondary">
                  Manage tables
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tables.map((table) => {
                const openOrder = openByTable.get(table.id);
                const occupied = table.status === "OCCUPIED" || Boolean(openOrder);
                return (
                  <article key={table.id} className="card card-pad space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">
                          {table.name}{" "}
                          <span className="font-normal text-slate-500">({table.code})</span>
                        </p>
                        <p className="text-sm text-slate-500">{table.seats} seats</p>
                      </div>
                      <Badge tone={occupied ? "orange" : "green"}>
                        {occupied ? "Occupied" : "Free"}
                      </Badge>
                    </div>
                    {openOrder ? (
                      <div className="space-y-1 text-sm">
                        <p className="text-slate-700">
                          Open order{" "}
                          <Link href={`/orders/${openOrder.id}`} className="link">
                            {openOrder.orderNumber}
                          </Link>{" "}
                          — {money(openOrder.grandTotal)}
                        </p>
                        <p>{statusBadge(openOrder.status)}</p>
                        {openOrder.waiterCalledAt || openOrder.billRequestedAt ? (
                          <p className="flex flex-wrap gap-1.5">
                            {openOrder.waiterCalledAt ? (
                              <Badge tone="amber">Waiter called</Badge>
                            ) : null}
                            {openOrder.billRequestedAt ? (
                              <Badge tone="amber">Bill requested</Badge>
                            ) : null}
                          </p>
                        ) : null}
                        <Link href={`/orders/${openOrder.id}`} className="btn btn-secondary btn-sm">
                          Open order
                        </Link>
                      </div>
                    ) : (
                      <Link
                        href={`/orders/new?table=${encodeURIComponent(table.code)}`}
                        className="btn btn-primary btn-sm"
                      >
                        <Icon name="plus" className="h-4 w-4" />
                        New order for {table.code}
                      </Link>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="section-title">Active orders</h2>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="counter-status" className="label">
                Status
              </label>
              <select
                id="counter-status"
                name="status"
                defaultValue={statusFilter}
                className="input w-auto"
              >
                <option value="">Open orders</option>
                {ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="counter-type" className="label">
                Type
              </label>
              <select
                id="counter-type"
                name="type"
                defaultValue={typeFilter}
                className="input w-auto"
              >
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
            {statusFilter || typeFilter ? (
              <Link href="/counter" className="btn btn-ghost">
                Clear filters
              </Link>
            ) : null}
          </form>

          {activeOrders.length === 0 ? (
            <EmptyState
              icon="receipt"
              title="No orders match"
              description="No orders match the current filters."
              action={
                <Link href="/orders/new" className="btn btn-primary">
                  New order
                </Link>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Table</th>
                    <th className="text-right">Total</th>
                    <th>Placed</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <Link href={`/orders/${order.id}`} className="link font-semibold">
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td>
                        <Badge tone={TYPE_TONES[order.type] || "slate"}>
                          {TYPE_LABELS[order.type] || order.type}
                        </Badge>
                      </td>
                      <td>{statusBadge(order.status)}</td>
                      <td>{order.table ? `${order.table.name} (${order.table.code})` : "—"}</td>
                      <td className="text-right font-medium">{money(order.grandTotal)}</td>
                      <td className="whitespace-nowrap">{formatDateTime(order.createdAt)}</td>
                      <td>
                        <Link href={`/orders/${order.id}`} className="link">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
