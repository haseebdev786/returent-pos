// SAVE AS: components/KitchenBoard.jsx
"use client";

// Kitchen display board. Polls GET /api/kitchen every 5 seconds and
// replaces the batch list in place (no page reload, scroll position is
// kept because only the list state changes). Each card is ONE batch —
// a later "add items" run appears as its own new card, oldest first.
// The elapsed timer ticks every second from the batch createdAt.
// Buttons advance the batch forward only (Start preparing / Mark
// ready) via POST /api/batches/[id]/status; after each action the feed
// is refetched so the board always shows server truth.

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, EmptyState, Icon } from "@/components/ui";

const TYPE_LABELS = { DINE_IN: "Dine-in", TAKEAWAY: "Takeaway", DELIVERY: "Delivery" };
const TYPE_TONES = { DINE_IN: "orange", TAKEAWAY: "blue", DELIVERY: "green" };
const BATCH_TONES = { RECEIVED: "blue", PREPARING: "amber", READY: "green" };

function elapsedLabel(createdAt, now) {
  const diffMs = Math.max(0, now - new Date(createdAt).getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

export default function KitchenBoard() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyBatchId, setBusyBatchId] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const mountedRef = useRef(true);

  const fetchBatches = useCallback(async () => {
    try {
      const res = await fetch("/api/kitchen", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError(data?.error || "Kitchen feed could not be loaded.");
        return;
      }
      setBatches(data.batches || []);
      setError("");
    } catch {
      if (mountedRef.current) {
        setError("Kitchen feed could not be loaded. Check your connection.");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchBatches();
    const poll = setInterval(fetchBatches, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mountedRef.current = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [fetchBatches]);

  async function advanceBatch(batch, nextStatus) {
    setActionError("");
    setBusyBatchId(batch.id);
    try {
      const res = await fetch(`/api/batches/${batch.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data?.error || "Batch status could not be updated.");
        return;
      }
      await fetchBatches();
    } catch {
      setActionError("Batch status could not be updated. Check your connection.");
    } finally {
      setBusyBatchId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-600">Loading kitchen board…</p>;
  }

  if (error) {
    return (
      <div className="card card-pad space-y-3">
        <p className="form-error">{error}</p>
        <button type="button" onClick={fetchBatches} className="btn btn-secondary">
          Retry
        </button>
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <EmptyState
        icon="flame"
        title="No active orders"
        description="New orders will appear here as soon as they are placed."
      />
    );
  }

  return (
    <div className="space-y-3">
      {actionError ? <p className="form-error">{actionError}</p> : null}
      <p className="form-note">Auto-refreshes every 5 seconds · Oldest tickets first</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {batches.map((batch) => {
          const order = batch.order || {};
          const busy = busyBatchId === batch.id;
          return (
            <article
              key={batch.id}
              className={`card card-pad space-y-3 ${
                batch.status === "RECEIVED" ? "border-l-4 border-l-blue-500" : ""
              } ${batch.status === "PREPARING" ? "border-l-4 border-l-amber-500" : ""} ${
                batch.status === "READY" ? "border-l-4 border-l-emerald-500" : ""
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-bold text-slate-900">{order.orderNumber}</p>
                  <p className="text-sm text-slate-600">
                    Batch {batch.batchNumber}
                    {order.table ? ` · ${order.table.name} (${order.table.code})` : ""}
                    {order.customerName ? ` · ${order.customerName}` : ""}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-slate-700">
                  <Icon name="clock" className="h-4 w-4" />
                  {elapsedLabel(batch.createdAt, now)}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge tone={TYPE_TONES[order.type] || "slate"}>
                  {TYPE_LABELS[order.type] || order.type}
                </Badge>
                <Badge tone={BATCH_TONES[batch.status] || "slate"}>{batch.status}</Badge>
              </div>

              <ul className="divide-y divide-slate-100">
                {(batch.items || []).map((item) => (
                  <li key={item.id} className="py-2">
                    <p className="text-sm font-semibold text-slate-900">
                      <span className="mr-1.5 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-slate-900 px-1 text-xs font-bold text-white">
                        {item.quantity}x
                      </span>
                      {item.itemName}
                      {item.variantName ? ` (${item.variantName})` : ""}
                    </p>
                    {(item.addons || []).map((addon) => (
                      <p key={addon.id} className="pl-8 text-xs text-slate-600">
                        + {addon.addonName}
                      </p>
                    ))}
                    {item.note ? (
                      <p className="pl-8 text-xs font-medium text-amber-700">
                        Note: {item.note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>

              {order.notes ? (
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-slate-700">Order note: </span>
                  {order.notes}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                {batch.status === "RECEIVED" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => advanceBatch(batch, "PREPARING")}
                    className="btn btn-primary"
                  >
                    {busy ? "Updating…" : "Start preparing"}
                  </button>
                ) : null}
                {batch.status === "PREPARING" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => advanceBatch(batch, "READY")}
                    className="btn btn-primary"
                  >
                    {busy ? "Updating…" : "Mark ready"}
                  </button>
                ) : null}
                {batch.status === "READY" ? (
                  <p className="form-note self-center">
                    Ready — waiting for pickup / rider.
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
