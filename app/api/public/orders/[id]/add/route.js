// SAVE AS: app/api/public/orders/[id]/add/route.js
// Append items to an existing order as a new batch ("add more" from the
// table QR flow or the tracking page). Body: { token, idempotencyKey,
// lines }. Prices come from the database (lib/order-create.js); totals
// are recomputed from stored snapshots (lib/order-totals.js) and the
// order status is re-derived from batches (lib/order-status.js).
//
// APPEND RULES: DINE_IN orders may append while open (status
// RECEIVED/PREPARING/READY and UNPAID). TAKEAWAY/DELIVERY may append
// only while RECEIVED (and UNPAID — a paid order's totals must never
// change behind a payment). Anything else gets 409 with a message
// telling the customer a new order is required.
//
// IDEMPOTENCY (BEST-EFFORT, documented honestly): OrderBatch has no
// idempotency-key column, and Redis must never be the source of truth,
// so appends cannot be made strictly idempotent in PostgreSQL without a
// schema change. Mitigation is two-layer: (1) the client disables the
// submit button while a request is pending and reuses one key per
// attempt; (2) after a SUCCESSFUL append the server stores
// `append-dedupe:<orderId>:<key>` in Redis with a 10-minute TTL — a
// retry with the same key inside that window returns the current order
// summary without appending again. If Redis is down or unconfigured the
// guard is skipped (fail-open, never blocks ordering). The guard is set
// AFTER success so a failed append stays retryable with the same key.
// Two requests racing at the same moment can still both append; the
// client-side disable is the guard for that case.

import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getSettings } from "@/lib/settings-data";
import { checkRateLimit } from "@/lib/rate-limit";
import { priceOrderLines } from "@/lib/order-create";
import { recomputeOrderTotals } from "@/lib/order-totals";
import { recalcOrderStatus } from "@/lib/order-status";

const OPEN_STATUSES = ["RECEIVED", "PREPARING", "READY"];
const DEDUPE_TTL_SECONDS = 600;

function tokensMatch(provided, actual) {
  if (typeof provided !== "string" || typeof actual !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function orderSummary(order, batchNumber) {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    subtotal: order.subtotal,
    grandTotal: order.grandTotal,
    batchNumber,
  };
}

async function dedupeGuardSeen(orderId, key) {
  if (!redis) return false;
  try {
    const value = await redis.get(`append-dedupe:${orderId}:${key}`);
    return value !== null && value !== undefined;
  } catch {
    return false;
  }
}

async function dedupeGuardMark(orderId, key) {
  if (!redis) return;
  try {
    await redis.set(`append-dedupe:${orderId}:${key}`, "1", {
      ex: DEDUPE_TTL_SECONDS,
    });
  } catch {
    // Best-effort only; a failed mark never fails the append.
  }
}

export async function POST(request, context) {
  const { id } = await context.params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }

  const { allowed } = await checkRateLimit(
    `ratelimit:public-add:${orderId}`,
    20,
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

  const idempotencyKey =
    typeof body?.idempotencyKey === "string"
      ? body.idempotencyKey.trim()
      : "";
  if (!idempotencyKey) {
    return Response.json(
      { error: "idempotencyKey is required." },
      { status: 400 },
    );
  }
  if (!Array.isArray(body?.lines) || body.lines.length === 0) {
    return Response.json(
      { error: "At least one item is required." },
      { status: 400 },
    );
  }

  const canAppend =
    order.paymentStatus === "UNPAID" &&
    (order.type === "DINE_IN"
      ? OPEN_STATUSES.includes(order.status)
      : order.status === "RECEIVED");
  if (!canAppend) {
    return Response.json(
      {
        error:
          "This order can no longer be changed. Please place a new order.",
      },
      { status: 409 },
    );
  }

  // Best-effort dedupe replay: same key within 10 minutes of a
  // successful append returns the current summary without appending.
  if (await dedupeGuardSeen(orderId, idempotencyKey)) {
    const current = await prisma.order.findUnique({
      where: { id: orderId },
      include: { batches: { orderBy: { batchNumber: "desc" }, take: 1 } },
    });
    return Response.json({
      ...orderSummary(current, current.batches[0]?.batchNumber ?? 1),
      replayed: true,
    });
  }

  try {
    const settings = await getSettings();

    const result = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: the order may have been paid
      // or advanced by staff between the read above and this write.
      const fresh = await tx.order.findUnique({ where: { id: orderId } });
      const stillAppendable =
        fresh &&
        fresh.paymentStatus === "UNPAID" &&
        (fresh.type === "DINE_IN"
          ? OPEN_STATUSES.includes(fresh.status)
          : fresh.status === "RECEIVED");
      if (!stillAppendable) {
        const error = new Error(
          "This order can no longer be changed. Please place a new order.",
        );
        error.code = "ORDER_NOT_APPENDABLE";
        throw error;
      }

      const priced = await priceOrderLines(tx, body.lines, settings);

      const lastBatch = await tx.orderBatch.findFirst({
        where: { orderId },
        orderBy: { batchNumber: "desc" },
      });
      const batchNumber = (lastBatch?.batchNumber ?? 0) + 1;

      const batch = await tx.orderBatch.create({
        data: { orderId, batchNumber, status: "RECEIVED" },
      });
      for (const line of priced.lines) {
        await tx.orderItem.create({
          data: {
            batchId: batch.id,
            orderId,
            menuItemId: line.menuItemId,
            itemName: line.itemName,
            variantName: line.variantName,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            note: line.note,
            lineTotal: line.lineTotal,
            addons: {
              create: line.addons.map((addon) => ({
                addonName: addon.addonName,
                price: addon.price,
              })),
            },
          },
        });
      }

      const updated = await recomputeOrderTotals(tx, orderId);
      await recalcOrderStatus(tx, orderId);
      const final = await tx.order.findUnique({ where: { id: orderId } });
      void updated;
      return { order: final, batchNumber };
    });

    await dedupeGuardMark(orderId, idempotencyKey);
    return Response.json(
      orderSummary(result.order, result.batchNumber),
      { status: 201 },
    );
  } catch (error) {
    if (error?.code === "ORDER_VALIDATION") {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error?.code === "ORDER_NOT_APPENDABLE") {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("Public order append failed:", error);
    return Response.json(
      { error: "Could not add items. Please try again." },
      { status: 500 },
    );
  }
}
