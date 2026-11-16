// SAVE AS: app/api/public/orders/[id]/route.js
// Public order tracking read. The ?token= query value must equal the
// order's accessToken (constant-time comparison); anything else gets
// 403. Orders are NEVER served from cache — always read from PostgreSQL.
// Rate limited per order id so polling stays cheap but abuse is bounded.

import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getPublicSettings } from "@/lib/settings-data";
import { checkRateLimit } from "@/lib/rate-limit";

function tokensMatch(provided, actual) {
  if (typeof provided !== "string" || typeof actual !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function serializeOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    type: order.type,
    status: order.status,
    paymentStatus: order.paymentStatus,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    deliveryAddress: order.deliveryAddress,
    subtotal: order.subtotal,
    discount: order.discount,
    tax: order.tax,
    serviceCharge: order.serviceCharge,
    deliveryFee: order.deliveryFee,
    grandTotal: order.grandTotal,
    discountReason: order.discountReason,
    waiterCalledAt: order.waiterCalledAt?.toISOString() ?? null,
    billRequestedAt: order.billRequestedAt?.toISOString() ?? null,
    cancelledReason: order.cancelledReason,
    notes: order.notes,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    table: order.table
      ? { id: order.table.id, code: order.table.code, name: order.table.name }
      : null,
    batches: order.batches.map((batch) => ({
      id: batch.id,
      batchNumber: batch.batchNumber,
      status: batch.status,
      createdAt: batch.createdAt.toISOString(),
      items: batch.items.map((item) => ({
        id: item.id,
        itemName: item.itemName,
        variantName: item.variantName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        note: item.note,
        lineTotal: item.lineTotal,
        addons: item.addons.map((addon) => ({
          id: addon.id,
          addonName: addon.addonName,
          price: addon.price,
        })),
      })),
    })),
  };
}

export async function GET(request, context) {
  const { id } = await context.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }

  const { allowed } = await checkRateLimit(
    `ratelimit:public-tracking:${orderId}`,
    60,
    60,
  );
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please try again in a moment." },
      { status: 429 },
    );
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      table: true,
      batches: {
        orderBy: { batchNumber: "asc" },
        include: { items: { include: { addons: true } } },
      },
    },
  });
  if (!order) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!tokensMatch(token, order.accessToken)) {
    return Response.json({ error: "Invalid tracking link." }, { status: 403 });
  }

  const settings = await getPublicSettings();

  return Response.json({
    order: serializeOrder(order),
    settings: {
      restaurantName: settings.restaurantName,
      currency: settings.currency,
      phone: settings.phone ?? null,
    },
  });
}
