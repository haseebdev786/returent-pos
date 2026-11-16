// SAVE AS: app/api/orders/[id]/payment/route.js
// Record a counter payment against an order. Roles: admin, cashier.
// Body: { method, amount, reference?, complete? }
//   method: CASH | CARD | JAZZCASH | EASYPAISA | COD (counter-recorded
//     only — V1 has NO gateway integration; Payment gateway fields
//     stay null).
//   amount: whole rupees, > 0, and never more than the remaining due
//     (grandTotal - PAID payments). Overpayment is rejected (400) —
//     there is no change calculation because change cannot occur.
//   complete: when true AND this payment settles the bill in full, the
//     order is marked COMPLETED in the same transaction (table freed,
//     customer totals incremented). When true but the bill is still
//     short, the whole request fails (400) — no partial payment is
//     recorded, so staff cannot accidentally settle half a bill.
//     Completing an order WITHOUT full payment is NOT allowed through
//     any route: /api/orders/[id]/complete requires paymentStatus PAID.
// A payment is only accepted while the order is open (not COMPLETED /
// CANCELLED). Customer totals increment only on the transition INTO
// COMPLETED, guarded by the pre-update status read inside the
// transaction, so a double submit cannot count one order twice.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { formatPKR } from "@/lib/format";

const PAYMENT_METHODS = ["CASH", "CARD", "JAZZCASH", "EASYPAISA", "COD"];
const COMPLETABLE_STATUSES = ["RECEIVED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];

function errorResponse(message, status) {
  return NextResponse.json({ error: message }, { status });
}

async function freeTable(tx, order) {
  if (!order.tableId) return;
  // Only clear the pointer when it still points at THIS order, so a
  // table re-seated by a newer order is never freed by an old one.
  await tx.table.updateMany({
    where: { id: order.tableId, currentOrderId: order.id },
    data: { status: "FREE", currentOrderId: null },
  });
}

async function incrementCustomerTotals(tx, order) {
  if (!order.customerPhone) return;
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

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("Sign in required.", 401);
  if (!hasRole(user, ["admin", "cashier"])) {
    return errorResponse("You do not have permission to record payments.", 403);
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
  const method = body?.method;
  const amount = body?.amount;
  const reference = typeof body?.reference === "string" ? body.reference.trim() : "";
  const complete = body?.complete === true;

  if (!PAYMENT_METHODS.includes(method)) {
    return errorResponse(
      "Payment method must be CASH, CARD, JAZZCASH, EASYPAISA, or COD.",
      400,
    );
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return errorResponse("Payment amount must be a whole number of rupees, more than 0.", 400);
  }

  const settings = await getSettings();

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { payments: { select: { amount: true, status: true } } },
      });
      if (!order) {
        const err = new Error("Order not found.");
        err.status = 404;
        throw err;
      }
      if (order.status === "COMPLETED" || order.status === "CANCELLED") {
        const err = new Error(`Order is ${order.status} — no payment can be recorded.`);
        err.status = 409;
        throw err;
      }

      const alreadyPaid = order.payments.reduce(
        (sum, payment) => (payment.status === "PAID" ? sum + payment.amount : sum),
        0,
      );
      const remaining = order.grandTotal - alreadyPaid;
      if (amount > remaining) {
        const err = new Error(
          `Amount is more than the remaining balance of ${formatPKR(remaining, settings.currency)}. Overpayment is not accepted.`,
        );
        err.status = 400;
        throw err;
      }

      const newPaidTotal = alreadyPaid + amount;
      const fullyPaid = newPaidTotal >= order.grandTotal;

      if (complete && !fullyPaid) {
        const err = new Error(
          "Cannot complete: this payment does not settle the bill in full. Record the remaining balance first.",
        );
        err.status = 400;
        throw err;
      }
      if (complete && !COMPLETABLE_STATUSES.includes(order.status)) {
        const err = new Error(`Order in status ${order.status} cannot be completed.`);
        err.status = 409;
        throw err;
      }

      await tx.payment.create({
        data: {
          orderId,
          method,
          status: "PAID",
          amount,
          reference: reference || null,
          receivedById: user.id,
        },
      });

      const update = {};
      if (fullyPaid) update.paymentStatus = "PAID";
      // Transition guard: only increment customer totals when moving
      // INTO COMPLETED from a non-completed status. The status check
      // above already rejects COMPLETED orders, and this read is the
      // same transaction, so a double submit cannot double-count.
      const willComplete = complete && fullyPaid && order.status !== "COMPLETED";
      if (willComplete) update.status = "COMPLETED";
      if (Object.keys(update).length > 0) {
        await tx.order.update({ where: { id: orderId }, data: update });
      }
      if (willComplete) {
        await freeTable(tx, order);
        await incrementCustomerTotals(tx, order);
      }

      return {
        paidTotal: newPaidTotal,
        remaining: Math.max(0, order.grandTotal - newPaidTotal),
        completed: willComplete,
      };
    });
  } catch (err) {
    if (err?.status) {
      return errorResponse(err.message || "Payment could not be recorded.", err.status);
    }
    console.error("POST /api/orders/[id]/payment failed:", err);
    return errorResponse("Payment could not be recorded. Please try again.", 500);
  }

  const updated = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      table: { select: { id: true, code: true, name: true } },
      payments: {
        orderBy: { createdAt: "asc" },
        include: { receivedBy: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  return NextResponse.json({ order: updated, ...result });
}
