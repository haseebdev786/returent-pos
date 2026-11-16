// SAVE AS: app/api/tables/route.js
// Staff API: tables. GET is admin + cashier (cashiers need table status
// for the counter); create is admin only. Each table carries its open
// order summary (if any) so staff screens can show the running bill.
// Table status (FREE/OCCUPIED) is driven by orders, never set here.

import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";

async function requireRoles(roles) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!hasRole(user, roles)) {
    return Response.json(
      { error: "You do not have permission to manage tables." },
      { status: 403 },
    );
  }
  return null;
}

export async function GET() {
  const denied = await requireRoles(["admin", "cashier"]);
  if (denied) return denied;

  const tables = await prisma.table.findMany({
    orderBy: { code: "asc" },
  });
  const openIds = tables
    .map((table) => table.currentOrderId)
    .filter((orderId) => orderId !== null);
  const openOrders =
    openIds.length > 0
      ? await prisma.order.findMany({
          where: { id: { in: openIds } },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            grandTotal: true,
          },
        })
      : [];
  const byId = new Map(openOrders.map((order) => [order.id, order]));

  return Response.json({
    tables: tables.map((table) => ({
      ...table,
      openOrder: table.currentOrderId
        ? (byId.get(table.currentOrderId) ?? null)
        : null,
    })),
  });
}

export async function POST(request) {
  const denied = await requireRoles(["admin"]);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) {
    return Response.json({ error: "Table code is required." }, { status: 400 });
  }
  if (code.length > 20) {
    return Response.json(
      { error: "Table code must be 20 characters or fewer." },
      { status: 400 },
    );
  }
  if (/[\s/]/.test(code)) {
    return Response.json(
      { error: "Table code cannot contain spaces or slashes (it appears in the QR link)." },
      { status: 400 },
    );
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "Table name is required." }, { status: 400 });
  }
  if (name.length > 100) {
    return Response.json(
      { error: "Table name must be 100 characters or fewer." },
      { status: 400 },
    );
  }
  const seats = Number(body?.seats ?? 4);
  if (!Number.isInteger(seats) || seats < 1) {
    return Response.json(
      { error: "Seats must be a whole number of 1 or more." },
      { status: 400 },
    );
  }

  try {
    const table = await prisma.table.create({
      data: {
        code,
        name,
        seats,
        isActive: body?.isActive !== false,
      },
    });
    return Response.json({ table: { ...table, openOrder: null } }, { status: 201 });
  } catch (error) {
    if (error?.code === "P2002") {
      return Response.json(
        { error: "A table with that code already exists." },
        { status: 409 },
      );
    }
    throw error;
  }
}
