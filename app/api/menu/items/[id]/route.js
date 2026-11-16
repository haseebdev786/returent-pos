// SAVE AS: app/api/menu/items/[id]/route.js
// Staff API: update / delete one menu item. Admin only. PATCH handles
// scalar fields and the isActive / isSoldOut toggles; when `variants`
// or `addonGroupIds` is present that relation is REPLACED in the same
// transaction. DELETE is blocked with 409 when the item appears in any
// order history (OrderItem rows) — history must never lose its item
// link; deactivate the item instead. Every write invalidates the menu
// cache.

import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";
import { invalidateMenu } from "@/lib/cache";

const MAX_VARIANTS = 20;
const MAX_GROUPS_PER_ITEM = 20;

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

function cleanVariants(value) {
  if (!Array.isArray(value)) return "variants must be an array.";
  if (value.length > MAX_VARIANTS) {
    return `At most ${MAX_VARIANTS} variants per item.`;
  }
  const rows = [];
  for (const [index, raw] of value.entries()) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!name) return `Variant ${index + 1}: name is required.`;
    if (name.length > 60) {
      return `Variant ${index + 1}: name must be 60 characters or fewer.`;
    }
    const priceDelta = Number(raw?.priceDelta ?? 0);
    if (!Number.isInteger(priceDelta)) {
      return `Variant ${index + 1}: priceDelta must be a whole number.`;
    }
    const sortOrder = Number(raw?.sortOrder ?? index);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      return `Variant ${index + 1}: sortOrder must be 0 or more.`;
    }
    rows.push({ name, priceDelta, sortOrder });
  }
  return rows;
}

function cleanGroupIds(value) {
  if (!Array.isArray(value)) return "addonGroupIds must be an array.";
  const ids = value.map((id) => Number(id));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return "addonGroupIds must be positive integers.";
  }
  const unique = [...new Set(ids)];
  if (unique.length > MAX_GROUPS_PER_ITEM) {
    return `At most ${MAX_GROUPS_PER_ITEM} addon groups per item.`;
  }
  return unique;
}

const ITEM_INCLUDE = {
  category: { select: { id: true, name: true } },
  variants: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
  addonGroups: {
    include: { group: { select: { id: true, name: true } } },
  },
  _count: { select: { orderItems: true } },
};

export async function PATCH(request, context) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await context.params;
  const itemId = parseId(id);
  if (!itemId) {
    return Response.json({ error: "Menu item not found." }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const data = {};
  if (body?.categoryId !== undefined) {
    const categoryId = Number(body.categoryId);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return Response.json({ error: "categoryId is invalid." }, { status: 400 });
    }
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      return Response.json({ error: "Category not found." }, { status: 400 });
    }
    data.categoryId = categoryId;
  }
  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return Response.json({ error: "Item name is required." }, { status: 400 });
    }
    if (name.length > 150) {
      return Response.json(
        { error: "Item name must be 150 characters or fewer." },
        { status: 400 },
      );
    }
    data.name = name;
  }
  if (body?.description !== undefined) {
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    if (description.length > 500) {
      return Response.json(
        { error: "Description must be 500 characters or fewer." },
        { status: 400 },
      );
    }
    data.description = description || null;
  }
  if (body?.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isInteger(price) || price < 0) {
      return Response.json(
        { error: "price must be a whole number of 0 or more." },
        { status: 400 },
      );
    }
    data.price = price;
  }
  if (body?.imageUrl !== undefined) {
    const imageUrl =
      typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    if (imageUrl.length > 500) {
      return Response.json(
        { error: "Image URL must be 500 characters or fewer." },
        { status: 400 },
      );
    }
    data.imageUrl = imageUrl || null;
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
  if (body?.isActive !== undefined) data.isActive = body.isActive === true;
  if (body?.isSoldOut !== undefined) data.isSoldOut = body.isSoldOut === true;

  let replacementVariants = null;
  if (body?.variants !== undefined) {
    const cleaned = cleanVariants(body.variants);
    if (typeof cleaned === "string") {
      return Response.json({ error: cleaned }, { status: 400 });
    }
    replacementVariants = cleaned;
  }
  let replacementGroupIds = null;
  if (body?.addonGroupIds !== undefined) {
    const cleaned = cleanGroupIds(body.addonGroupIds);
    if (typeof cleaned === "string") {
      return Response.json({ error: cleaned }, { status: 400 });
    }
    if (cleaned.length > 0) {
      const found = await prisma.addonGroup.count({
        where: { id: { in: cleaned } },
      });
      if (found !== cleaned.length) {
        return Response.json(
          { error: "One or more addon groups do not exist." },
          { status: 400 },
        );
      }
    }
    replacementGroupIds = cleaned;
  }

  try {
    const item = await prisma.$transaction(async (tx) => {
      await tx.menuItem.update({ where: { id: itemId }, data });
      if (replacementVariants !== null) {
        await tx.menuItemVariant.deleteMany({ where: { menuItemId: itemId } });
        if (replacementVariants.length > 0) {
          await tx.menuItemVariant.createMany({
            data: replacementVariants.map((variant) => ({
              ...variant,
              menuItemId: itemId,
            })),
          });
        }
      }
      if (replacementGroupIds !== null) {
        await tx.menuItemAddonGroup.deleteMany({
          where: { menuItemId: itemId },
        });
        if (replacementGroupIds.length > 0) {
          await tx.menuItemAddonGroup.createMany({
            data: replacementGroupIds.map((groupId) => ({
              menuItemId: itemId,
              groupId,
            })),
          });
        }
      }
      return tx.menuItem.findUnique({
        where: { id: itemId },
        include: ITEM_INCLUDE,
      });
    });
    await invalidateMenu();
    return Response.json({ item });
  } catch (error) {
    if (error?.code === "P2025") {
      return Response.json({ error: "Menu item not found." }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(request, context) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await context.params;
  const itemId = parseId(id);
  if (!itemId) {
    return Response.json({ error: "Menu item not found." }, { status: 404 });
  }

  const existing = await prisma.menuItem.findUnique({
    where: { id: itemId },
    include: { _count: { select: { orderItems: true } } },
  });
  if (!existing) {
    return Response.json({ error: "Menu item not found." }, { status: 404 });
  }
  if (existing._count.orderItems > 0) {
    return Response.json(
      {
        error: `Cannot delete this item: it appears in ${existing._count.orderItems} order record(s). Deactivate it instead to hide it from the menu.`,
      },
      { status: 409 },
    );
  }

  await prisma.menuItem.delete({ where: { id: itemId } });
  await invalidateMenu();
  return Response.json({ ok: true });
}
