// SAVE AS: components/DeliveryBoard.jsx
"use client";

// Delivery board: cards with the customer's phone (tap-to-call),
// address, and the COD amount still to collect shown prominently.
// Admins/cashiers can assign a rider per order; riders see only their
// own assigned orders (filtered server-side by the page and the API).
// "Out for delivery" and "Delivered" call POST
// /api/orders/[id]/delivery-status and refresh the server-rendered
// list on success. "Delivered" is only offered when the order is out
// for delivery; the API additionally requires full payment first, so a
// COD order cannot be closed before its payment is recorded.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Icon } from "@/components/ui";
import { formatDateTime, formatPKR } from "@/lib/format";

const STATUS_LABELS = {
  RECEIVED: "Received",
  PREPARING: "Preparing",
  READY: "Ready",
  OUT_FOR_DELIVERY: "Out for delivery",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
const STATUS_TONES = {
  RECEIVED: "blue",
  PREPARING: "amber",
  READY: "green",
  OUT_FOR_DELIVERY: "orange",
  COMPLETED: "emerald",
  CANCELLED: "red",
};
const PAYMENT_LABELS = { UNPAID: "Unpaid", PAID: "Paid", REFUNDED: "Refunded" };
const PAYMENT_TONES = { UNPAID: "amber", PAID: "green", REFUNDED: "slate" };

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Request failed.");
  return data;
}

function DeliveryCard({ order, riders, canAssign, currency }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [riderId, setRiderId] = useState(order.riderId || "");
  const [riderBusy, setRiderBusy] = useState(false);

  async function changeStatus(action) {
    setError("");
    setBusy(true);
    try {
      await postJson(`/api/orders/${order.id}/delivery-status`, { status: action });
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveRider() {
    setError("");
    setRiderBusy(true);
    try {
      await postJson(`/api/orders/${order.id}/assign-rider`, { riderId: riderId || null });
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setRiderBusy(false);
    }
  }

  const isOpen = !["COMPLETED", "CANCELLED"].includes(order.status);

  return (
    <article className="card card-pad space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {canAssign ? (
            <Link href={`/orders/${order.id}`} className="link text-base font-bold">
              {order.orderNumber}
            </Link>
          ) : (
            <p className="text-base font-bold text-slate-900">{order.orderNumber}</p>
          )}
          <p className="text-sm text-slate-500">{formatDateTime(order.createdAt)}</p>
        </div>
        <span className="flex flex-wrap gap-1.5">
          <Badge tone={STATUS_TONES[order.status] || "slate"}>
            {STATUS_LABELS[order.status] || order.status}
          </Badge>
          <Badge tone={PAYMENT_TONES[order.paymentStatus] || "slate"}>
            {PAYMENT_LABELS[order.paymentStatus] || order.paymentStatus}
          </Badge>
        </span>
      </div>

      <div className="space-y-1 text-sm">
        <p className="font-medium text-slate-900">{order.customerName || "Customer"}</p>
        {order.customerPhone ? (
          <p>
            <a
              href={`tel:${order.customerPhone}`}
              className="link inline-flex items-center gap-1.5"
            >
              <Icon name="phone" className="h-4 w-4" />
              {order.customerPhone}
            </a>
          </p>
        ) : null}
        {order.deliveryAddress ? (
          <p className="flex items-start gap-1.5 break-words text-slate-700">
            <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0" />
            {order.deliveryAddress}
          </p>
        ) : null}
        {order.notes ? <p className="text-slate-600">Note: {order.notes}</p> : null}
      </div>

      <div className="rounded-lg bg-slate-50 px-3 py-2">
        <div className="flex justify-between gap-2 text-sm">
          <span className="text-slate-600">Bill total</span>
          <span className="font-medium">{formatPKR(order.grandTotal, currency)}</span>
        </div>
        <div className="flex justify-between gap-2 text-sm">
          <span className="text-slate-600">Paid</span>
          <span className="font-medium">{formatPKR(order.paidTotal, currency)}</span>
        </div>
        <div className="flex justify-between gap-2 pt-1 text-base font-bold">
          <span>{order.remaining > 0 ? "COD to collect" : "Nothing to collect"}</span>
          <span className={order.remaining > 0 ? "text-brand-700" : ""}>
            {formatPKR(order.remaining, currency)}
          </span>
        </div>
      </div>

      <p className="text-sm text-slate-600">
        Rider: {order.rider ? `${order.rider.name} (${order.rider.email})` : "Unassigned"}
      </p>

      {canAssign && isOpen ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-44 flex-1">
            <label htmlFor={`rider-${order.id}`} className="label">
              Assign rider
            </label>
            <select
              id={`rider-${order.id}`}
              value={riderId}
              onChange={(event) => setRiderId(event.target.value)}
              className="input"
            >
              <option value="">Unassigned</option>
              {(riders || []).map((rider) => (
                <option key={rider.id} value={rider.id}>
                  {rider.name} ({rider.email})
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={saveRider}
            disabled={riderBusy}
            className="btn btn-secondary btn-sm"
          >
            {riderBusy ? "Saving…" : "Save rider"}
          </button>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {order.status === "READY" ? (
          <button
            type="button"
            onClick={() => changeStatus("OUT_FOR_DELIVERY")}
            disabled={busy}
            className="btn btn-primary"
          >
            {busy ? "Updating…" : "Out for delivery"}
          </button>
        ) : null}
        {order.status === "OUT_FOR_DELIVERY" ? (
          <>
            <button
              type="button"
              onClick={() => changeStatus("DELIVERED")}
              disabled={busy}
              className="btn btn-primary"
            >
              {busy ? "Updating…" : "Mark delivered"}
            </button>
            {order.paymentStatus !== "PAID" ? (
              <p className="form-note self-center">
                Delivery can only be completed after the{" "}
                {formatPKR(order.remaining, currency)} COD payment is recorded at the counter.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}

export default function DeliveryBoard({ orders, riders, canAssign, currency }) {
  if (!orders || orders.length === 0) {
    return (
      <div className="card card-pad py-10 text-center">
        <h2 className="section-title">No deliveries</h2>
        <p className="section-desc mx-auto max-w-sm">
          {canAssign
            ? "No active delivery orders and none completed today."
            : "No deliveries are assigned to you right now."}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {orders.map((order) => (
        <DeliveryCard
          key={order.id}
          order={order}
          riders={riders}
          canAssign={canAssign}
          currency={currency}
        />
      ))}
    </div>
  );
}
