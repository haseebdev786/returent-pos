// SAVE AS: lib/session.js
// Server-side session helpers. getCurrentUser reads the Better Auth
// session from request headers, then loads the FULL user row (role and
// isActive live in the database, not in the session payload).
// Inactive users are treated as logged out: getCurrentUser returns null
// for them, so deactivating an account locks it out immediately.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const ROLE_LABELS = {
  // Mirrored in components/ui.jsx for client components (this module is
  // server-only). Keep the two maps in sync.
  admin: "Admin",
  cashier: "Cashier",
  kitchen: "Kitchen",
  rider: "Rider",
};

export async function getCurrentUser() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (!session?.user?.id) return null;

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });
    if (!user || !user.isActive) return null;
    return user;
  } catch {
    return null;
  }
}

export function hasRole(user, roles) {
  if (!user) return false;
  const list = Array.isArray(roles) ? roles : [roles];
  return list.includes(user.role);
}

/**
 * One definition of every role's home screen. Cashiers are order
 * takers, so their home is the New order screen — not the Dashboard
 * and not the Counter (billing stays one click away in the sidebar).
 * Kitchen staff live on the Kitchen display, riders on Delivery,
 * admins on the Dashboard. Login/signup pages keep a client-side copy
 * of this map (they cannot import this server-only module); keep the
 * two in sync. Denied screens link back here via
 * homeForRole/homeLabelForRole.
 */
export function homeForRole(role) {
  if (role === "kitchen") return "/kitchen";
  if (role === "rider") return "/delivery";
  if (role === "cashier") return "/orders/new";
  return "/dashboard";
}

export function homeLabelForRole(role) {
  if (role === "kitchen") return "Kitchen display";
  if (role === "rider") return "Delivery";
  if (role === "cashier") return "New order";
  return "Dashboard";
}

/** For server components/layouts: redirect to /login when logged out. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
