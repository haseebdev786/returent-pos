// SAVE AS: app/api/delivery/route.js
// Delivery board feed. Roles: admin, cashier, rider.
// Admins/cashiers see all DELIVERY orders; riders see ONLY orders
// assigned to them (riderId == own id), filtered SERVER-side — the
// client never decides what a rider may see. The feed shows active
// orders plus orders completed today (local day), newest first,
// paginated (?page= &pageSize=, max 50). Each order carries the rider,
// phone/address, paid total, and remaining balance — the COD amount
// still to collect — so the board can show it prominently.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";

const ACTIVE_STATUSES = ["RECEIVED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];

function errorResponse(message, status) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("Sign in required.", 401);
  if (!hasRole(user, ["admin", "cashier", "rider"])) {
    return errorResponse("You do not have permission to view deliveries.", 403);
  }

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, Number.parseInt(params.get("pageSize") || "20", 10) || 20),
  );

  // Local midnight: "today" follows the shop's wall clock, not UTC.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const where = {
    type: "DELIVERY",
    OR: [
      { status: { in: ACTIVE_STATUSES } },
      { status: "COMPLETED", updatedAt: { gte: todayStart } },
    ],
  };
  if (user.role === "rider") {
    where.riderId = user.id;
  }

  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        rider: { select: { id: true, name: true, email: true } },
        payments: { select: { amount: true, status: true } },
        _count: { select: { batches: true } },
      },
    }),
  ]);

  const orders = rows.map((order) => {
    const paidTotal = order.payments.reduce(
      (sum, payment) => (payment.status === "PAID" ? sum + payment.amount : sum),
      0,
    );
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
