// SAVE AS: app/api/orders/[id]/discount/route.js
// Set (or clear) the discount on an unpaid order. Roles: admin, cashier.
// Body: { discount, discountReason }
// Rules: discount is a whole number of rupees, >= 0 and <= the current
// subtotal; a reason is required whenever discount > 0. Only while the
// order is UNPAID and not COMPLETED/CANCELLED — a paid or closed bill
// keeps the discount it was settled with. Setting discount 0 clears
// the discount and its reason. Inside one transaction the discount is
// written first, then recomputeOrderTotals re-derives tax/service on
// (subtotal - discount) from the order's applied-rate snapshots; the
// helper preserves the stored discount, so the write order matters.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";
import { recomputeOrderTotals } from "@/lib/order-totals";

function errorResponse(message, status) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("Sign in required.", 401);
  if (!hasRole(user, ["admin", "cashier"])) {
    return errorResponse("You do not have permission to change discounts.", 403);
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
  const discount = body?.discount;
  const discountReason =
    typeof body?.discountReason === "string" ? body.discountReason.trim() : "";

  if (!Number.isInteger(discount) || discount < 0) {
    return errorResponse("Discount must be a whole number of rupees, 0 or more.", 400);
  }
  if (discount > 0 && !discountReason) {
    return errorResponse("A discount reason is required when a discount is given.", 400);
  }

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, paymentStatus: true, subtotal: true },
      });
      if (!order) {
        const err = new Error("Order not found.");
        err.status = 404;
        throw err;
      }
      if (order.status === "COMPLETED" || order.status === "CANCELLED") {
        const err = new Error(`Order is ${order.status} — its discount cannot change.`);
        err.status = 409;
        throw err;
      }
      if (order.paymentStatus !== "UNPAID") {
        const err = new Error("Discount can only change while the order is unpaid.");
        err.status = 409;
        throw err;
      }
      if (discount > order.subtotal) {
        const err = new Error("Discount cannot be more than the order subtotal.");
        err.status = 400;
        throw err;
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          discount,
          discountReason: discount > 0 ? discountReason : null,
        },
      });
      await recomputeOrderTotals(tx, orderId);
    });
  } catch (err) {
    if (err?.status) {
      return errorResponse(err.message || "Discount could not be changed.", err.status);
    }
    console.error("POST /api/orders/[id]/discount failed:", err);
    return errorResponse("Discount could not be changed. Please try again.", 500);
  }

  const updated = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: { select: { amount: true, status: true } } },
  });
  const paidTotal = (updated?.payments || []).reduce(
    (sum, payment) => (payment.status === "PAID" ? sum + payment.amount : sum),
    0,
  );
  return NextResponse.json({
    order: updated,
    paidTotal,
    remaining: Math.max(0, (updated?.grandTotal || 0) - paidTotal),
  });
}
