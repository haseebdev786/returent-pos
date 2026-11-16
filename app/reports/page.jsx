// SAVE AS: app/reports/page.jsx
// Sales reports (admin/cashier). Wraps AppShell itself, following the
// dashboard-layout pattern. Kitchen/rider staff get an honest
// access-denied message inside the shell and NO data is fetched for
// them.
//
// Date range: ?from=YYYY-MM-DD&to=YYYY-MM-DD, both days fully included
// ([from 00:00 local, day-after-to 00:00 local)). Defaults to the last
// 30 days including today. An invalid or reversed range falls back to
// the default range with an honest notice — never a silent empty page.
//
// Sales figures count COMPLETED bills only; cancelled bills are
// excluded from sales figures and listed in their own section. There
// is no cost data in V1, so this page reports sales only.

import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole, homeForRole, homeLabelForRole, ROLE_LABELS } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { formatDate, formatPKR, todayKey } from "@/lib/format";
import {
  getCancelledOrders,
  getPaymentBreakdown,
  getSalesSummary,
  getTopItems,
  getTypeBreakdown,
  nextDayStart,
  parseLocalDateKey,
} from "@/lib/reports-data";
import { EmptyState, PageHeader, StatCard } from "@/components/ui";
import ReportsPrintButton from "@/components/ReportsPrintButton";

const TYPE_LABELS = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

const METHOD_LABELS = {
  CASH: "Cash",
  CARD: "Card",
  JAZZCASH: "JazzCash",
  EASYPAISA: "Easypaisa",
  COD: "Cash on delivery",
};

export default async function ReportsPage({ searchParams }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const shellUser = { name: user.name, email: user.email, role: user.role };

  if (!hasRole(user, ["admin", "cashier"])) {
    const homeHref = homeForRole(user.role);
    const homeLabel = homeLabelForRole(user.role);
    return (
      <AppShell user={shellUser}>
        <div className="space-y-4">
          <PageHeader
            title="Reports"
            description="Sales summaries, breakdowns and cancelled bills."
          />
          <EmptyState
            icon="ban"
            title="Access denied"
            description={`Reports are available to admin and cashier staff. You are signed in as ${ROLE_LABELS[user.role] ?? user.role}.`}
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
  const currency = settings.currency;

  // Resolve the range. Defaults: last 30 days including today.
  const now = new Date();
  const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const defaultFrom = new Date(
    defaultTo.getFullYear(),
    defaultTo.getMonth(),
    defaultTo.getDate() - 29,
  );
  let from = parseLocalDateKey(sp.from);
  let to = parseLocalDateKey(sp.to);
  let rangeNotice = "";
  if (!from || !to || from > to) {
    from = defaultFrom;
    to = defaultTo;
    if (sp.from !== undefined || sp.to !== undefined) {
      rangeNotice =
        "That date range was not valid, so the last 30 days are shown instead.";
    }
  }
  const toExclusive = nextDayStart(to);
  const fromKey = todayKey(from);
  const toKey = todayKey(to);

  const [summary, typeBreakdown, paymentBreakdown, topItems, cancelled] =
    await Promise.all([
      getSalesSummary(prisma, from, toExclusive),
      getTypeBreakdown(prisma, from, toExclusive),
      getPaymentBreakdown(prisma, from, toExclusive),
      getTopItems(prisma, from, toExclusive, 10),
      getCancelledOrders(prisma, from, toExclusive),
    ]);

  return (
    <AppShell user={shellUser}>
      <div className="space-y-4">
        <PageHeader
          title="Reports"
          description={`Showing ${formatDate(from)} – ${formatDate(to)} (both days included). Cancelled bills are excluded from sales figures.`}
          actions={
            <div className="no-print flex flex-wrap gap-2">
              <a
                href={`/api/reports/export?from=${fromKey}&to=${toKey}`}
                className="btn btn-secondary"
              >
                Export CSV
              </a>
              <ReportsPrintButton />
            </div>
          }
        />

        {rangeNotice ? <p className="form-error">{rangeNotice}</p> : null}

        <form
          method="get"
          action="/reports"
          className="card card-pad no-print flex flex-wrap items-end gap-3"
        >
          <div>
            <label htmlFor="report-from" className="label">
              From
            </label>
            <input
              id="report-from"
              name="from"
              type="date"
              required
              defaultValue={fromKey}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="report-to" className="label">
              To
            </label>
            <input
              id="report-to"
              name="to"
              type="date"
              required
              defaultValue={toKey}
              className="input"
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Show reports
          </button>
        </form>

        <section aria-label="Sales summary">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Bills"
              value={String(summary.bills)}
              hint="Completed bills in this period."
              icon="receipt"
              tone="orange"
            />
            <StatCard
              title="Gross sales"
              value={formatPKR(summary.grossSales, currency)}
              hint="Sum of order subtotals, before discounts and charges."
              icon="chart"
              tone="blue"
            />
            <StatCard
              title="Discounts"
              value={formatPKR(summary.discounts, currency)}
              hint="Total discounts given on completed bills."
              icon="return"
              tone="amber"
            />
            <StatCard
              title="Tax"
              value={formatPKR(summary.tax, currency)}
              hint="Total tax charged on completed bills."
              icon="wallet"
              tone="slate"
            />
            <StatCard
              title="Service charge"
              value={formatPKR(summary.serviceCharge, currency)}
              hint="Total service charge on completed bills."
              icon="bell"
              tone="slate"
            />
            <StatCard
              title="Delivery fees"
              value={formatPKR(summary.deliveryFees, currency)}
              hint="Total delivery fees on completed bills."
              icon="bike"
              tone="green"
            />
            <StatCard
              title="Grand total"
              value={formatPKR(summary.grandTotal, currency)}
              hint="Sum of completed bill totals in this period."
              icon="cash"
              tone="orange"
            />
          </div>
          <p className="form-note mt-3">
            Sales figures count completed bills only. Cancelled bills are
            excluded from sales figures and listed separately below.
          </p>
        </section>

        <section className="card card-pad">
          <h2 className="section-title">Sales by order type</h2>
          <p className="section-desc">Completed bills per order type.</p>
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
          <h2 className="section-title">Payments by method</h2>
          <p className="section-desc">
            Paid payments on completed bills in this period, counted by the
            bill&apos;s date.
          </p>
          <div className="table-wrap mt-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col">Payments</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {paymentBreakdown.map((row) => (
                  <tr key={row.method}>
                    <td>{METHOD_LABELS[row.method] ?? row.method}</td>
                    <td>{row.payments}</td>
                    <td>{formatPKR(row.amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card card-pad">
          <h2 className="section-title">Top items</h2>
          <p className="section-desc">
            Best sellers from completed bills, by revenue.
          </p>
          {topItems.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              No items sold in this period.
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
          <h2 className="section-title">Cancelled orders</h2>
          <p className="section-desc">
            Cancelled bills in this period. These are excluded from every
            sales figure above.
          </p>
          {cancelled.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              No cancelled orders in this period.
            </p>
          ) : (
            <div className="table-wrap mt-3">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Date</th>
                    <th scope="col">Type</th>
                    <th scope="col">Total</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {cancelled.map((order) => (
                    <tr key={order.orderNumber}>
                      <td className="font-medium">{order.orderNumber}</td>
                      <td>{formatDate(order.createdAt)}</td>
                      <td>{TYPE_LABELS[order.type] ?? order.type}</td>
                      <td>{formatPKR(order.grandTotal, currency)}</td>
                      <td>{order.cancelledReason || "No reason recorded"}</td>
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
