// SAVE AS: app/api/orders/[id]/delivery-status/route.js
// Delivery progression for DELIVERY orders. Roles: admin, cashier, and
// the ASSIGNED rider (a rider may only act on orders whose riderId is
// their own id — enforced server-side here, never trusted from the
// client).
// Body: { status: "OUT_FOR_DELIVERY" | "DELIVERED" }
//   OUT_FOR_DELIVERY: only from READY. Sets the sticky OUT_FOR_DELIVERY
//     status directly — this is an explicit staff action, so it does
//     NOT go through recalcOrderStatus (which would refuse to move a
//     sticky order anyway).
//   DELIVERED: only from OUT_FOR_DELIVERY, and only when the order is
//     fully PAID — a COD order must have its payment recorded first
//     (409 otherwise). Sets COMPLETED, frees any table pointer, and
//     increments customer totals once (transition guard: the
//     pre-update status read inside the transaction must not already
//     be COMPLETED).
// "DELIVERED" is the action name; there is no DELIVERED value in the
// OrderStatus enum — a delivered order is COMPLETED.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";

function errorResponse(message, status) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("Sign in required.", 401);
  if (!hasRole(user, ["admin", "cashier", "rider"])) {
    return errorResponse("You do not have permission to update deliveries.", 403);
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
  const action = body?.status;
  if (action !== "OUT_FOR_DELIVERY" && action !== "DELIVERED") {
    return errorResponse('status must be "OUT_FOR_DELIVERY" or "DELIVERED".', 400);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, type: true, riderId: true },
  });
  if (!order) return errorResponse("Order not found.", 404);
  if (order.type !== "DELIVERY") {
    return errorResponse("Delivery status only applies to delivery orders.", 400);
  }
  if (user.role === "rider" && order.riderId !== user.id) {
    return errorResponse("You can only update deliveries assigned to you.", 403);
  }

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id: orderId } });
      if (!current) {
        const err = new Error("Order not found.");
        err.status = 404;
        throw err;
      }
      // Re-check the rider assignment inside the transaction: the
      // order may have been reassigned after the read above.
      if (user.role === "rider" && current.riderId !== user.id) {
        const err = new Error("You can only update deliveries assigned to you.");
        err.status = 403;
        throw err;
      }

      if (action === "OUT_FOR_DELIVERY") {
        if (current.status !== "READY") {
          const err = new Error(
            `Only a READY order can go out for delivery (current status: ${current.status}).`,
          );
          err.status = 409;
          throw err;
        }
        await tx.order.update({
          where: { id: orderId },
          data: { status: "OUT_FOR_DELIVERY" },
        });
        return;
      }

      // DELIVERED
      if (current.status !== "OUT_FOR_DELIVERY") {
        const err = new Error(
          `Only an order that is OUT_FOR_DELIVERY can be marked delivered (current status: ${current.status}).`,
        );
        err.status = 409;
        throw err;
      }
      if (current.paymentStatus !== "PAID") {
        const err = new Error(
          "Record the COD payment first — an unpaid order cannot be marked delivered.",
        );
        err.status = 409;
        throw err;
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: "COMPLETED" },
      });
      if (current.tableId) {
        await tx.table.updateMany({
          where: { id: current.tableId, currentOrderId: current.id },
          data: { status: "FREE", currentOrderId: null },
        });
      }
      // Transition guard: pre-update status was OUT_FOR_DELIVERY (read
      // above, same transaction), so this is the one move into
      // COMPLETED and totals increment exactly once.
      if (current.customerPhone) {
        const existing = await tx.customer.findUnique({
          where: { phone: current.customerPhone },
        });
        if (existing) {
          await tx.customer.update({
            where: { phone: current.customerPhone },
            data: {
              totalOrders: { increment: 1 },
              totalSpent: { increment: current.grandTotal },
            },
          });
        } else {
          await tx.customer.create({
            data: {
              phone: current.customerPhone,
              name: current.customerName,
              address: current.deliveryAddress,
              totalOrders: 1,
              totalSpent: current.grandTotal,
            },
          });
        }
      }
    });
  } catch (err) {
    if (err?.status) {
      return errorResponse(
        err.message || "Delivery status could not be updated.",
        err.status,
      );
    }
    console.error("POST /api/orders/[id]/delivery-status failed:", err);
    return errorResponse("Delivery status could not be updated. Please try again.", 500);
  }

  const updated = await prisma.order.findUnique({
    where: { id: orderId },
    include: { rider: { select: { id: true, name: true, email: true } } },
  });
  return NextResponse.json({ order: updated });
}
