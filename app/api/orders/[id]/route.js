// SAVE AS: app/api/orders/[id]/route.js
// Staff order detail. Roles: admin, cashier ONLY. Kitchen staff use
// /api/kitchen and riders use /api/delivery — this route deliberately
// refuses them so each role only sees the surface it needs.
// Returns the full order: batches with snapshot items + addons,
// payments (with who received them), table, and assigned rider, plus
// paidTotal and remaining (grandTotal - PAID payments). No PATCH here:
// every change goes through the dedicated action routes below this one
// (add-items, discount, payment, cancel, assign-rider, clear-flags,
// complete, delivery-status), each with its own state-machine guard.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";

function errorResponse(message, status) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("Sign in required.", 401);
  if (!hasRole(user, ["admin", "cashier"])) {
    return errorResponse("You do not have permission to view order details.", 403);
  }

  const { id } = await params;
  const orderId = Number.parseInt(id, 10);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return errorResponse("Order not found.", 404);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      table: { select: { id: true, code: true, name: true, seats: true } },
      rider: { select: { id: true, name: true, email: true } },
      batches: {
        orderBy: { batchNumber: "asc" },
        include: {
          items: {
            orderBy: { id: "asc" },
            include: { addons: { orderBy: { id: "asc" } } },
          },
        },
      },
      payments: {
        orderBy: { createdAt: "asc" },
        include: {
          receivedBy: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  if (!order) return errorResponse("Order not found.", 404);

  const paidTotal = order.payments.reduce(
    (sum, payment) => (payment.status === "PAID" ? sum + payment.amount : sum),
    0,
  );

  return NextResponse.json({
    order: {
      ...order,
      paidTotal,
      remaining: Math.max(0, order.grandTotal - paidTotal),
    },
  });
}
