// SAVE AS: app/api/kitchen/route.js
// Kitchen display feed. Roles: admin, kitchen only. This and
// POST /api/batches/[id]/status are the ONLY API routes kitchen staff
// may call.
// Returns every batch of every order whose status is RECEIVED,
// PREPARING, or READY — including READY batches, which stay on the
// screen until the order is completed or cancelled — oldest first, so
// the longest-waiting ticket is always on top. No pagination: a KDS
// must show all active work, not a page of it. Each batch carries its
// order (number, type, table code, customer, notes) and its snapshot
// items with addons, plus createdAt for the elapsed timer.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";

const ACTIVE_ORDER_STATUSES = ["RECEIVED", "PREPARING", "READY"];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!hasRole(user, ["admin", "kitchen"])) {
    return NextResponse.json(
      { error: "You do not have permission to view the kitchen display." },
      { status: 403 },
    );
  }

  const batches = await prisma.orderBatch.findMany({
    where: { order: { status: { in: ACTIVE_ORDER_STATUSES } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          type: true,
          status: true,
          customerName: true,
          customerPhone: true,
          notes: true,
          createdAt: true,
          table: { select: { id: true, code: true, name: true } },
        },
      },
      items: {
        orderBy: { id: "asc" },
        include: { addons: { orderBy: { id: "asc" } } },
      },
    },
  });

  return NextResponse.json({ batches });
}
