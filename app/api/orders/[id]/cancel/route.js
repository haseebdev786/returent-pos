// SAVE AS: app/api/orders/[id]/cancel/route.js
// Cancel an open order. Roles: admin, cashier.
// Body: { reason } — required, stored as cancelledReason.
// Rules: only while the order is NOT already COMPLETED/CANCELLED. A
// cancelled order keeps its batches exactly as they are (kitchen
// history is not rewritten). If the order was already PAID, its
// paymentStatus becomes REFUNDED — a MANUAL refund at the counter; no
// gateway call is made and gateway fields stay null. An unpaid order
// keeps paymentStatus UNPAID. A dine-in table is freed (only when its
// currentOrderId still points at this order). Customer totals are
// never touched: they only increment on completion, so a cancelled
// order never inflates a customer's history.

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
    return errorResponse("You do not have permission to cancel orders.", 403);
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
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return errorResponse("A cancellation reason is required.", 400);
  }

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, paymentStatus: true, tableId: true },
      });
      if (!order) {
        const err = new Error("Order not found.");
        err.status = 404;
        throw err;
      }
      if (order.status === "COMPLETED" || order.status === "CANCELLED") {
        const err = new Error(`Order is already ${order.status} and cannot be cancelled.`);
        err.status = 409;
        throw err;
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: "CANCELLED",
          cancelledReason: reason,
          // Manual counter refund only; no gateway is involved.
          ...(order.paymentStatus === "PAID" ? { paymentStatus: "REFUNDED" } : {}),
        },
      });

      if (order.tableId) {
        await tx.table.updateMany({
          where: { id: order.tableId, currentOrderId: order.id },
          data: { status: "FREE", currentOrderId: null },
        });
      }
    });
  } catch (err) {
    if (err?.status) {
      return errorResponse(err.message || "Order could not be cancelled.", err.status);
    }
    console.error("POST /api/orders/[id]/cancel failed:", err);
    return errorResponse("Order could not be cancelled. Please try again.", 500);
  }

  const updated = await prisma.order.findUnique({
    where: { id: orderId },
    include: { table: { select: { id: true, code: true, name: true } } },
  });
  return NextResponse.json({ order: updated });
}
