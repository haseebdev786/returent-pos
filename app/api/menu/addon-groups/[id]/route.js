// SAVE AS: app/api/menu/addon-groups/[id]/route.js
// Staff API: update / delete one addon group. Admin only. PATCH accepts
// the same shape as create; when `addons` is present the group's addons
// are REPLACED in a transaction (delete + recreate). Past orders are
// safe: OrderItemAddon stores name/price snapshots with no foreign key
// to Addon. DELETE removes the group; its menu-item links and addons
// cascade (see schema). Every write invalidates the menu cache.

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

function parseId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cleanAddons(value) {
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

export async function PATCH(request, context) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await context.params;
  const groupId = parseId(id);
  if (!groupId) {
    return Response.json({ error: "Addon group not found." }, { status: 404 });
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
      return Response.json({ error: "Group name is required." }, { status: 400 });
    }
    if (name.length > 100) {
      return Response.json(
        { error: "Group name must be 100 characters or fewer." },
        { status: 400 },
      );
    }
    data.name = name;
  }
  if (body?.required !== undefined) data.required = body.required === true;
  if (body?.maxSelect !== undefined) {
    const maxSelect = Number(body.maxSelect);
    if (!Number.isInteger(maxSelect) || maxSelect < 1) {
      return Response.json(
        { error: "maxSelect must be a whole number of 1 or more." },
        { status: 400 },
      );
    }
    data.maxSelect = maxSelect;
  }

  let replacementAddons = null;
  if (body?.addons !== undefined) {
    const cleaned = cleanAddons(body.addons);
    if (typeof cleaned === "string") {
      return Response.json({ error: cleaned }, { status: 400 });
    }
    replacementAddons = cleaned;
  }

  try {
    const group = await prisma.$transaction(async (tx) => {
      const updated = await tx.addonGroup.update({
        where: { id: groupId },
        data,
      });
      if (replacementAddons !== null) {
        await tx.addon.deleteMany({ where: { groupId } });
        if (replacementAddons.length > 0) {
          await tx.addon.createMany({
            data: replacementAddons.map((addon) => ({ ...addon, groupId })),
          });
        }
      }
      return tx.addonGroup.findUnique({
        where: { id: updated.id },
        include: {
          addons: { orderBy: { id: "asc" } },
          _count: { select: { menuItems: true } },
        },
      });
    });
    await invalidateMenu();
    return Response.json({ group });
  } catch (error) {
    if (error?.code === "P2025") {
      return Response.json({ error: "Addon group not found." }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(request, context) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await context.params;
  const groupId = parseId(id);
  if (!groupId) {
    return Response.json({ error: "Addon group not found." }, { status: 404 });
  }

  try {
    await prisma.addonGroup.delete({ where: { id: groupId } });
  } catch (error) {
    if (error?.code === "P2025") {
      return Response.json({ error: "Addon group not found." }, { status: 404 });
    }
    throw error;
  }

  await invalidateMenu();
  return Response.json({ ok: true });
}
