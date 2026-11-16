// SAVE AS: app/users/page.jsx
// Staff accounts page — admin only. Wraps AppShell itself, following
// the dashboard-layout pattern. Non-admin staff get an honest
// access-denied message inside the shell and NO staff data is fetched
// for them. Loads the first page of staff (safe fields only — never
// password hashes) and hands it to the client UserForms component,
// which renders the table, the create form, and the per-row controls
// and refreshes through GET /api/users after changes. Dates are
// converted to ISO strings before crossing to the client.

import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole, ROLE_LABELS } from "@/lib/session";
import { EmptyState, PageHeader } from "@/components/ui";
import UserForms from "@/components/UserForms";

const PAGE_SIZE = 20;

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const shellUser = { name: user.name, email: user.email, role: user.role };

  if (!hasRole(user, "admin")) {
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
            title="Users"
            description="Staff accounts and roles."
          />
          <EmptyState
            icon="ban"
            title="Access denied"
            description={`Staff accounts are managed by admins only. You are signed in as ${ROLE_LABELS[user.role] ?? user.role}.`}
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

  const total = await prisma.user.count();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const users = await prisma.user.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: PAGE_SIZE,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });
  const initialUsers = users.map((staff) => ({
    ...staff,
    createdAt: staff.createdAt.toISOString(),
  }));

  return (
    <AppShell user={shellUser}>
      <div className="space-y-4">
        <PageHeader
          title="Users"
          description="Staff accounts and roles. Only admins can create accounts or change roles."
        />
        <UserForms
          initialUsers={initialUsers}
          initialTotalPages={totalPages}
          initialTotal={total}
          currentUserId={user.id}
        />
      </div>
    </AppShell>
  );
}
