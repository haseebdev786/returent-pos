// SAVE AS: components/StaffSidebar.jsx
"use client";

// Role-filtered staff navigation drawer.
// SECURITY NOTE: hiding links is never security. Every staff page and
// API route must re-check the session role server-side; this menu only
// keeps each role's navigation focused. Kitchen sees only Kitchen,
// riders only Delivery; admins see everything.
// Menu contract (labels + hrefs are shared with StaffHeader titles):
//   Dashboard /dashboard, Counter /counter, Orders /orders,
//   Kitchen /kitchen, Delivery /delivery, Menu /menu, Tables /tables,
//   Customers /customers, Reports /reports, Settings /settings,
//   Users /users.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge, Icon, ROLE_LABELS, roleTone } from "@/components/ui";
import LogoutButton from "@/components/LogoutButton";

const MENU = [
  {
    group: "Counter",
    links: [
      { label: "Dashboard", href: "/dashboard", icon: "grid", roles: ["admin", "cashier"] },
      { label: "Counter", href: "/counter", icon: "cart", roles: ["admin", "cashier"] },
      { label: "Orders", href: "/orders", icon: "receipt", roles: ["admin", "cashier"] },
    ],
  },
  {
    group: "Kitchen",
    links: [
      { label: "Kitchen", href: "/kitchen", icon: "flame", roles: ["admin", "kitchen"] },
      { label: "Delivery", href: "/delivery", icon: "bike", roles: ["admin", "cashier", "rider"] },
    ],
  },
  {
    group: "Operations",
    links: [
      { label: "Menu", href: "/menu", icon: "clipboard", roles: ["admin"] },
      { label: "Tables", href: "/tables", icon: "table", roles: ["admin", "cashier"] },
      { label: "Customers", href: "/customers", icon: "users", roles: ["admin", "cashier"] },
      { label: "Reports", href: "/reports", icon: "chart", roles: ["admin", "cashier"] },
    ],
  },
  {
    group: "Admin",
    links: [
      { label: "Settings", href: "/settings", icon: "gear", roles: ["admin"] },
      { label: "Users", href: "/users", icon: "user", roles: ["admin"] },
    ],
  },
];

export default function StaffSidebar({ user, open, onClose }) {
  const pathname = usePathname();
  const role = user?.role ?? "cashier";

  function isActive(href) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="no-print fixed inset-0 z-40 cursor-default bg-slate-950/50 lg:hidden"
        />
      ) : null}

      <aside
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-slate-900 text-slate-200 transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <p className="text-base font-bold tracking-tight text-white">
            Restaurant POS
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>

        <nav className="sidebar-nav min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {MENU.map((section) => {
            const links = section.links.filter((link) =>
              link.roles.includes(role),
            );
            if (links.length === 0) return null;
            return (
              <div key={section.group} className="mt-2 first:mt-0">
                <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-widest text-slate-400 uppercase">
                  {section.group}
                </p>
                <ul className="space-y-0.5">
                  {links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        onClick={onClose}
                        className={`side-link ${isActive(link.href) ? "side-link-active" : ""}`}
                      >
                        <Icon name={link.icon} className="h-4.5 w-4.5 shrink-0" />
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-3 py-3">
          <div className="flex min-w-0 items-center gap-2 px-1 pb-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
              {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {user?.name || "Staff"}
              </p>
              <p className="truncate text-xs text-slate-400">{user?.email}</p>
            </div>
            <Badge tone={roleTone(role)}>
              {ROLE_LABELS[role] ?? role}
            </Badge>
          </div>
          <LogoutButton variant="dark" className="btn-block" />
        </div>
      </aside>
    </>
  );
}
