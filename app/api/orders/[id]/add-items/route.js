// SAVE AS: app/api/orders/[id]/add-items/route.js
// Add a new batch to a running order (a later order adds to the same
// bill). Roles: admin, cashier.
// Body: { lines: [{ menuItemId, variantId?, addonIds?, quantity, note? }] }
// Rules: the order must be RECEIVED, PREPARING, or READY — never
// COMPLETED, CANCELLED, or already OUT_FOR_DELIVERY (the rider has
// left) — and must not be PAID: a paid bill cannot grow (409).
// Inside one transaction the lines are priced by lib/order-create.js
// (same validation as checkout), a new batch (max batchNumber + 1) is
// created with snapshot items, totals are recomputed from snapshots
// (the stored discount is preserved), and the order status is derived
// through recalcOrderStatus — never hand-derived here.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { priceOrderLines } from "@/lib/order-create";
import { recalcOrderStatus } from "@/lib/order-status";
import { recomputeOrderTotals } from "@/lib/order-totals";

const GROWABLE_STATUSES = ["RECEIVED", "PREPARING", "READY"];

function errorResponse(message, status) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("Sign in required.", 401);
  if (!hasRole(user, ["admin", "cashier"])) {
    return errorResponse("You do not have permission to add items to orders.", 403);
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
  const lines = body?.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    return errorResponse("At least one order line is required.", 400);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, paymentStatus: true, orderNumber: true },
  });
  if (!order) return errorResponse("Order not found.", 404);
  if (!GROWABLE_STATUSES.includes(order.status)) {
    return errorResponse(
      `Order ${order.orderNumber} is ${order.status} and cannot take more items.`,
      409,
    );
  }
  if (order.paymentStatus === "PAID") {
    return errorResponse(
      "This order is already paid. A paid bill cannot grow — create a new order instead.",
      409,
    );
  }

  const settings = await getSettings();

  try {
    await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: the order may have been paid
      // or completed between the read above and this write.
      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true, paymentStatus: true },
      });
      if (!current) {
        const err = new Error("Order not found.");
        err.status = 404;
        throw err;
      }
      if (!GROWABLE_STATUSES.includes(current.status) || current.paymentStatus === "PAID") {
        const err = new Error("This order can no longer take more items.");
        err.status = 409;
        throw err;
      }

      let priced;
      try {
        priced = await priceOrderLines(tx, lines, settings);
      } catch (err) {
        err.isValidation = true;
        throw err;
      }

      const lastBatch = await tx.orderBatch.findFirst({
        where: { orderId },
        orderBy: { batchNumber: "desc" },
        select: { batchNumber: true },
      });
      const batch = await tx.orderBatch.create({
        data: {
          orderId,
          batchNumber: (lastBatch?.batchNumber || 0) + 1,
          status: "RECEIVED",
        },
        select: { id: true },
      });

      for (const line of priced.lines) {
        await tx.orderItem.create({
          data: {
            batchId: batch.id,
            orderId,
            menuItemId: line.menuItemId,
            itemName: line.itemName,
            variantName: line.variantName ?? null,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            note: line.note ?? null,
            lineTotal: line.lineTotal,
            addons: {
              create: (line.addons || []).map((addon) => ({
                addonName: addon.addonName,
                price: addon.price,
              })),
            },
          },
        });
      }

      await recomputeOrderTotals(tx, orderId);
      await recalcOrderStatus(tx, orderId);
    });
  } catch (err) {
    if (err?.isValidation || err?.code === "ORDER_VALIDATION") {
      return errorResponse(err.message || "Items could not be added.", 400);
    }
    if (err?.status) {
      return errorResponse(err.message || "Items could not be added.", err.status);
    }
    console.error("POST /api/orders/[id]/add-items failed:", err);
    return errorResponse("Items could not be added. Please try again.", 500);
  }

  const updated = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      table: { select: { id: true, code: true, name: true } },
      batches: {
        orderBy: { batchNumber: "asc" },
        include: { items: { include: { addons: true } } },
      },
      payments: true,
    },
  });
  return NextResponse.json({ order: updated });
}
