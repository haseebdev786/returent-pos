// SAVE AS: app/api/menu/addon-groups/route.js
// Staff API: addon groups (e.g. "Extra Cheese", required / maxSelect).
// Admin only. POST accepts { name, required, maxSelect, addons:
// [{ name, price }] } and creates the group with its addons in one
// transaction. Every write invalidates the published-menu cache.

import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";
import { invalidateMenu } from "@/lib/cache";

const MAX_ADDONS = 50;

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!hasRole(user, "admin")) {
    return Response.json(
      { error: "Only admins can manage the menu." },
      { status: 403 },
    );
  }
  return null;
}

/** Validates an addons array; returns cleaned rows or an error string. */
function cleanAddons(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return "addons must be an array.";
  if (value.length > MAX_ADDONS) {
    return `At most ${MAX_ADDONS} addons per group.`;
  }
  const rows = [];
  for (const [index, raw] of value.entries()) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!name) return `Addon ${index + 1}: name is required.`;
    if (name.length > 100) {
      return `Addon ${index + 1}: name must be 100 characters or fewer.`;
    }
    const price = Number(raw?.price);
    if (!Number.isInteger(price) || price < 0) {
      return `Addon ${index + 1}: price must be a whole number of 0 or more.`;
    }
    rows.push({ name, price });
  }
  return rows;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const groups = await prisma.addonGroup.findMany({
    orderBy: { id: "asc" },
    include: {
      addons: { orderBy: { id: "asc" } },
      _count: { select: { menuItems: true } },
    },
  });

  return Response.json({ groups });
}

export async function POST(request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "Group name is required." }, { status: 400 });
  }
  if (name.length > 100) {
    return Response.json(
      { error: "Group name must be 100 characters or fewer." },
      { status: 400 },
    );
  }
  const maxSelect = Number(body?.maxSelect ?? 1);
  if (!Number.isInteger(maxSelect) || maxSelect < 1) {
    return Response.json(
      { error: "maxSelect must be a whole number of 1 or more." },
      { status: 400 },
    );
  }
  const addons = cleanAddons(body?.addons);
  if (typeof addons === "string") {
    return Response.json({ error: addons }, { status: 400 });
  }

  const group = await prisma.addonGroup.create({
    data: {
      name,
      required: body?.required === true,
      maxSelect,
      addons: { create: addons },
    },
    include: {
      addons: { orderBy: { id: "asc" } },
      _count: { select: { menuItems: true } },
    },
  });

  await invalidateMenu();
  return Response.json({ group }, { status: 201 });
}
