// SAVE AS: app/api/menu/items/route.js
// Staff API: menu items. Admin only. GET is paginated with filters
// (?q=&categoryId=&page=&pageSize=). POST creates an item with optional
// variants[] and addonGroupIds[] in one transaction. Every write
// invalidates the published-menu cache.

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

function cleanVariants(value) {
  if (value === undefined) return [];
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
  if (value === undefined) return [];
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

export async function GET(request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim();
  const categoryId = Number(params.get("categoryId"));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, Number(params.get("pageSize")) || 20),
  );

  const where = {};
  if (q) where.name = { contains: q, mode: "insensitive" };
  if (Number.isInteger(categoryId) && categoryId > 0) {
    where.categoryId = categoryId;
  }

  const [total, items] = await Promise.all([
    prisma.menuItem.count({ where }),
    prisma.menuItem.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: ITEM_INCLUDE,
    }),
  ]);

  return Response.json({
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
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

  const categoryId = Number(body?.categoryId);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return Response.json({ error: "categoryId is required." }, { status: 400 });
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "Item name is required." }, { status: 400 });
  }
  if (name.length > 150) {
    return Response.json(
      { error: "Item name must be 150 characters or fewer." },
      { status: 400 },
    );
  }
  const price = Number(body?.price);
  if (!Number.isInteger(price) || price < 0) {
    return Response.json(
      { error: "price must be a whole number of 0 or more." },
      { status: 400 },
    );
  }
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";
  if (description.length > 500) {
    return Response.json(
      { error: "Description must be 500 characters or fewer." },
      { status: 400 },
    );
  }
  const imageUrl =
    typeof body?.imageUrl === "string" ? body.imageUrl.trim() : "";
  if (imageUrl.length > 500) {
    return Response.json(
      { error: "Image URL must be 500 characters or fewer." },
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
  const variants = cleanVariants(body?.variants);
  if (typeof variants === "string") {
    return Response.json({ error: variants }, { status: 400 });
  }
  const groupIds = cleanGroupIds(body?.addonGroupIds);
  if (typeof groupIds === "string") {
    return Response.json({ error: groupIds }, { status: 400 });
  }

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
  });
  if (!category) {
    return Response.json({ error: "Category not found." }, { status: 400 });
  }
  if (groupIds.length > 0) {
    const found = await prisma.addonGroup.count({
      where: { id: { in: groupIds } },
    });
    if (found !== groupIds.length) {
      return Response.json(
        { error: "One or more addon groups do not exist." },
        { status: 400 },
      );
    }
  }

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.menuItem.create({
      data: {
        categoryId,
        name,
        description: description || null,
        price,
        imageUrl: imageUrl || null,
        isActive: body?.isActive !== false,
        isSoldOut: body?.isSoldOut === true,
        sortOrder,
        variants: { create: variants },
        addonGroups: {
          create: groupIds.map((groupId) => ({ groupId })),
        },
      },
    });
    return tx.menuItem.findUnique({
      where: { id: created.id },
      include: ITEM_INCLUDE,
    });
  });

  await invalidateMenu();
  return Response.json({ item }, { status: 201 });
}
