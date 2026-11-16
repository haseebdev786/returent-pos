// SAVE AS: app/menu/page.jsx
// Staff Menu admin page. Admin only — other roles get an honest card
// inside the shell (the sidebar already hides this link from them).
// Follows the locked shell pattern: the page wraps AppShell itself
// (getCurrentUser -> redirect /login -> plain user object). Loads
// categories, addon groups, and the first page of menu items; the
// client drives search/filter/pagination through the menu APIs.

import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/ui";
import { getCurrentUser, hasRole, homeForRole, homeLabelForRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings-data";
import MenuAdminClient from "@/components/MenuAdminClient";

const PAGE_SIZE = 20;

export default async function MenuAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const shellUser = { name: user.name, email: user.email, role: user.role };

  if (!hasRole(user, "admin")) {
    const homeHref = homeForRole(user.role);
    const homeLabel = homeLabelForRole(user.role);
    return (
      <AppShell user={shellUser}>
        <PageHeader
          title="Menu"
          description="Categories, items, variants and addons."
        />
        <p className="form-error mt-4">
          Only admins can manage the menu. Ask an admin if something needs
          changing.
        </p>
        <p className="mt-4">
          <Link href={homeHref} className="btn btn-primary">
            Go to {homeLabel}
          </Link>
        </p>
      </AppShell>
    );
  }

  const [settings, categories, groups, totalItems, items] = await Promise.all([
    getSettings(),
    prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: { _count: { select: { items: true } } },
    }),
    prisma.addonGroup.findMany({
      orderBy: { id: "asc" },
      include: {
        addons: { orderBy: { id: "asc" } },
        _count: { select: { menuItems: true } },
      },
    }),
    prisma.menuItem.count(),
    prisma.menuItem.findMany({
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: PAGE_SIZE,
      include: {
        category: { select: { id: true, name: true } },
        variants: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        addonGroups: {
          include: { group: { select: { id: true, name: true } } },
        },
        _count: { select: { orderItems: true } },
      },
    }),
  ]);

  return (
    <AppShell user={shellUser}>
      <PageHeader
        title="Menu"
        description="Categories, items, variants and addons. Changes appear on customer ordering pages right away."
      />
      <MenuAdminClient
        initialCategories={categories}
        initialGroups={groups}
        initialItems={items}
        initialItemsTotal={totalItems}
        initialItemsTotalPages={Math.max(1, Math.ceil(totalItems / PAGE_SIZE))}
        pageSize={PAGE_SIZE}
        currency={settings.currency}
      />
    </AppShell>
  );
}
