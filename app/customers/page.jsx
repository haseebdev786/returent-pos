// SAVE AS: app/customers/page.jsx
// Customer list (admin/cashier). Wraps AppShell itself, following the
// dashboard-layout pattern: getCurrentUser, redirect to /login when
// logged out, plain {name, email, role} shell user. Kitchen/rider staff
// get an honest access-denied message inside the shell and NO data is
// fetched for them.
//
// Search (?q=) matches phone or name, case-insensitive. Pages hold 20
// customers, most recently updated first. The "last order" date comes
// from ONE grouped Order query for the phones on the current page —
// never one query per customer. It is the newest order of any status
// placed with that phone number.

import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole, homeForRole, homeLabelForRole, ROLE_LABELS } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { formatDate, formatPKR } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";

const PAGE_SIZE = 20;

export default async function CustomersPage({ searchParams }) {
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
            title="Customers"
            description="Customer records, order counts and lifetime spend."
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

  const settings = await getSettings();
  const currency = settings.currency;

  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const where = q
    ? {
        OR: [
          { phone: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const total = await prisma.customer.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requestedPage = Number.parseInt(sp.page, 10);
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, totalPages)
      : 1;

  const customers = await prisma.customer.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      phone: true,
      name: true,
      totalOrders: true,
      totalSpent: true,
    },
  });

  // One grouped query for the newest order per phone on this page.
  const phones = customers.map((customer) => customer.phone);
  const lastOrderRows =
    phones.length > 0
      ? await prisma.order.groupBy({
          by: ["customerPhone"],
          where: { customerPhone: { in: phones } },
          _max: { createdAt: true },
        })
      : [];
  const lastOrderByPhone = new Map(
    lastOrderRows.map((row) => [row.customerPhone, row._max.createdAt]),
  );

  function hrefFor(nextPage) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    return query ? `/customers?${query}` : "/customers";
  }

  return (
    <AppShell user={shellUser}>
      <div className="space-y-4">
        <PageHeader
          title="Customers"
          description="Customer records, order counts and lifetime spend."
        />

        <form
          method="get"
          action="/customers"
          className="flex flex-wrap items-end gap-2"
        >
          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor="customer-search" className="label">
              Search by name or phone
            </label>
            <input
              id="customer-search"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Name or phone number"
              className="input"
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Search
          </button>
          {q ? (
            <Link href="/customers" className="btn btn-secondary">
              Clear
            </Link>
          ) : null}
        </form>

        {customers.length === 0 ? (
          <EmptyState
            icon="users"
            title={q ? "No matching customers" : "No customers yet"}
            description={
              q
                ? `No customer records match “${q}”. Try a different name or phone number.`
                : "No customer records yet. Customer records are created from orders placed with a phone number."
            }
            action={
              q ? (
                <Link href="/customers" className="btn btn-secondary">
                  Clear search
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Phone</th>
                    <th scope="col">Orders</th>
                    <th scope="col">Total spent</th>
                    <th scope="col">Last order</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => {
                    const lastOrderAt = lastOrderByPhone.get(customer.phone);
                    return (
                      <tr key={customer.id}>
                        <td>
                          <Link
                            href={`/customers/${customer.id}`}
                            className="link"
                          >
                            {customer.name || "No name saved"}
                          </Link>
                        </td>
                        <td>
                          <Link
                            href={`/customers/${customer.id}`}
                            className="link"
                          >
                            {customer.phone}
                          </Link>
                        </td>
                        <td>{customer.totalOrders}</td>
                        <td>{formatPKR(customer.totalSpent, currency)}</td>
                        <td>
                          {lastOrderAt
                            ? formatDate(lastOrderAt)
                            : "No orders yet"}
                        </td>
                        <td>
                          <Link
                            href={`/customers/${customer.id}`}
                            className="btn btn-secondary btn-sm"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-600">
                Page {page} of {totalPages} · {total}{" "}
                {total === 1 ? "customer" : "customers"}
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
      </div>
    </AppShell>
  );
}
