// SAVE AS: components/OrderTrackingClient.jsx
"use client";

// Public order tracking UI for /order/[id]?token=.... Shows the status
// timeline, items grouped BY BATCH, server totals, and — while the
// order is still changeable — an add-more section (menu from props) and
// a cancel button (while RECEIVED). Status polls every 5s and stops
// once the order reaches COMPLETED or CANCELLED.
//
// canAdd arrives pre-computed from the server (type + status + payment
// status); the client re-derives addability from the polled status so
// the add-more section disappears the moment staff advance the order.
// The item picker pattern is intentionally duplicated from
// TableOrderClient (see the note at the top of that file).

import { useEffect, useMemo, useRef, useState } from "react";
import { formatPKR } from "@/lib/format";
import { Badge, Icon } from "@/components/ui";

const OPEN_STATUSES = ["RECEIVED", "PREPARING", "READY"];
const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED"];

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

const TYPE_LABELS = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

function timelineSteps(type) {
  if (type === "DELIVERY") {
    return ["RECEIVED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"];
  }
  return ["RECEIVED", "PREPARING", "READY", "COMPLETED"];
}

function canAddTo(order) {
  if (!order || order.paymentStatus !== "UNPAID") return false;
  if (order.type === "DINE_IN") return OPEN_STATUSES.includes(order.status);
  return order.status === "RECEIVED";
}

/** Client-side estimate for the add-more cart only. */
function estimateAdditions(lines, settings) {
  let subtotal = 0;
  for (const line of lines) {
    const addonSum = line.addons.reduce((sum, a) => sum + a.price, 0);
    subtotal += (line.unitPrice + addonSum) * line.quantity;
  }
  return subtotal;
}

// --- Item picker (add-more flow) ------------------------------------------

function ItemPicker({ item, currency, onAdd, onClose }) {
  const [variantId, setVariantId] = useState(item.variants[0]?.id ?? null);
  const [addonIds, setAddonIds] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const variant = item.variants.find((v) => v.id === variantId) ?? null;
  const selectedAddons = useMemo(() => {
    const out = [];
    for (const link of item.addonGroups) {
      for (const addon of link.group.addons) {
        if (addonIds.includes(addon.id)) out.push(addon);
      }
    }
    return out;
  }, [item, addonIds]);

  const unitPrice =
    item.price +
    (variant?.priceDelta ?? 0) +
    selectedAddons.reduce((sum, a) => sum + a.price, 0);

  const missingRequired = item.addonGroups
    .filter((link) => link.group.required)
    .filter(
      (link) =>
        !link.group.addons.some((addon) => addonIds.includes(addon.id)),
    );

  function toggleAddon(group, addon) {
    setAddonIds((prev) => {
      if (prev.includes(addon.id)) return prev.filter((id) => id !== addon.id);
      const inGroup = prev.filter((id) =>
        group.addons.some((a) => a.id === id),
      );
      if (group.maxSelect <= 1) {
        return [...prev.filter((id) => !inGroup.includes(id)), addon.id];
      }
      if (inGroup.length >= group.maxSelect) return prev;
      return [...prev, addon.id];
    });
  }

  function groupIsFull(group, addon) {
    if (addonIds.includes(addon.id)) return false;
    const inGroup = addonIds.filter((id) =>
      group.addons.some((a) => a.id === id),
    ).length;
    return inGroup >= group.maxSelect;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-slate-950/50"
      />
      <div className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-lift sm:rounded-2xl">
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-100 bg-white px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">{item.name}</h2>
            {item.description ? (
              <p className="mt-0.5 text-sm text-slate-600">{item.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost btn-sm shrink-0"
          >
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-4 py-4">
          {item.variants.length > 0 ? (
            <fieldset>
              <legend className="label">Size / variant</legend>
              <div className="flex flex-wrap gap-2">
                {item.variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVariantId(v.id)}
                    className={`pill ${variantId === v.id ? "pill-active" : ""}`}
                  >
                    {v.name}
                    {v.priceDelta !== 0
                      ? ` (${v.priceDelta > 0 ? "+" : ""}${formatPKR(v.priceDelta, currency)})`
                      : ""}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          {item.addonGroups.map((link) => (
            <fieldset key={link.group.id}>
              <legend className="label">
                {link.group.name}
                {link.group.required ? (
                  <span className="text-red-600"> *</span>
                ) : null}{" "}
                <span className="font-normal text-slate-500">
                  (up to {link.group.maxSelect})
                </span>
              </legend>
              <div className="space-y-1">
                {link.group.addons.map((addon) => {
                  const checked = addonIds.includes(addon.id);
                  const disabled = groupIsFull(link.group, addon);
                  return (
                    <label
                      key={addon.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                        checked
                          ? "border-brand-500 bg-brand-50"
                          : "border-slate-200"
                      } ${disabled ? "opacity-50" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleAddon(link.group, addon)}
                        className="h-4 w-4 accent-orange-600"
                      />
                      <span className="flex-1 text-slate-800">{addon.name}</span>
                      <span className="font-medium text-slate-700">
                        {addon.price > 0
                          ? `+${formatPKR(addon.price, currency)}`
                          : "Free"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <div>
            <label htmlFor="picker-note" className="label">
              Note for the kitchen (optional)
            </label>
            <input
              id="picker-note"
              type="text"
              value={note}
              maxLength={200}
              onChange={(event) => setNote(event.target.value)}
              className="input"
              placeholder="e.g. Less spicy"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Decrease quantity"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="btn btn-secondary btn-sm"
              >
                −
              </button>
              <span className="w-8 text-center text-base font-bold">
                {quantity}
              </span>
              <button
                type="button"
                aria-label="Increase quantity"
                disabled={quantity >= 99}
                onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                className="btn btn-secondary btn-sm"
              >
                +
              </button>
            </div>
            <p className="text-base font-bold text-slate-900">
              {formatPKR(unitPrice * quantity, currency)}
            </p>
          </div>

          {missingRequired.length > 0 ? (
            <p className="form-error">
              Please choose from:{" "}
              {missingRequired.map((link) => link.group.name).join(", ")}.
            </p>
          ) : null}

          <button
            type="button"
            disabled={missingRequired.length > 0}
            onClick={() =>
              onAdd({
                menuItemId: item.id,
                variantId,
                addonIds,
                quantity,
                note: note.trim(),
              })
            }
            className="btn btn-primary btn-block btn-lg"
          >
            Add · {formatPKR(unitPrice * quantity, currency)}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Main component -------------------------------------------------------

export default function OrderTrackingClient({
  order: initialOrder,
  menu,
  settings,
  token,
  canAdd,
}) {
  const [order, setOrder] = useState(initialOrder);
  const [pollError, setPollError] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [pickerItem, setPickerItem] = useState(null);
  const [additions, setAdditions] = useState([]);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingKeyRef = useRef(null);

  const currency = settings.currency;
  const isTerminal = TERMINAL_STATUSES.includes(order.status);
  const canAddNow = canAdd && canAddTo(order);
  const canCancel = order.status === "RECEIVED";

  async function refreshOrder() {
    const res = await fetch(
      `/api/public/orders/${order.id}?token=${encodeURIComponent(token)}`,
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Could not load the order.");
    }
    setOrder(data.order);
    return data.order;
  }

  // Poll every 5s until the order reaches a terminal state.
  useEffect(() => {
    if (isTerminal) return undefined;
    const timer = window.setInterval(() => {
      refreshOrder().catch((err) => {
        setPollError(err?.message || "Could not refresh the order status.");
      });
    }, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, isTerminal]);

  const steps = timelineSteps(order.type);
  const currentStep = steps.indexOf(order.status);

  const visibleCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return menu
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => {
          if (q) {
            const hay = `${item.name} ${item.description ?? ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        }),
      }))
      .filter((category) => category.items.length > 0)
      .filter(
        (category) =>
          activeCategory === "all" || category.id === activeCategory,
      );
  }, [menu, query, activeCategory]);

  function addToAdditions(selection) {
    const item = pickerItem;
    if (!item) return;
    const variant =
      item.variants.find((v) => v.id === selection.variantId) ?? null;
    const addons = [];
    for (const link of item.addonGroups) {
      for (const addon of link.group.addons) {
        if (selection.addonIds.includes(addon.id)) {
          addons.push({ id: addon.id, name: addon.name, price: addon.price });
        }
      }
    }
    const note = selection.note || "";
    const lineKey = [
      item.id,
      selection.variantId ?? 0,
      [...selection.addonIds].sort((a, b) => a - b).join(","),
      note,
    ].join("|");
    const line = {
      key: lineKey,
      menuItemId: item.id,
      name: item.name,
      variantId: selection.variantId,
      variantName: variant?.name ?? null,
      unitPrice: item.price + (variant?.priceDelta ?? 0),
      addons,
      quantity: selection.quantity,
      note,
    };
    setAdditions((prev) => {
      const existing = prev.find((l) => l.key === lineKey);
      if (existing) {
        return prev.map((l) =>
          l.key === lineKey
            ? { ...l, quantity: Math.min(99, l.quantity + line.quantity) }
            : l,
        );
      }
      return [...prev, line];
    });
    setPickerItem(null);
    setError("");
  }

  function changeQuantity(lineKey, delta) {
    setAdditions((prev) =>
      prev
        .map((line) =>
          line.key === lineKey
            ? { ...line, quantity: line.quantity + delta }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  async function submitAdditions() {
    if (additions.length === 0 || adding) return;
    setError("");
    setNotice("");
    if (!pendingKeyRef.current) {
      pendingKeyRef.current =
        window.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    setAdding(true);
    try {
      const res = await fetch(`/api/public/orders/${order.id}/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          idempotencyKey: pendingKeyRef.current,
          lines: additions.map((line) => ({
            menuItemId: line.menuItemId,
            variantId: line.variantId,
            addonIds: line.addons.map((a) => a.id),
            quantity: line.quantity,
            note: line.note || undefined,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not add items.");
      }
      pendingKeyRef.current = null;
      setAdditions([]);
      await refreshOrder();
      setNotice("Items added to your order.");
    } catch (err) {
      setError(err?.message || "Could not add items. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  async function cancelOrder() {
    if (cancelling) return;
    setError("");
    setCancelling(true);
    try {
      const res = await fetch(`/api/public/orders/${order.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not cancel the order.");
      }
      setConfirmCancel(false);
      await refreshOrder();
      setNotice("Your order was cancelled.");
    } catch (err) {
      setError(err?.message || "Could not cancel the order. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-4 pb-16">
      <header className="text-center">
        <p className="text-xs font-semibold tracking-widest text-brand-600 uppercase">
          {settings.restaurantName}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          Order {order.orderNumber}
        </h1>
        <p className="page-desc">
          {TYPE_LABELS[order.type] ?? order.type}
          {order.table ? ` · ${order.table.name}` : ""}
          {order.customerName ? ` · ${order.customerName}` : ""}
        </p>
      </header>

      {error ? <p className="form-error mt-4">{error}</p> : null}
      {notice ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      {pollError ? (
        <p className="form-error mt-4">{pollError}</p>
      ) : null}

      <section className="card card-pad mt-4" aria-label="Order status">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title">Status</h2>
          <Badge tone={STATUS_TONES[order.status] ?? "slate"}>
            {STATUS_LABELS[order.status] ?? order.status}
          </Badge>
        </div>

        {order.status === "CANCELLED" ? (
          <p className="mt-2 text-sm text-red-700">
            This order was cancelled
            {order.cancelledReason ? `: ${order.cancelledReason}` : "."}
          </p>
        ) : (
          <ol className="mt-3 space-y-0">
            {steps.map((step, index) => {
              const done = currentStep >= 0 && index <= currentStep;
              const current = index === currentStep;
              return (
                <li key={step} className="flex gap-3">
                  <span className="flex flex-col items-center">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        done
                          ? "bg-brand-600 text-white"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {done ? "✓" : index + 1}
                    </span>
                    {index < steps.length - 1 ? (
                      <span
                        className={`w-0.5 flex-1 ${
                          index < currentStep ? "bg-brand-600" : "bg-slate-200"
                        }`}
                        style={{ minHeight: 18 }}
                      />
                    ) : null}
                  </span>
                  <span
                    className={`pb-4 text-sm ${
                      current
                        ? "font-semibold text-slate-900"
                        : done
                          ? "text-slate-700"
                          : "text-slate-500"
                    }`}
                  >
                    {STATUS_LABELS[step]}
                    {current && !isTerminal ? " — in progress" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {!isTerminal ? (
          <p className="form-note">This page updates automatically.</p>
        ) : null}
        {order.status === "COMPLETED" ? (
          <p className="mt-2 text-sm text-emerald-800">
            Thank you — this order is complete.
          </p>
        ) : null}
      </section>

      <section className="card card-pad mt-4" aria-label="Order items">
        <h2 className="section-title">Items</h2>
        <div className="mt-3 space-y-4">
          {order.batches.map((batch) => (
            <div key={batch.id}>
              <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Batch {batch.batchNumber}
                <Badge tone={STATUS_TONES[batch.status] ?? "slate"}>
                  {STATUS_LABELS[batch.status] ?? batch.status}
                </Badge>
              </p>
              <ul className="mt-2 space-y-2 text-sm">
                {batch.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-slate-900">
                        {item.quantity} × {item.itemName}
                      </span>
                      {item.variantName ? (
                        <span className="text-slate-600">
                          {" "}
                          ({item.variantName})
                        </span>
                      ) : null}
                      {item.addons.length > 0 ? (
                        <span className="block text-xs text-slate-500">
                          + {item.addons.map((a) => a.addonName).join(", ")}
                        </span>
                      ) : null}
                      {item.note ? (
                        <span className="block text-xs text-slate-500">
                          Note: {item.note}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-medium text-slate-800">
                      {formatPKR(item.lineTotal, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <dl className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600">Subtotal</dt>
            <dd>{formatPKR(order.subtotal, currency)}</dd>
          </div>
          {order.discount > 0 ? (
            <div className="flex justify-between">
              <dt className="text-slate-600">
                Discount
                {order.discountReason ? ` (${order.discountReason})` : ""}
              </dt>
              <dd>−{formatPKR(order.discount, currency)}</dd>
            </div>
          ) : null}
          {order.tax > 0 ? (
            <div className="flex justify-between">
              <dt className="text-slate-600">Tax</dt>
              <dd>{formatPKR(order.tax, currency)}</dd>
            </div>
          ) : null}
          {order.serviceCharge > 0 ? (
            <div className="flex justify-between">
              <dt className="text-slate-600">Service charge</dt>
              <dd>{formatPKR(order.serviceCharge, currency)}</dd>
            </div>
          ) : null}
          {order.type === "DELIVERY" ? (
            <div className="flex justify-between">
              <dt className="text-slate-600">Delivery fee</dt>
              <dd>
                {order.deliveryFee > 0
                  ? formatPKR(order.deliveryFee, currency)
                  : "Free"}
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-bold text-slate-900">
            <dt>Total</dt>
            <dd>{formatPKR(order.grandTotal, currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-600">Payment</dt>
            <dd>
              {order.paymentStatus === "PAID"
                ? "Paid"
                : order.paymentStatus === "REFUNDED"
                  ? "Refunded"
                  : "Unpaid"}
            </dd>
          </div>
        </dl>

        {order.deliveryAddress ? (
          <p className="mt-3 text-sm text-slate-600">
            Deliver to: {order.deliveryAddress}
          </p>
        ) : null}
        {order.notes ? (
          <p className="mt-2 text-sm text-slate-600">Note: {order.notes}</p>
        ) : null}

        {canCancel && !confirmCancel ? (
          <button
            type="button"
            onClick={() => setConfirmCancel(true)}
            className="btn btn-danger-outline mt-4"
          >
            Cancel order
          </button>
        ) : null}
        {canCancel && confirmCancel ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-sm font-medium text-red-800">
              Cancel this order? This cannot be undone.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={cancelling}
                onClick={cancelOrder}
                className="btn btn-danger btn-sm"
              >
                {cancelling ? "Cancelling…" : "Yes, cancel it"}
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={() => setConfirmCancel(false)}
                className="btn btn-secondary btn-sm"
              >
                Keep my order
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {canAddNow ? (
        <section className="mt-6" aria-label="Add more items">
          <h2 className="section-title">Add more items</h2>
          <p className="section-desc">
            New items are added as a new batch on this order.
          </p>

          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="input mt-3"
            placeholder="Search the menu…"
            aria-label="Search the menu"
          />
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveCategory("all")}
              className={`pill ${activeCategory === "all" ? "pill-active" : ""}`}
            >
              All
            </button>
            {menu.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategory(category.id)}
                className={`pill ${activeCategory === category.id ? "pill-active" : ""}`}
              >
                {category.name}
              </button>
            ))}
          </div>

          {visibleCategories.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">
              No items match your search.
            </p>
          ) : null}

          {visibleCategories.map((category) => (
            <div key={category.id} className="mt-3">
              <h3 className="text-sm font-semibold text-slate-900">
                {category.name}
              </h3>
              <ul className="mt-2 space-y-2">
                {category.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={item.isSoldOut}
                      onClick={() => setPickerItem(item)}
                      className="card flex w-full cursor-pointer items-center gap-3 p-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-semibold text-slate-900">
                            {item.name}
                          </span>
                          {item.isSoldOut ? (
                            <Badge tone="red">Sold out</Badge>
                          ) : null}
                        </span>
                        {item.description ? (
                          <span className="block truncate text-sm text-slate-600">
                            {item.description}
                          </span>
                        ) : null}
                        <span className="mt-0.5 block text-sm font-semibold text-brand-700">
                          {formatPKR(item.price, currency)}
                        </span>
                      </span>
                      <Icon
                        name="plus"
                        className="h-5 w-5 shrink-0 text-slate-400"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {additions.length > 0 ? (
            <div className="card card-pad mt-4">
              <h3 className="section-title">Items to add</h3>
              <div className="mt-2 space-y-2">
                {additions.map((line) => {
                  const addonSum = line.addons.reduce((s, a) => s + a.price, 0);
                  return (
                    <div
                      key={line.key}
                      className="flex items-start justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">
                          {line.name}
                          {line.variantName ? ` (${line.variantName})` : ""}
                        </p>
                        {line.addons.length > 0 ? (
                          <p className="text-xs text-slate-500">
                            + {line.addons.map((a) => a.name).join(", ")}
                          </p>
                        ) : null}
                        {line.note ? (
                          <p className="text-xs text-slate-500">
                            Note: {line.note}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          onClick={() => changeQuantity(line.key, -1)}
                          className="btn btn-secondary btn-sm"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-bold">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label="Increase quantity"
                          onClick={() => changeQuantity(line.key, 1)}
                          className="btn btn-secondary btn-sm"
                        >
                          +
                        </button>
                      </div>
                      <p className="w-20 shrink-0 text-right font-semibold">
                        {formatPKR(
                          (line.unitPrice + addonSum) * line.quantity,
                          currency,
                        )}
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="form-note mt-3">
                Estimated additions subtotal:{" "}
                {formatPKR(estimateAdditions(additions, settings), currency)}.
                Tax and fees are recalculated by the restaurant.
              </p>
              <button
                type="button"
                disabled={adding}
                onClick={submitAdditions}
                className="btn btn-primary btn-block mt-3"
              >
                {adding ? "Adding…" : "Add to this order"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {pickerItem ? (
        <ItemPicker
          item={pickerItem}
          currency={currency}
          onAdd={addToAdditions}
          onClose={() => setPickerItem(null)}
        />
      ) : null}
    </main>
  );
}
