// SAVE AS: app/api/tables/[id]/route.js
// Staff API: update / delete one table. Admin only. PATCH accepts ONLY
// code / name / seats / isActive — status and currentOrderId sent by a
// client are IGNORED: table occupancy is driven by orders (placement
// marks OCCUPIED, completion/cancellation frees the table). DELETE is
// blocked with 409 while an open order sits at the table.

import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";

const OPEN_STATUSES = ["RECEIVED", "PREPARING", "READY"];

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!hasRole(user, "admin")) {
    return Response.json(
      { error: "Only admins can manage tables." },
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
  const tableId = parseId(id);
  if (!tableId) {
    return Response.json({ error: "Table not found." }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  // ONLY these fields are editable. status / currentOrderId are
  // deliberately never read from the request body.
  const data = {};
  if (body?.code !== undefined) {
    const code = typeof body.code === "string" ? body.code.trim() : "";
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
    data.code = code;
  }
  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return Response.json({ error: "Table name is required." }, { status: 400 });
    }
    if (name.length > 100) {
      return Response.json(
        { error: "Table name must be 100 characters or fewer." },
        { status: 400 },
      );
    }
    data.name = name;
  }
  if (body?.seats !== undefined) {
    const seats = Number(body.seats);
    if (!Number.isInteger(seats) || seats < 1) {
      return Response.json(
        { error: "Seats must be a whole number of 1 or more." },
        { status: 400 },
      );
    }
    data.seats = seats;
  }
  if (body?.isActive !== undefined) {
    data.isActive = body.isActive === true;
  }

  try {
    const table = await prisma.table.update({
      where: { id: tableId },
      data,
    });
    return Response.json({ table: { ...table, openOrder: null } });
  } catch (error) {
    if (error?.code === "P2025") {
      return Response.json({ error: "Table not found." }, { status: 404 });
    }
    if (error?.code === "P2002") {
      return Response.json(
        { error: "A table with that code already exists." },
        { status: 409 },
      );
    }
    throw error;
  }
}

export async function DELETE(request, context) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await context.params;
  const tableId = parseId(id);
  if (!tableId) {
    return Response.json({ error: "Table not found." }, { status: 404 });
  }

  const existing = await prisma.table.findUnique({ where: { id: tableId } });
  if (!existing) {
    return Response.json({ error: "Table not found." }, { status: 404 });
  }

  const openOrder = await prisma.order.findFirst({
    where: {
      tableId,
      status: { in: OPEN_STATUSES },
      paymentStatus: "UNPAID",
    },
    select: { id: true, orderNumber: true },
  });
  if (openOrder || existing.status === "OCCUPIED" || existing.currentOrderId !== null) {
    return Response.json(
      {
        error: openOrder
          ? `Cannot delete this table: order ${openOrder.orderNumber} is still open here.`
          : "Cannot delete this table: it still has an open order.",
      },
      { status: 409 },
    );
  }

  await prisma.table.delete({ where: { id: tableId } });
  return Response.json({ ok: true });
}
