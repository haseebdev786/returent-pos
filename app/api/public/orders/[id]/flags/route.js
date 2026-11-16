// SAVE AS: app/api/public/orders/[id]/flags/route.js
// Dine-in table flags: call the waiter / request the bill. Body:
// { token, action: "waiter" | "bill" }. Sets waiterCalledAt or
// billRequestedAt to now. DINE_IN open orders only; staff screens (a
// later phase) surface these timestamps. Rate limited per order so a
// stuck button cannot spam the staff.

import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

const OPEN_STATUSES = ["RECEIVED", "PREPARING", "READY"];

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
    `ratelimit:public-flags:${orderId}`,
    6,
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

  const action = body?.action;
  if (action !== "waiter" && action !== "bill") {
    return Response.json(
      { error: 'action must be "waiter" or "bill".' },
      { status: 400 },
    );
  }
  if (order.type !== "DINE_IN") {
    return Response.json(
      { error: "This is only available for dine-in orders." },
      { status: 409 },
    );
  }
  if (
    order.status === "CANCELLED" ||
    order.status === "COMPLETED" ||
    !OPEN_STATUSES.includes(order.status)
  ) {
    return Response.json(
      { error: "This order is no longer open." },
      { status: 409 },
    );
  }

  const now = new Date();
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: action === "waiter" ? { waiterCalledAt: now } : { billRequestedAt: now },
  });

  return Response.json({
    ok: true,
    action,
    at: (action === "waiter"
      ? updated.waiterCalledAt
      : updated.billRequestedAt
    )?.toISOString(),
  });
}
