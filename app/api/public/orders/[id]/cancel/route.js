// SAVE AS: app/api/public/orders/[id]/cancel/route.js
// Customer cancellation. Body: { token }. Only while status is RECEIVED
// — once the kitchen starts preparing, the customer must ask staff.
// Sets CANCELLED + cancelledReason "Cancelled by customer" and frees
// the table for dine-in orders (only when the table still points at
// this order, so a newer order's table is never freed by mistake).
// If the order was already PAID, paymentStatus becomes REFUNDED — a
// MANUAL refund at the counter, mirroring the staff cancel route; no
// gateway call is made and gateway fields stay null.

import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

function tokensMatch(provided, actual) {
  if (typeof provided !== "string" || typeof actual !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request, context) {
  const { id } = await context.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }

  const { allowed } = await checkRateLimit(
    `ratelimit:public-cancel:${orderId}`,
    10,
    60,
  );
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }
  if (!tokensMatch(body?.token, order.accessToken)) {
    return Response.json({ error: "Invalid tracking link." }, { status: 403 });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const fresh = await tx.order.findUnique({ where: { id: orderId } });
      if (!fresh || fresh.status !== "RECEIVED") {
        const error = new Error(
          "This order can no longer be cancelled. Please ask the staff for help.",
        );
        error.code = "ORDER_NOT_CANCELLABLE";
        throw error;
      }

      const cancelled = await tx.order.update({
        where: { id: orderId },
        data: {
          status: "CANCELLED",
          cancelledReason: "Cancelled by customer",
          // Manual counter refund only; no gateway is involved.
          ...(fresh.paymentStatus === "PAID" ? { paymentStatus: "REFUNDED" } : {}),
        },
      });

      if (fresh.tableId) {
        // Free the table only if it still points at this order.
        await tx.table.updateMany({
          where: { id: fresh.tableId, currentOrderId: orderId },
          data: { status: "FREE", currentOrderId: null },
        });
      }

      return cancelled;
    });

    return Response.json({
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      status: updated.status,
    });
  } catch (error) {
    if (error?.code === "ORDER_NOT_CANCELLABLE") {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("Public order cancel failed:", error);
    return Response.json(
      { error: "Could not cancel the order. Please try again." },
      { status: 500 },
    );
  }
}
