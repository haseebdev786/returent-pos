// SAVE AS: app/api/public/orders/route.js
// Public checkout: place a new order from QR table ordering or the
// online ordering page. No auth. The client sends ONLY ids, quantities
// and notes — every price and total is resolved server-side from the
// database (lib/order-create.js). Client prices/totals are never read.
//
// IDEMPOTENCY: idempotencyKey (client-generated UUID, one per checkout
// attempt, reused on retry) is required. If an order already exists with
// that key, the existing order summary is returned with 200 and no
// duplicate is created.
//
// DINE-IN APPEND RULE: this route NEVER appends to an open order. If the
// table already has an open order (status RECEIVED/PREPARING/READY,
// whatever its payment status — a paid bill still holds the table until
// staff complete it), the route returns { needsAppend: true, ... }
// and the client must call POST /api/public/orders/[id]/add with the
// accessToken it stored in localStorage when the order was placed.
// (An append to a paid order is rejected 409 by the add route; the
// customer asks staff to complete the bill.)
// SECURITY NOTE (deliberate deviation from the first draft shape): the
// needsAppend response does NOT include the order's accessToken. Table
// codes are short and guessable, so handing the bearer token to any
// unauthenticated caller who names a table code would let anyone cancel
// or append to another table's order. The device that placed the order
// already holds the token in localStorage; other devices see the open
// bill summary only.
//
// MINIMUM ORDER: enforced on the food subtotal (the priced subtotal,
// before discount) against Settings.minOrderAmount when min > 0 — the
// same base the staff manual-order route uses. Public orders carry no
// discount, so this is the priced subtotal.
//
// CUSTOMER UPSERT: when a phone is present, the Customer row is created
// or updated (name/address only). totalOrders/totalSpent are NOT touched
// here — they increment on order completion, owned by the staff phase.
//
// RACE: two simultaneous checkouts for one table could both pass the
// open-order check; the second Table update then fails on the
// currentOrderId unique constraint (P2002). That case is caught, the
// open order is re-read, and needsAppend is returned instead of a 500.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings-data";
import { checkRateLimit } from "@/lib/rate-limit";
import { nextOrderNumber } from "@/lib/order-number";
import {
  buildOrderTotals,
  priceOrderLines,
} from "@/lib/order-create";

const OPEN_STATUSES = ["RECEIVED", "PREPARING", "READY"];
const MAX_NAME_LENGTH = 100;
const MAX_PHONE_LENGTH = 30;
const MAX_ADDRESS_LENGTH = 300;
const MAX_NOTES_LENGTH = 500;
const MAX_KEY_LENGTH = 128;

function fail(message) {
  const error = new Error(message);
  error.code = "ORDER_VALIDATION";
  return error;
}

function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
}

function cleanString(value, maxLength) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function orderSummary(order) {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    accessToken: order.accessToken,
    grandTotal: order.grandTotal,
    status: order.status,
  };
}

async function findOpenOrderForTable(tx, tableId) {
  // Status-only: a paid bill still holds its table until staff complete
  // it, so it must report needsAppend too — otherwise checkout would
  // hit the Table.currentOrderId unique constraint and return a 500.
  return tx.order.findFirst({
    where: {
      tableId,
      status: { in: OPEN_STATUSES },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function POST(request) {
  const { allowed } = await checkRateLimit(
    `ratelimit:public-order:${clientIp(request)}`,
    20,
    60,
  );
  if (!allowed) {
    return Response.json(
      { error: "Too many orders. Please wait a moment and try again." },
      { status: 429 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const type = body?.type;
    if (type !== "DINE_IN" && type !== "TAKEAWAY" && type !== "DELIVERY") {
      throw fail("Order type must be DINE_IN, TAKEAWAY or DELIVERY.");
    }

    const idempotencyKey = cleanString(body?.idempotencyKey, MAX_KEY_LENGTH);
    if (!idempotencyKey) {
      throw fail("idempotencyKey is required.");
    }
    if (body.idempotencyKey.length > MAX_KEY_LENGTH) {
      throw fail("idempotencyKey is too long.");
    }

    if (!Array.isArray(body?.lines) || body.lines.length === 0) {
      throw fail("At least one item is required.");
    }

    const customerName = cleanString(body?.customerName, MAX_NAME_LENGTH);
    const customerPhone = cleanString(body?.customerPhone, MAX_PHONE_LENGTH);
    const deliveryAddress = cleanString(
      body?.deliveryAddress,
      MAX_ADDRESS_LENGTH,
    );
    const notes = cleanString(body?.notes, MAX_NOTES_LENGTH);
    const tableCode =
      typeof body?.tableCode === "string" ? body.tableCode.trim() : null;

    // Idempotent replay FIRST, before the dine-in open-order check:
    // a retried checkout (same key, response lost) must return its
    // original order — not needsAppend for the order it just created.
    const replayed = await prisma.order.findUnique({
      where: { idempotencyKey },
    });
    if (replayed) {
      return Response.json({ ...orderSummary(replayed), replayed: true });
    }

    // Type-specific required fields (validated before any DB write).
    let table = null;
    if (type === "DINE_IN") {
      if (!tableCode) throw fail("Table code is required for dine-in orders.");
      table = await prisma.table.findUnique({ where: { code: tableCode } });
      if (!table || !table.isActive) {
        throw fail("That table is not available for ordering.");
      }
      // Fast-path check; the authoritative check runs inside the
      // transaction below, where the table row is written.
      const existing = await findOpenOrderForTable(prisma, table.id);
      if (existing) {
        return Response.json({
          needsAppend: true,
          orderId: existing.id,
          orderNumber: existing.orderNumber,
          status: existing.status,
          grandTotal: existing.grandTotal,
        });
      }
    } else if (type === "TAKEAWAY") {
      if (!customerName || !customerPhone) {
        throw fail("Name and phone are required for takeaway orders.");
      }
    } else {
      if (!customerName || !customerPhone || !deliveryAddress) {
        throw fail("Name, phone and delivery address are required.");
      }
    }

    const settings = await getSettings();

    const result = await prisma.$transaction(async (tx) => {
      // Authoritative open-order check inside the transaction.
      if (type === "DINE_IN") {
        const existing = await findOpenOrderForTable(tx, table.id);
        if (existing) {
          return {
            needsAppend: true,
            orderId: existing.id,
            orderNumber: existing.orderNumber,
            status: existing.status,
            grandTotal: existing.grandTotal,
          };
        }
      }

      const priced = await priceOrderLines(tx, body.lines, settings);
      const totals = buildOrderTotals(priced.lines, settings, type, 0);

      const minOrder = Math.round(Number(settings.minOrderAmount) || 0);
      if (minOrder > 0 && totals.subtotal < minOrder) {
        throw fail(
          `Minimum order is ${settings.currency} ${minOrder.toLocaleString("en-US")}.`,
        );
      }

      const orderNumber = await nextOrderNumber(tx);
      const accessToken = randomUUID();

      const order = await tx.order.create({
        data: {
          orderNumber,
          type,
          status: "RECEIVED",
          tableId: type === "DINE_IN" ? table.id : null,
          customerName,
          customerPhone,
          deliveryAddress: type === "DELIVERY" ? deliveryAddress : null,
          accessToken,
          idempotencyKey,
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          serviceCharge: totals.serviceCharge,
          deliveryFee: totals.deliveryFee,
          grandTotal: totals.grandTotal,
          taxRateApplied: totals.taxRateApplied,
          serviceChargeRateApplied: totals.serviceChargeRateApplied,
          deliveryFeeApplied: totals.deliveryFeeApplied,
          paymentStatus: "UNPAID",
          notes,
          batches: { create: { batchNumber: 1, status: "RECEIVED" } },
        },
        include: { batches: true },
      });

      // Items are created explicitly (not nested under the batch): an
      // OrderItem carries BOTH batchId and orderId, and Prisma does not
      // fill orderId from a nested batch create — it must be set here.
      const batch = order.batches[0];
      for (const line of priced.lines) {
        await tx.orderItem.create({
          data: {
            batchId: batch.id,
            orderId: order.id,
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

      if (type === "DINE_IN") {
        await tx.table.update({
          where: { id: table.id },
          data: { status: "OCCUPIED", currentOrderId: order.id },
        });
      }

      if (customerPhone) {
        // Name/address only. totalOrders/totalSpent increment on order
        // completion (staff phase) — never here.
        const update = {};
        if (customerName) update.name = customerName;
        if (deliveryAddress) update.address = deliveryAddress;
        await tx.customer.upsert({
          where: { phone: customerPhone },
          create: {
            phone: customerPhone,
            name: customerName,
            address: deliveryAddress,
          },
          update: Object.keys(update).length > 0 ? update : { phone: customerPhone },
        });
      }

      return orderSummary(order);
    });

    if (result.needsAppend) return Response.json(result);
    return Response.json(result, { status: 201 });
  } catch (error) {
    // Table race: a concurrent checkout won the table between the
    // checks. Re-read; if an open order now exists, report needsAppend.
    if (error?.code === "P2002" && body?.type === "DINE_IN") {
      try {
        const code =
          typeof body?.tableCode === "string" ? body.tableCode.trim() : "";
        const table = code
          ? await prisma.table.findUnique({ where: { code } })
          : null;
        const existing = table
          ? await findOpenOrderForTable(prisma, table.id)
          : null;
        if (existing) {
          return Response.json({
            needsAppend: true,
            orderId: existing.id,
            orderNumber: existing.orderNumber,
            status: existing.status,
            grandTotal: existing.grandTotal,
          });
        }
      } catch {
        // Fall through to the generic error below.
      }
    }
    if (error?.code === "ORDER_VALIDATION") {
      return Response.json({ error: error.message }, { status: 400 });
    }
    // Idempotency-key race: a concurrent request with the same key won.
    // Return the winner instead of a 500.
    if (error?.code === "P2002" && typeof body?.idempotencyKey === "string") {
      const winner = await prisma.order
        .findUnique({ where: { idempotencyKey: body.idempotencyKey.trim() } })
        .catch(() => null);
      if (winner) {
        return Response.json({ ...orderSummary(winner), replayed: true });
      }
    }
    console.error("Public order placement failed:", error);
    return Response.json(
      { error: "Could not place the order. Please try again." },
      { status: 500 },
    );
  }
}
