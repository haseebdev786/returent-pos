// SAVE AS: app/customers/[id]/page.jsx
// Customer detail (admin/cashier). Wraps AppShell itself, following the
// dashboard-layout pattern. Kitchen/rider staff get an honest
// access-denied message inside the shell and NO data is fetched for
// them. Unknown or invalid ids return the standard 404 page.
//
// The customer's orders are matched by phone number (Order has no
// customer foreign key), newest first, 20 per page. The totals shown
// are the lifetime totals stored on the Customer row itself.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole, ROLE_LABELS } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { formatDate, formatDateTime, formatPKR } from "@/lib/format";
import { Badge, EmptyState, PageHeader, StatCard } from "@/components/ui";

const PAGE_SIZE = 20;

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

export default async function CustomerDetailPage({ params, searchParams }) {
  const { id: idParam } = await params;
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const shellUser = { name: user.name, email: user.email, role: user.role };

  if (!hasRole(user, ["admin", "cashier"])) {
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
            title="Customer"
            description="Customer record and order history."
          />
          <EmptyState
            icon="ban"
            title="Access denied"
            description={`Customer records are available to admin and cashier staff. You are signed in as ${ROLE_LABELS[user.role] ?? user.role}.`}
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

  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) notFound();

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      phone: true,
      name: true,
      address: true,
      totalOrders: true,
      totalSpent: true,
      createdAt: true,
    },
  });
  if (!customer) notFound();

  const settings = await getSettings();
  const currency = settings.currency;

  const where = { customerPhone: customer.phone };
  const total = await prisma.order.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requestedPage = Number.parseInt(sp.page, 10);
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, totalPages)
      : 1;

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      orderNumber: true,
      type: true,
      status: true,
      grandTotal: true,
      createdAt: true,
    },
  });

  function hrefFor(nextPage) {
    return nextPage > 1
      ? `/customers/${customer.id}?page=${nextPage}`
      : `/customers/${customer.id}`;
  }

  return (
    <AppShell user={shellUser}>
      <div className="space-y-4">
        <PageHeader
          title={customer.name || customer.phone}
          description={
            customer.name ? customer.phone : "No name saved for this customer."
          }
          actions={
            <Link href="/customers" className="btn btn-secondary">
              Back to customers
            </Link>
          }
        />

        {customer.address ? (
          <p className="text-sm text-slate-600">{customer.address}</p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            title="Total orders"
            value={String(customer.totalOrders)}
            hint="Lifetime total on this customer record."
            icon="receipt"
            tone="orange"
          />
          <StatCard
            title="Total spent"
            value={formatPKR(customer.totalSpent, currency)}
            hint="Lifetime total on this customer record."
            icon="wallet"
            tone="green"
          />
          <StatCard
            title="Customer since"
            value={formatDate(customer.createdAt)}
            hint="Date the customer record was created."
            icon="calendar"
            tone="blue"
          />
        </div>

        <p className="form-note">
          Totals count completed orders only, as stored on this customer
          record.
        </p>

        <section className="card card-pad">
          <h2 className="section-title">Order history</h2>
          <p className="section-desc">
            Orders placed with phone number {customer.phone}, newest first.
          </p>
          {orders.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">
              No orders found for this phone number yet.
            </p>
          ) : (
            <>
              <div className="table-wrap mt-3">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Date</th>
                      <th scope="col">Type</th>
                      <th scope="col">Status</th>
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td className="font-medium">{order.orderNumber}</td>
                        <td>{formatDateTime(order.createdAt)}</td>
                        <td>{TYPE_LABELS[order.type] ?? order.type}</td>
                        <td>
                          <Badge tone={STATUS_TONES[order.status] ?? "slate"}>
                            {STATUS_LABELS[order.status] ?? order.status}
                          </Badge>
                        </td>
                        <td>{formatPKR(order.grandTotal, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600">
                  Page {page} of {totalPages} · {total}{" "}
                  {total === 1 ? "order" : "orders"}
                </p>
                <div className="flex gap-2">
                  {page > 1 ? (
                    <Link
                      href={hrefFor(page - 1)}
                      className="btn btn-secondary btn-sm"
                    >
                      Previous
                    </Link>
                  ) : (
                    <span
                      className="btn btn-secondary btn-sm pointer-events-none opacity-50"
                      aria-disabled="true"
                    >
                      Previous
                    </span>
                  )}
                  {page < totalPages ? (
                    <Link
                      href={hrefFor(page + 1)}
                      className="btn btn-secondary btn-sm"
                    >
                      Next
                    </Link>
                  ) : (
                    <span
                      className="btn btn-secondary btn-sm pointer-events-none opacity-50"
                      aria-disabled="true"
                    >
                      Next
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}
