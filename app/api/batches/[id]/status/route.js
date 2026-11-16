// SAVE AS: app/api/batches/[id]/status/route.js
// Kitchen batch status advance. Roles: admin, kitchen only.
// Kitchen staff may ONLY call this route and GET /api/kitchen — that
// is the whole kitchen API surface, and it is enforced here (this
// route) and on the kitchen feed, not by hiding links.
// Body: { status } — RECEIVED, PREPARING, or READY only. Batches never
// carry order-level states (OUT_FOR_DELIVERY / COMPLETED / CANCELLED).
// Forward-only: RECEIVED -> PREPARING -> READY. Sending the current
// status is a no-op 200 (safe double tap); sending an earlier status
// is 409. Batches on a COMPLETED/CANCELLED order cannot move (409).
// After the update, the parent order status is recomputed through
// recalcOrderStatus — THE ONE status helper — never hand-derived.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasRole } from "@/lib/session";
import { recalcOrderStatus } from "@/lib/order-status";

const BATCH_STATUSES = ["RECEIVED", "PREPARING", "READY"];
const ORDER = { RECEIVED: 0, PREPARING: 1, READY: 2 };

function errorResponse(message, status) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("Sign in required.", 401);
  if (!hasRole(user, ["admin", "kitchen"])) {
    return errorResponse("You do not have permission to update kitchen batches.", 403);
  }

  const { id } = await params;
  const batchId = Number.parseInt(id, 10);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    return errorResponse("Batch not found.", 404);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }
  const next = body?.status;
  if (!BATCH_STATUSES.includes(next)) {
    return errorResponse("Batch status must be RECEIVED, PREPARING, or READY.", 400);
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const batch = await tx.orderBatch.findUnique({
        where: { id: batchId },
        include: { order: { select: { id: true, status: true } } },
      });
      if (!batch) {
        const err = new Error("Batch not found.");
        err.status = 404;
        throw err;
      }
      if (batch.order.status === "COMPLETED" || batch.order.status === "CANCELLED") {
        const err = new Error(
          `The order is ${batch.order.status} — its batches cannot move.`,
        );
        err.status = 409;
        throw err;
      }
      if (ORDER[next] < ORDER[batch.status]) {
        const err = new Error(
          `Batch status cannot go backwards from ${batch.status} to ${next}.`,
        );
        err.status = 409;
        throw err;
      }
      if (next === batch.status) {
        return { batch, orderStatus: batch.order.status, noop: true };
      }

      const updated = await tx.orderBatch.update({
        where: { id: batchId },
        data: { status: next },
      });
      const orderStatus = await recalcOrderStatus(tx, batch.orderId);
      return { batch: updated, orderStatus, noop: false };
    });
  } catch (err) {
    if (err?.status) {
      return errorResponse(err.message || "Batch status could not be updated.", err.status);
    }
    console.error("POST /api/batches/[id]/status failed:", err);
    return errorResponse("Batch status could not be updated. Please try again.", 500);
  }

  return NextResponse.json(result);
}
