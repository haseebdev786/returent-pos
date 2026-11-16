// SAVE AS: app/api/orders/[id]/clear-flags/route.js
// Clear the "waiter called" / "bill requested" flags on a dine-in
// order after staff have attended to the table. Roles: admin, cashier.
// No body needed. DINE_IN orders only — takeaway/delivery orders never
// carry these flags. Idempotent: clearing already-clear flags still
// returns 200 with the order, so a double tap is harmless.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";

function errorResponse(message, status) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("Sign in required.", 401);
  if (!hasRole(user, ["admin", "cashier"])) {
    return errorResponse("You do not have permission to clear table flags.", 403);
  }

  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return errorResponse("Order not found.", 404);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, type: true },
  });
  if (!order) return errorResponse("Order not found.", 404);
  if (order.type !== "DINE_IN") {
    return errorResponse("Table flags only exist on dine-in orders.", 400);
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { waiterCalledAt: null, billRequestedAt: null },
  });
  return NextResponse.json({ order: updated });
}
