// SAVE AS: app/dashboard/layout.jsx
// Dashboard route layout: requires a logged-in staff user and renders
// the AppShell. The user passed to the shell is a plain object
// ({name, email, role}) so no Date/Prisma values cross to the client.
//
// LAYOUT CHOICE (locked for later phases): each top-level staff route
// page (/counter, /orders, /kitchen, /delivery, /menu, /tables,
// /customers, /reports, /settings, /users) wraps AppShell ITSELF in its
// own page file, following this same pattern (getCurrentUser, redirect
// to /login, plain user object). There is NO shared layout above them.
// /dashboard is the one route that uses a layout file, because the
// dashboard route group may grow sub-pages. Later phases must not add
// a second root-level staff layout — one shell per page, same pattern.

import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getCurrentUser } from "@/lib/session";

export default async function DashboardLayout({ children }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const shellUser = { name: user.name, email: user.email, role: user.role };

  return <AppShell user={shellUser}>{children}</AppShell>;
}
