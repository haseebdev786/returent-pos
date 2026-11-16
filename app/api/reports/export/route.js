// SAVE AS: app/api/reports/export/route.js
// CSV export of completed bills for a date range. Roles: admin,
// cashier — the same staff who can view /reports. The range follows
// the reports page exactly: ?from=YYYY-MM-DD&to=YYYY-MM-DD, both days
// fully included ([from 00:00 local, day-after-to 00:00 local));
// an invalid or reversed range falls back to the last 30 days
// including today. Cancelled bills are excluded, matching the sales
// figures. Read-only: no order data is changed.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";
import { nextDayStart, parseLocalDateKey } from "@/lib/reports-data";
import { todayKey } from "@/lib/format";

const HEADERS = [
  "Order",
  "Date",
  "Type",
  "Table",
  "Customer",
  "Items",
  "Subtotal",
  "Discount",
  "Tax",
  "Service charge",
  "Delivery fee",
  "Total",
  "Payment status",
];

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!hasRole(user, ["admin", "cashier"])) {
    return NextResponse.json(
      { error: "You do not have permission to export reports." },
      { status: 403 },
    );
  }

  const params = request.nextUrl.searchParams;
  const now = new Date();
  const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const defaultFrom = new Date(
    defaultTo.getFullYear(),
    defaultTo.getMonth(),
    defaultTo.getDate() - 29,
  );
  let from = parseLocalDateKey(params.get("from"));
  let to = parseLocalDateKey(params.get("to"));
  if (!from || !to || from > to) {
    from = defaultFrom;
    to = defaultTo;
  }
  const toExclusive = nextDayStart(to);

  const orders = await prisma.order.findMany({
    where: {
      status: "COMPLETED",
      createdAt: { gte: from, lt: toExclusive },
    },
    orderBy: { createdAt: "asc" },
    select: {
      orderNumber: true,
      createdAt: true,
      type: true,
      customerName: true,
      subtotal: true,
      discount: true,
      tax: true,
      serviceCharge: true,
      deliveryFee: true,
      grandTotal: true,
      paymentStatus: true,
      table: { select: { code: true } },
      _count: { select: { items: true } },
    },
  });

  const lines = [HEADERS.map(csvCell).join(",")];
  for (const order of orders) {
    lines.push(
      [
        order.orderNumber,
        order.createdAt.toISOString(),
        order.type,
        order.table?.code ?? "",
        order.customerName ?? "",
        order._count.items,
        order.subtotal,
        order.discount,
        order.tax,
        order.serviceCharge,
        order.deliveryFee,
        order.grandTotal,
        order.paymentStatus,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const filename = `sales-${todayKey(from)}_to_${todayKey(to)}.csv`;
  return new NextResponse(`${lines.join("\n")}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
