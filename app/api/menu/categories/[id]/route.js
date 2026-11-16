// SAVE AS: app/api/menu/categories/[id]/route.js
// Staff API: update / delete one menu category. Admin only. DELETE is
// blocked with 409 while any menu item belongs to the category —
// deleting a category must never orphan items. Every write invalidates
// the published-menu cache.

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

function parseId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(request, context) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await context.params;
  const categoryId = parseId(id);
  if (!categoryId) {
    return Response.json({ error: "Category not found." }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const data = {};
  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return Response.json(
        { error: "Category name is required." },
        { status: 400 },
      );
    }
    if (name.length > 100) {
      return Response.json(
        { error: "Category name must be 100 characters or fewer." },
        { status: 400 },
      );
    }
    data.name = name;
  }
  if (body?.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      return Response.json(
        { error: "sortOrder must be a whole number of 0 or more." },
        { status: 400 },
      );
    }
    data.sortOrder = sortOrder;
  }
  if (body?.isActive !== undefined) {
    data.isActive = body.isActive === true;
  }

  try {
    const category = await prisma.category.update({
      where: { id: categoryId },
      data,
      include: { _count: { select: { items: true } } },
    });
    await invalidateMenu();
    return Response.json({ category });
  } catch (error) {
    if (error?.code === "P2025") {
      return Response.json({ error: "Category not found." }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(request, context) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await context.params;
  const categoryId = parseId(id);
  if (!categoryId) {
    return Response.json({ error: "Category not found." }, { status: 404 });
  }

  const existing = await prisma.category.findUnique({
    where: { id: categoryId },
    include: { _count: { select: { items: true } } },
  });
  if (!existing) {
    return Response.json({ error: "Category not found." }, { status: 404 });
  }
  if (existing._count.items > 0) {
    return Response.json(
      {
        error: `Cannot delete this category: ${existing._count.items} menu item(s) still belong to it. Move or delete the items first.`,
      },
      { status: 409 },
    );
  }

  await prisma.category.delete({ where: { id: categoryId } });
  await invalidateMenu();
  return Response.json({ ok: true });
}
