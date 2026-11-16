// SAVE AS: app/api/orders/route.js
// Staff order list + staff manual order creation (counter orders).
// Roles: admin, cashier only — kitchen uses /api/kitchen, riders use
// /api/delivery. Every request re-checks the session role server-side.
//
// GET: paginated list, newest first. Filters: ?status= &type= &q=
// (matches orderNumber, customer phone, or customer name) &page=
// &pageSize= (max 50). Each row carries its table, batch count, paid
// total, and remaining balance (grandTotal - PAID payments).
//
// POST: staff manual order. Body:
//   { type, tableCode?, customerName?, customerPhone?,
//     deliveryAddress?, notes?, lines, discount?, discountReason? }
// CONTACT RULES (deliberately looser than public checkout — walk-in
// counter context, where the customer is standing at the till and staff
// can ask for missing details; do NOT force-align the two):
//   Staff (this route): TAKEAWAY needs a name OR a phone;
//   DELIVERY needs phone + address (name optional).
//   Public (/api/public/orders): TAKEAWAY needs name + phone;
//   DELIVERY needs name + phone + address.
// Validation below:
// DINE_IN requires an active table with no open order (409 otherwise —
// use add-items on the open order); DELIVERY requires phone + address;
// TAKEAWAY requires a name or a phone so the pickup can be identified.
// Prices are NEVER trusted from the client: lines are priced inside
// the transaction by lib/order-create.js (priceOrderLines), and totals
// by buildOrderTotals. Discount must be >= 0, <= subtotal, and carry a
// reason when > 0. The Settings minimum order (minOrderAmount) is
// enforced here on the food subtotal — it belongs to the API layer,
// not to the totals helper. The order's applied-rate snapshots come
// from buildOrderTotals' return value (taxRateApplied /
// serviceChargeRateApplied / deliveryFeeApplied) and freeze the
// Settings in force at order time: the rates are 0 when the charge is
// disabled, because lib/order-totals.js recomputes tax/service from
// the applied rates unconditionally — a disabled charge must snapshot
// as 0 or later recomputes would invent a charge never applied.

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";
import { getSettings } from "@/lib/settings-data";
import { buildOrderTotals, priceOrderLines } from "@/lib/order-create";
import { nextOrderNumber } from "@/lib/order-number";
import { roundMoney, formatPKR } from "@/lib/format";

const STAFF_ROLES = ["admin", "cashier"];
const ORDER_TYPES = ["DINE_IN", "TAKEAWAY", "DELIVERY"];
const ORDER_STATUSES = [
  "RECEIVED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
];
const OPEN_STATUSES = ["RECEIVED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];

function errorResponse(message, status) {
  return NextResponse.json({ error: message }, { status });
}

async function requireStaff() {
  const user = await getCurrentUser();
  if (!user) return { user: null, response: errorResponse("Sign in required.", 401) };
  if (!hasRole(user, STAFF_ROLES)) {
    return {
      user: null,
      response: errorResponse("You do not have permission to manage orders.", 403),
    };
  }
  return { user, response: null };
}

function paidTotalOf(payments) {
  return (payments || []).reduce(
    (sum, payment) => (payment.status === "PAID" ? sum + payment.amount : sum),
    0,
  );
}

export async function GET(request) {
  const { response } = await requireStaff();
  if (response) return response;

  const params = request.nextUrl.searchParams;
  const status = params.get("status") || "";
  const type = params.get("type") || "";
  const q = (params.get("q") || "").trim();
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, Number.parseInt(params.get("pageSize") || "20", 10) || 20),
  );

  if (status && !ORDER_STATUSES.includes(status)) {
    return errorResponse(`Unknown order status: ${status}.`, 400);
  }
  if (type && !ORDER_TYPES.includes(type)) {
    return errorResponse(`Unknown order type: ${type}.`, 400);
  }

  const where = {};
  if (status) where.status = status;
  if (type) where.type = type;
  if (q) {
    where.OR = [
      { orderNumber: { contains: q, mode: "insensitive" } },
      { customerPhone: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        table: { select: { id: true, code: true, name: true } },
        payments: { select: { amount: true, status: true } },
        _count: { select: { batches: true } },
      },
    }),
  ]);

  const orders = rows.map((order) => {
    const paidTotal = paidTotalOf(order.payments);
    const { payments, ...rest } = order;
    return {
      ...rest,
      batchCount: order._count.batches,
      paidTotal,
      remaining: Math.max(0, order.grandTotal - paidTotal),
    };
  });

  return NextResponse.json({
    orders,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

export async function POST(request) {
  const { response } = await requireStaff();
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const type = body?.type;
  if (!ORDER_TYPES.includes(type)) {
    return errorResponse("Order type must be DINE_IN, TAKEAWAY, or DELIVERY.", 400);
  }
  const lines = body?.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    return errorResponse("At least one order line is required.", 400);
  }
  const tableCode = typeof body?.tableCode === "string" ? body.tableCode.trim() : "";
  const customerName =
    typeof body?.customerName === "string" ? body.customerName.trim() : "";
  const customerPhone =
    typeof body?.customerPhone === "string" ? body.customerPhone.trim() : "";
  const deliveryAddress =
    typeof body?.deliveryAddress === "string" ? body.deliveryAddress.trim() : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const discount = body?.discount ?? 0;
  const discountReason =
    typeof body?.discountReason === "string" ? body.discountReason.trim() : "";

  if (!Number.isInteger(discount) || discount < 0) {
    return errorResponse("Discount must be a whole number of rupees, 0 or more.", 400);
  }
  if (discount > 0 && !discountReason) {
    return errorResponse("A discount reason is required when a discount is given.", 400);
  }

  if (type === "DINE_IN") {
    if (!tableCode) {
      return errorResponse("A table is required for a dine-in order.", 400);
    }
  } else if (tableCode) {
    return errorResponse("A table can only be set on a dine-in order.", 400);
  }
  if (type === "DELIVERY") {
    if (!customerPhone) {
      return errorResponse("A customer phone number is required for delivery.", 400);
    }
    if (!deliveryAddress) {
      return errorResponse("A delivery address is required for delivery.", 400);
    }
  }
  if (type === "TAKEAWAY" && !customerName && !customerPhone) {
    return errorResponse(
      "A customer name or phone number is required for takeaway, so the pickup can be identified.",
      400,
    );
  }

  const settings = await getSettings();

  let createdId;
  try {
    createdId = await prisma.$transaction(async (tx) => {
      // Dine-in table checks run inside the transaction so two counters
      // cannot seat two open orders on the same table.
      let table = null;
      if (type === "DINE_IN") {
        table = await tx.table.findUnique({ where: { code: tableCode } });
        if (!table || !table.isActive) {
          const err = new Error(`Table ${tableCode} was not found or is inactive.`);
          err.isValidation = true;
          throw err;
        }
        const openOrder = await tx.order.findFirst({
          where: { tableId: table.id, status: { in: OPEN_STATUSES } },
          select: { id: true, orderNumber: true },
          orderBy: { createdAt: "desc" },
        });
        if (openOrder) {
          const err = new Error(
            `Table ${tableCode} already has an open order (${openOrder.orderNumber}). Use add-items on that order instead of creating a new one.`,
          );
          err.isValidation = true;
          err.status = 409;
          throw err;
        }
      }

      // Pricing/validation errors from priceOrderLines are client
      // errors (400), not server errors — mark them so the outer catch
      // can tell them apart from genuine transaction failures.
      let priced;
      try {
        priced = await priceOrderLines(tx, lines, settings);
      } catch (err) {
        err.isValidation = true;
        throw err;
      }

      if (discount > priced.subtotal) {
        const err = new Error("Discount cannot be more than the order subtotal.");
        err.isValidation = true;
        throw err;
      }
      const minOrder = roundMoney(settings.minOrderAmount);
      if (minOrder > 0 && priced.subtotal < minOrder) {
        const err = new Error(
          `Minimum order is ${formatPKR(minOrder, settings.currency)}.`,
        );
        err.isValidation = true;
        throw err;
      }

      const totals = buildOrderTotals(priced.lines, settings, type, discount);
      const orderNumber = await nextOrderNumber(tx);

      // Order first, then batch, then items: OrderItem carries BOTH
      // batchId and orderId, and a nested create through batches would
      // only fill batchId — orderId must be set explicitly, so items
      // are created after the order id exists.
      const order = await tx.order.create({
        data: {
          orderNumber,
          type,
          status: "RECEIVED",
          tableId: table ? table.id : null,
          customerName: customerName || null,
          customerPhone: customerPhone || null,
          deliveryAddress: type === "DELIVERY" ? deliveryAddress : null,
          accessToken: randomUUID(),
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          serviceCharge: totals.serviceCharge,
          deliveryFee: totals.deliveryFee,
          grandTotal: totals.grandTotal,
          taxRateApplied: totals.taxRateApplied,
          serviceChargeRateApplied: totals.serviceChargeRateApplied,
          deliveryFeeApplied: totals.deliveryFeeApplied,
          discountReason: discount > 0 ? discountReason : null,
          paymentStatus: "UNPAID",
          notes: notes || null,
        },
        select: { id: true },
      });

      const batch = await tx.orderBatch.create({
        data: { orderId: order.id, batchNumber: 1, status: "RECEIVED" },
        select: { id: true },
      });

      for (const line of priced.lines) {
        await tx.orderItem.create({
          data: {
            batchId: batch.id,
            orderId: order.id,
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

      if (table) {
        await tx.table.update({
          where: { id: table.id },
          data: { status: "OCCUPIED", currentOrderId: order.id },
        });
      }

      // Customer record only — totals increment when the order is
      // COMPLETED (see the payment/complete/delivery-status routes),
      // never at creation, so cancelled orders never inflate history.
      if (customerPhone) {
        const existing = await tx.customer.findUnique({
          where: { phone: customerPhone },
        });
        if (existing) {
          const update = {};
          if (customerName) update.name = customerName;
          if (type === "DELIVERY" && deliveryAddress) update.address = deliveryAddress;
          if (Object.keys(update).length > 0) {
            await tx.customer.update({ where: { phone: customerPhone }, data: update });
          }
        } else {
          await tx.customer.create({
            data: {
              phone: customerPhone,
              name: customerName || null,
              address: type === "DELIVERY" ? deliveryAddress : null,
            },
          });
        }
      }

      return order.id;
    });
  } catch (err) {
    if (err?.isValidation || err?.code === "ORDER_VALIDATION") {
      return errorResponse(err.message || "Order could not be created.", err.status || 400);
    }
    console.error("POST /api/orders failed:", err);
    return errorResponse("Order could not be created. Please try again.", 500);
  }

  const created = await prisma.order.findUnique({
    where: { id: createdId },
    include: {
      table: { select: { id: true, code: true, name: true } },
      batches: {
        orderBy: { batchNumber: "asc" },
        include: { items: { include: { addons: true } } },
      },
      payments: true,
    },
  });
  return NextResponse.json({ order: created }, { status: 201 });
}
