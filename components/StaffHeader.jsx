// SAVE AS: components/StaffHeader.jsx
"use client";

// Sticky staff header: hamburger (mobile), page title from the URL,
// user name + role badge, logout. Titles use the SAME labels as the
// sidebar menu contract (see components/StaffSidebar.jsx).

import { usePathname } from "next/navigation";
import { Badge, Icon, ROLE_LABELS, roleTone } from "@/components/ui";
import LogoutButton from "@/components/LogoutButton";

const TITLES = {
  dashboard: "Dashboard",
  counter: "Counter",
  orders: "Orders",
  kitchen: "Kitchen",
  delivery: "Delivery",
  menu: "Menu",
  tables: "Tables",
  customers: "Customers",
  reports: "Reports",
  settings: "Settings",
  users: "Users",
  login: "Login",
};

export default function StaffHeader({ user, onMenuClick }) {
  const pathname = usePathname();
  const segment = (pathname || "/").split("/").filter(Boolean)[0] || "dashboard";
  const title = TITLES[segment] ?? "Dashboard";
  const role = user?.role ?? "cashier";

  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
        >
          <Icon name="menu" className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">
          {title}
        </h1>
        <span className="hidden min-w-0 truncate text-sm font-medium text-slate-700 md:block">
          {user?.name || "Staff"}
        </span>
        <Badge tone={roleTone(role)}>{ROLE_LABELS[role] ?? role}</Badge>
        <span className="hidden sm:block">
          <LogoutButton />
        </span>
      </div>
    </header>
  );
}
