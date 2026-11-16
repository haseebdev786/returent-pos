// SAVE AS: components/CounterClient.jsx
"use client";

// Client bits for the counter page: the auto-refresh toggle (polls via
// router.refresh() every 10s so the server-rendered table map and order
// list stay current without losing the page) and the per-order
// "clear flags" button (POST /api/orders/[id]/clear-flags). Errors are
// shown honestly on the button — a failed clear never looks done.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function CounterRefreshControls() {
  const router = useRouter();
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = setInterval(() => router.refresh(), 10000);
    return () => clearInterval(timer);
  }, [autoRefresh, router]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setAutoRefresh((value) => !value)}
        aria-pressed={autoRefresh}
        className={`pill ${autoRefresh ? "pill-active" : ""}`}
      >
        Auto-refresh {autoRefresh ? "on" : "off"}
      </button>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="btn btn-secondary btn-sm"
      >
        Refresh now
      </button>
    </div>
  );
}

export function ClearFlagsButton({ orderId, orderNumber }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/clear-flags`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Flags could not be cleared.");
        return;
      }
      router.refresh();
    } catch {
      setError("Flags could not be cleared. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="btn btn-secondary btn-sm"
      >
        {busy ? "Clearing…" : `Clear flags (${orderNumber})`}
      </button>
      {error ? <span className="text-xs font-medium text-red-600">{error}</span> : null}
    </span>
  );
}

export default CounterRefreshControls;
