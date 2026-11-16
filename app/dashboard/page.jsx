// SAVE AS: app/dashboard/page.jsx
// Staff dashboard. NO AppShell wrap here — app/dashboard/layout.jsx
// provides the shell. The layout only proves the user is logged in;
// this page re-checks the role itself: kitchen and rider staff get an
// honest access-denied message and NO data is fetched for them.
// Unauthenticated users are redirected to /login.
//
// Every figure is a real PostgreSQL figure for today (local day) unless
// labelled otherwise. Sales count COMPLETED bills only (see
// lib/reports-data.js); open orders are shown separately and never
// mixed into revenue. Empty days show 0 with guidance, never demo data.

import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole, homeForRole, homeLabelForRole, ROLE_LABELS } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import {
  formatDate,
  formatDateTime,
  formatPKR,
  todayKey,
} from "@/lib/format";
import {
  getSalesSummary,
  getTopItems,
  getTypeBreakdown,
  nextDayStart,
  parseLocalDateKey,
} from "@/lib/reports-data";
import { Badge, EmptyState, PageHeader, StatCard } from "@/components/ui";

// Open = every status that is neither COMPLETED nor CANCELLED.
const OPEN_STATUSES = ["RECEIVED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];

const TYPE_LABELS = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

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

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Role gate BEFORE any data fetch: kitchen/rider see the message
  // inside the shell (provided by the layout) and nothing else.
  if (!hasRole(user, ["admin", "cashier"])) {
    const homeHref = homeForRole(user.role);
    const homeLabel = homeLabelForRole(user.role);
    return (
      <div className="space-y-4">
        <PageHeader
          title="Dashboard"
          description="Today at a glance: sales, open orders and tables."
        />
        <EmptyState
          icon="ban"
          title="Access denied"
          description={`The dashboard is available to admin and cashier staff. You are signed in as ${ROLE_LABELS[user.role] ?? user.role}.`}
          action={
            <Link href={homeHref} className="btn btn-primary">
              Go to {homeLabel}
            </Link>
          }
        />
      </div>
    );
  }

  const settings = await getSettings();
  const currency = settings.currency;

  // Today = [local midnight today, local midnight tomorrow).
  const todayStart = parseLocalDateKey(todayKey());
  const tomorrowStart = nextDayStart(todayStart);
  // Last 30 days including today, for the top-items list.
  const thirtyDaysAgo = new Date(
    todayStart.getFullYear(),
    todayStart.getMonth(),
    todayStart.getDate() - 29,
  );
  // Last 7 days including today, for the sales strip.
  const sevenDaysAgo = new Date(
    todayStart.getFullYear(),
    todayStart.getMonth(),
    todayStart.getDate() - 6,
  );

  const [
    todaySummary,
    typeBreakdown,
    topItems,
    openOrdersCount,
    waiterCallCount,
    billRequestCount,
    cancelledTodayCount,
    totalTables,
    occupiedTables,
    recentOrders,
    weekOrders,
  ] = await Promise.all([
    getSalesSummary(prisma, todayStart, tomorrowStart),
    getTypeBreakdown(prisma, todayStart, tomorrowStart),
    getTopItems(prisma, thirtyDaysAgo, tomorrowStart, 5),
    prisma.order.count({ where: { status: { in: OPEN_STATUSES } } }),
    prisma.order.count({
      where: {
        status: { in: OPEN_STATUSES },
        waiterCalledAt: { not: null },
      },
    }),
    prisma.order.count({
      where: {
        status: { in: OPEN_STATUSES },
        billRequestedAt: { not: null },
      },
    }),
    prisma.order.count({
      where: {
        status: "CANCELLED",
        createdAt: { gte: todayStart, lt: tomorrowStart },
      },
    }),
    prisma.table.count(),
    prisma.table.findMany({
      where: { status: "OCCUPIED" },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        seats: true,
        currentOrderId: true,
      },
    }),
    prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        orderNumber: true,
        type: true,
        status: true,
        grandTotal: true,
        createdAt: true,
        customerName: true,
        table: { select: { code: true } },
      },
    }),
    prisma.order.findMany({
      where: {
        status: "COMPLETED",
        createdAt: { gte: sevenDaysAgo, lt: tomorrowStart },
      },
      select: { grandTotal: true, createdAt: true },
    }),
  ]);

  // Resolve the denormalised currentOrderId pointers to order numbers
  // in ONE query (no per-table lookup).
  const linkedOrderIds = occupiedTables
    .map((table) => table.currentOrderId)
    .filter((id) => id !== null && id !== undefined);
  const linkedOrders =
    linkedOrderIds.length > 0
      ? await prisma.order.findMany({
          where: { id: { in: linkedOrderIds } },
          select: { id: true, orderNumber: true },
        })
      : [];
  const orderNumberById = new Map(
    linkedOrders.map((order) => [order.id, order.orderNumber]),
  );

  // Last 7 days of completed sales, bucketed by local day for the strip.
  const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const weekTotals = new Map();
  for (const order of weekOrders) {
    const key = dayKey(order.createdAt);
    weekTotals.set(key, (weekTotals.get(key) ?? 0) + order.grandTotal);
  }
  const weekDays = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(
      todayStart.getFullYear(),
      todayStart.getMonth(),
      todayStart.getDate() - i,
    );
    weekDays.push({
      key: dayKey(d),
      label: `${WEEKDAY[d.getDay()]} ${d.getDate()}`,
      total: weekTotals.get(dayKey(d)) ?? 0,
      isToday: i === 0,
    });
  }
  const weekMax = Math.max(1, ...weekDays.map((d) => d.total));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        description={`${settings.restaurantName} · ${formatDate(todayStart)}`}
        actions={
          <>
            <Link href="/counter" className="btn btn-primary">
              New order
            </Link>
            <Link href="/reports" className="btn btn-secondary">
              Reports
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Today's sales"
          value={formatPKR(todaySummary.grandTotal, currency)}
          hint={
            todaySummary.bills === 0
              ? "No sales yet today — completed bills appear here."
              : `${todaySummary.bills} completed ${todaySummary.bills === 1 ? "bill" : "bills"} today.`
          }
          icon="cash"
          tone="orange"
        />
        <StatCard
          title="Open orders"
          value={String(openOrdersCount)}
          hint="Received, preparing, ready or out for delivery."
          icon="receipt"
          tone="blue"
        />
        <StatCard
          title="Occupied tables"
          value={String(occupiedTables.length)}
          hint={`${occupiedTables.length} of ${totalTables} ${totalTables === 1 ? "table" : "tables"} occupied.`}
          icon="table"
          tone="amber"
        />
        <StatCard
          title="Waiter calls"
          value={String(waiterCallCount)}
          hint="Open orders with the waiter flag set."
          icon="bell"
          tone="red"
        />
        <StatCard
          title="Bill requests"
          value={String(billRequestCount)}
          hint="Open orders with the bill flag set."
          icon="wallet"
          tone="green"
        />
        <StatCard
          title="Cancelled today"
          value={String(cancelledTodayCount)}
          hint="Cancelled bills are excluded from sales figures."
          icon="ban"
          tone="slate"
        />
      </div>

      <nav
        aria-label="Quick links"
        className="flex flex-wrap gap-2"
      >
        <Link href="/counter" className="btn btn-secondary">
          Counter
        </Link>
        <Link href="/orders" className="btn btn-secondary">
          Orders
        </Link>
        <Link href="/reports" className="btn btn-secondary">
          Reports
        </Link>
        {hasRole(user, "admin") ? (
          <Link href="/kitchen" className="btn btn-secondary">
            Kitchen display
          </Link>
        ) : null}
      </nav>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="section-title">Sales by type today</h2>
          <p className="section-desc">
            Completed bills only. Cancelled bills are excluded.
          </p>
          {todaySummary.bills === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              No completed sales today yet. Bills count here once they are
              completed.
            </p>
          ) : null}
          <div className="table-wrap mt-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Bills</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {typeBreakdown.map((row) => (
                  <tr key={row.type}>
                    <td>{TYPE_LABELS[row.type] ?? row.type}</td>
                    <td>{row.bills}</td>
                    <td>{formatPKR(row.grandTotal, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card card-pad">
          <h2 className="section-title">Occupied tables</h2>
          <p className="section-desc">
            Tables currently marked occupied, with their open bill.
          </p>
          {occupiedTables.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              All tables are free right now.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {occupiedTables.map((table) => (
                <li
                  key={table.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">
                      {table.code}
                    </span>{" "}
                    <span className="text-sm text-slate-600">
                      {table.name} · {table.seats} seats
                    </span>
                  </span>
                  <span className="text-sm text-slate-700">
                    {table.currentOrderId !== null &&
                    orderNumberById.has(table.currentOrderId)
                      ? orderNumberById.get(table.currentOrderId)
                      : "No open bill linked"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card card-pad">
        <h2 className="section-title">Sales · last 7 days</h2>
        <p className="section-desc">
          Completed bills only, by day. Today is highlighted.
        </p>
        <ul className="mt-4 space-y-2.5">
          {weekDays.map((day) => (
            <li key={day.key} className="flex items-center gap-3 text-sm">
              <span
                className={`w-14 shrink-0 ${day.isToday ? "font-bold text-slate-900" : "text-slate-600"}`}
              >
                {day.label}
              </span>
              <span className="h-5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span
                  className={`block h-full rounded-full ${day.isToday ? "bg-brand-600" : "bg-brand-300"}`}
                  style={{
                    width: `${day.total > 0 ? Math.max(4, Math.round((day.total / weekMax) * 100)) : 0}%`,
                  }}
                />
              </span>
              <span
                className={`w-24 shrink-0 text-right font-medium ${day.isToday ? "text-slate-900" : "text-slate-700"}`}
              >
                {formatPKR(day.total, currency)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card card-pad">
        <h2 className="section-title">Top items · last 30 days</h2>
        <p className="section-desc">
          Best sellers from completed bills, by revenue.
        </p>
        {topItems.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            No completed sales in the last 30 days, so there is no ranking
            yet.
          </p>
        ) : (
          <div className="table-wrap mt-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Item</th>
                  <th scope="col">Sold</th>
                  <th scope="col">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map((item, index) => (
                  <tr key={`${item.menuItemId ?? "none"}-${item.itemName}`}>
                    <td>{index + 1}</td>
                    <td>{item.itemName}</td>
                    <td>{item.qty}</td>
                    <td>{formatPKR(item.revenue, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card-pad">
        <h2 className="section-title">Recent orders</h2>
        <p className="section-desc">The 10 most recent orders, newest first.</p>
        {recentOrders.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon="receipt"
              title="No orders yet"
              description="Orders appear here once the first bill is placed at the counter or from a table QR code."
              action={
                <Link href="/counter" className="btn btn-primary">
                  Go to counter
                </Link>
              }
            />
          </div>
        ) : (
          <div className="table-wrap mt-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Total</th>
                  <th scope="col">Placed</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <span className="font-medium">{order.orderNumber}</span>
                      <span className="block text-xs text-slate-500">
                        {order.table ? `Table ${order.table.code}` : ""}
                        {order.table && order.customerName ? " · " : ""}
                        {order.customerName ?? ""}
                      </span>
                    </td>
                    <td>{TYPE_LABELS[order.type] ?? order.type}</td>
                    <td>
                      <Badge tone={STATUS_TONES[order.status] ?? "slate"}>
                        {STATUS_LABELS[order.status] ?? order.status}
                      </Badge>
                    </td>
                    <td>{formatPKR(order.grandTotal, currency)}</td>
                    <td>{formatDateTime(order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {recentOrders.length > 0 ? (
          <p className="mt-3">
            <Link href="/orders" className="link">
              View all orders
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}
