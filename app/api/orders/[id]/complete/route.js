// SAVE AS: app/api/orders/[id]/complete/route.js
// Mark a fully-paid order COMPLETED. Roles: admin, cashier.
// Use this when payment was recorded earlier WITHOUT complete:true on
// the payment route. No body needed.
// Rules: paymentStatus must be PAID — completing an unpaid order is
// NOT allowed through any route — and status must be RECEIVED,
// PREPARING, READY, or OUT_FOR_DELIVERY. Completing frees a dine-in
// table and increments the customer's totals exactly once: the
// transition guard reads the pre-update status inside the transaction,
// so only a move INTO COMPLETED counts, and a double submit (the
// second read sees COMPLETED) is rejected with 409.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";

const COMPLETABLE_STATUSES = ["RECEIVED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];

function errorResponse(message, status) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("Sign in required.", 401);
  if (!hasRole(user, ["admin", "cashier"])) {
    return errorResponse("You do not have permission to complete orders.", 403);
  }

  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return errorResponse("Order not found.", 404);
  }

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) {
        const err = new Error("Order not found.");
        err.status = 404;
        throw err;
      }
      if (order.status === "COMPLETED") {
        const err = new Error("Order is already completed.");
        err.status = 409;
        throw err;
      }
      if (!COMPLETABLE_STATUSES.includes(order.status)) {
        const err = new Error(`Order in status ${order.status} cannot be completed.`);
        err.status = 409;
        throw err;
      }
      if (order.paymentStatus !== "PAID") {
        const err = new Error(
          "Order cannot be completed until it is fully paid. Record the payment first.",
        );
        err.status = 409;
        throw err;
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: "COMPLETED" },
      });

      if (order.tableId) {
        await tx.table.updateMany({
          where: { id: order.tableId, currentOrderId: order.id },
          data: { status: "FREE", currentOrderId: null },
        });
      }

      // Transition guard: this code only runs when the pre-update
      // status (read above, same transaction) was not COMPLETED.
      if (order.customerPhone) {
        const existing = await tx.customer.findUnique({
          where: { phone: order.customerPhone },
        });
        if (existing) {
          await tx.customer.update({
            where: { phone: order.customerPhone },
            data: {
              totalOrders: { increment: 1 },
              totalSpent: { increment: order.grandTotal },
            },
          });
        } else {
          await tx.customer.create({
            data: {
              phone: order.customerPhone,
              name: order.customerName,
              address: order.deliveryAddress,
              totalOrders: 1,
              totalSpent: order.grandTotal,
            },
          });
        }
      }
    });
  } catch (err) {
    if (err?.status) {
      return errorResponse(err.message || "Order could not be completed.", err.status);
    }
    console.error("POST /api/orders/[id]/complete failed:", err);
    return errorResponse("Order could not be completed. Please try again.", 500);
  }

  const updated = await prisma.order.findUnique({
    where: { id: orderId },
    include: { table: { select: { id: true, code: true, name: true } } },
  });
  return NextResponse.json({ order: updated });
}
