// SAVE AS: app/api/menu/categories/route.js
// Staff API: menu categories. Admin only (GET + POST). Every write
// invalidates the published-menu cache so customer pages see the change
// within seconds instead of waiting out the 60s TTL.

import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";
import { invalidateMenu } from "@/lib/cache";

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

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { _count: { select: { items: true } } },
  });

  return Response.json({ categories });
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
    return Response.json({ error: "Category name is required." }, { status: 400 });
  }
  if (name.length > 100) {
    return Response.json(
      { error: "Category name must be 100 characters or fewer." },
      { status: 400 },
    );
  }
  const sortOrder = Number(body?.sortOrder ?? 0);
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return Response.json(
      { error: "sortOrder must be a whole number of 0 or more." },
      { status: 400 },
    );
  }

  const category = await prisma.category.create({
    data: {
      name,
      sortOrder,
      isActive: body?.isActive !== false,
    },
    include: { _count: { select: { items: true } } },
  });

  await invalidateMenu();
  return Response.json({ category }, { status: 201 });
}
