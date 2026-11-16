// SAVE AS: app/api/orders/[id]/assign-rider/route.js
// Assign (or unassign) a rider to a delivery order. Roles: admin, cashier.
// Body: { riderId } — a user id, or null to unassign.
// Rules: DELIVERY orders only. A non-null riderId must belong to an
// ACTIVE user whose role is "rider" — assigning a cashier, kitchen
// user, or deactivated account is rejected. Assignment is only
// meaningful while the order is open, so COMPLETED/CANCELLED orders
// reject (409). Unassigning (null) is always allowed on an open
// delivery order.

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
    return errorResponse("You do not have permission to assign riders.", 403);
  }

  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return errorResponse("Order not found.", 404);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }
  if (!body || !("riderId" in body)) {
    return errorResponse("riderId is required (use null to unassign).", 400);
  }
  const riderId = body.riderId;
  if (riderId !== null && typeof riderId !== "string") {
    return errorResponse("riderId must be a user id or null.", 400);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, type: true, status: true, orderNumber: true },
  });
  if (!order) return errorResponse("Order not found.", 404);
  if (order.type !== "DELIVERY") {
    return errorResponse("Riders can only be assigned to delivery orders.", 400);
  }
  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    return errorResponse(
      `Order ${order.orderNumber} is ${order.status} — its rider cannot change.`,
      409,
    );
  }

  if (riderId !== null) {
    const rider = await prisma.user.findUnique({
      where: { id: riderId },
      select: { id: true, role: true, isActive: true },
    });
    if (!rider) return errorResponse("Rider not found.", 404);
    if (rider.role !== "rider" || !rider.isActive) {
      return errorResponse("The selected user is not an active rider.", 400);
    }
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: { riderId },
    include: { rider: { select: { id: true, name: true, email: true } } },
  });
  return NextResponse.json({ order: updated });
}
