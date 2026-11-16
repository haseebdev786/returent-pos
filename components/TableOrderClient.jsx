// SAVE AS: components/TableOrderClient.jsx
"use client";

// QR table ordering UI for /t/[code]. Mobile-first, thumb-friendly.
// The menu and settings arrive as props from the server page — the only
// client fetch is order status polling (5s) and order actions. Prices
// shown in the cart are ESTIMATES from the menu data; the server prices
// every order from the database and its totals are the truth.
//
// Running-bill ownership: when an order is placed, { orderId,
// accessToken } is stored in localStorage under `rp:table:<code>`.
// "Add more", Call waiter and Request bill only work from the device
// that holds that token. Another device scanning the same QR sees the
// open bill summary (from props) but cannot change the order.
//
// NOTE (intentional duplication): the item picker + cart pattern here
// is duplicated in PublicOrderClient and OrderTrackingClient. Phase 2
// owns no shared client helper file, so each flow keeps its own copy;
// a later refactor may extract one shared menu-cart component.

import { useEffect, useMemo, useRef, useState } from "react";
import { formatPKR } from "@/lib/format";
import { Badge, Icon } from "@/components/ui";

const OPEN_STATUSES = ["RECEIVED", "PREPARING", "READY"];

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

function isOpenOrder(order) {
  return (
    order &&
    OPEN_STATUSES.includes(order.status) &&
    order.paymentStatus === "UNPAID"
  );
}

function storageKey(tableCode) {
  return `rp:table:${tableCode}`;
}

/** Client-side estimate only — the server recomputes every total. */
function estimateTotals(lines, settings, orderType) {
  let subtotal = 0;
  for (const line of lines) {
    const addonSum = line.addons.reduce((sum, a) => sum + a.price, 0);
    subtotal += (line.unitPrice + addonSum) * line.quantity;
  }
  const tax = settings.taxEnabled
    ? Math.round((subtotal * settings.taxRate) / 100)
    : 0;
  const serviceCharge = settings.serviceChargeEnabled
    ? Math.round((subtotal * settings.serviceChargeRate) / 100)
    : 0;
  let deliveryFee = 0;
  if (orderType === "DELIVERY") {
    const threshold = settings.freeDeliveryThreshold;
    if (!(threshold > 0 && subtotal >= threshold)) {
      deliveryFee = settings.deliveryFee;
    }
  }
  return {
    subtotal,
    tax,
    serviceCharge,
    deliveryFee,
    grandTotal: subtotal + tax + serviceCharge + deliveryFee,
  };
}

function cartLinesForApi(cart) {
  return cart.map((line) => ({
    menuItemId: line.menuItemId,
    variantId: line.variantId,
    addonIds: line.addons.map((a) => a.id),
    quantity: line.quantity,
    note: line.note || undefined,
  }));
}

// --- Item picker ----------------------------------------------------------

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
      // Single-choice groups behave like radios: picking another option
      // replaces the current one.
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
            Add to cart · {formatPKR(unitPrice * quantity, currency)}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Main component -------------------------------------------------------

export default function TableOrderClient({ menu, settings, table, openOrder }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [pickerItem, setPickerItem] = useState(null);
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [creds, setCreds] = useState(null);
  const [myOrder, setMyOrder] = useState(null);
  const [credsChecked, setCredsChecked] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [flagBusy, setFlagBusy] = useState(null);
  const [flagDone, setFlagDone] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingKeyRef = useRef(null);

  const currency = settings.currency;
  const key = storageKey(table.code);

  async function fetchMyOrder(orderId, token) {
    const res = await fetch(
      `/api/public/orders/${orderId}?token=${encodeURIComponent(token)}`,
    );
    if (res.status === 403 || res.status === 404) {
      window.localStorage.removeItem(key);
      setCreds(null);
      setMyOrder(null);
      return null;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not load the order.");
    setMyOrder(data.order);
    if (!isOpenOrder(data.order)) {
      // Terminal state: the bill stays visible, but the stored token is
      // cleared so a fresh order can be placed for this table.
      window.localStorage.removeItem(key);
      setCreds(null);
    }
    return data.order;
  }

  // Restore the running order placed from this device, if any.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored?.orderId && stored?.accessToken) {
          setCreds(stored);
          fetchMyOrder(stored.orderId, stored.accessToken).catch(() => {
            // Polling below retries; a failed first load is not fatal.
          });
        }
      }
    } catch {
      // Corrupt storage is ignored; ordering still works.
    }
    setCredsChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Poll the running order every 5s while it is open.
  useEffect(() => {
    if (!creds || !myOrder || !isOpenOrder(myOrder)) return undefined;
    const timer = window.setInterval(() => {
      fetchMyOrder(creds.orderId, creds.accessToken).catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds?.orderId, creds?.accessToken, myOrder?.status, myOrder?.paymentStatus]);

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

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const estimate = useMemo(
    () => estimateTotals(cart, settings, "DINE_IN"),
    [cart, settings],
  );

  const hasOpenMine = isOpenOrder(myOrder);
  const showOpenBillBanner =
    credsChecked && !myOrder && openOrder && !hasOpenMine;

  function addToCart(selection) {
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
    setCart((prev) => {
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
    setNotice("");
    setError("");
  }

  function changeQuantity(lineKey, delta) {
    setCart((prev) =>
      prev
        .map((line) =>
          line.key === lineKey
            ? { ...line, quantity: line.quantity + delta }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  async function appendToOrder(orderId, token, idempotencyKey) {
    const res = await fetch(`/api/public/orders/${orderId}/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        idempotencyKey,
        lines: cartLinesForApi(cart),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Could not add items. Please try again.");
    }
    return data;
  }

  async function submitCart() {
    if (cart.length === 0 || placing) return;
    setError("");
    setNotice("");
    // ONE idempotency key per submission, reused on retry so a failed
    // request can be safely retried without a duplicate order.
    if (!pendingKeyRef.current) {
      pendingKeyRef.current =
        window.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    const idempotencyKey = pendingKeyRef.current;
    setPlacing(true);
    try {
      if (hasOpenMine && creds) {
        await appendToOrder(myOrder.id, creds.accessToken, idempotencyKey);
        pendingKeyRef.current = null;
        setCart([]);
        setCartOpen(false);
        await fetchMyOrder(creds.orderId, creds.accessToken);
        setNotice("Items added to your order.");
        return;
      }

      const res = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "DINE_IN",
          tableCode: table.code,
          customerName: customerName.trim() || undefined,
          customerPhone: customerPhone.trim() || undefined,
          idempotencyKey,
          lines: cartLinesForApi(cart),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not place the order.");
      }
      if (data.needsAppend) {
        if (creds && creds.orderId === data.orderId) {
          await appendToOrder(data.orderId, creds.accessToken, idempotencyKey);
          pendingKeyRef.current = null;
          setCart([]);
          setCartOpen(false);
          await fetchMyOrder(creds.orderId, creds.accessToken);
          setNotice("Items added to your order.");
          return;
        }
        throw new Error(
          "An order is already open for this table. New items can be added from the device that started it — please ask the staff if you need help.",
        );
      }

      const nextCreds = {
        orderId: data.orderId,
        accessToken: data.accessToken,
      };
      window.localStorage.setItem(key, JSON.stringify(nextCreds));
      setCreds(nextCreds);
      pendingKeyRef.current = null;
      setCart([]);
      setCartOpen(false);
      setCustomerName("");
      setCustomerPhone("");
      await fetchMyOrder(nextCreds.orderId, nextCreds.accessToken);
      setNotice(`Order ${data.orderNumber} placed.`);
    } catch (err) {
      // The idempotency key is deliberately kept so "try again" retries
      // the same submission instead of creating a duplicate.
      setError(err?.message || "Could not place the order. Please try again.");
    } finally {
      setPlacing(false);
    }
  }

  async function sendFlag(action) {
    if (!creds || !myOrder || flagBusy) return;
    setError("");
    setFlagBusy(action);
    try {
      const res = await fetch(`/api/public/orders/${myOrder.id}/flags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: creds.accessToken, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not send. Please try again.");
      }
      setFlagDone((prev) => ({ ...prev, [action]: data.at }));
    } catch (err) {
      setError(err?.message || "Could not send. Please try again.");
    } finally {
      setFlagBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-4 pb-28">
      <header className="text-center">
        <p className="text-xs font-semibold tracking-widest text-brand-600 uppercase">
          {settings.restaurantName}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          {table.name}
        </h1>
        <p className="page-desc">
          Order from your table — items are added to one running bill.
        </p>
      </header>

      {error ? <p className="form-error mt-4">{error}</p> : null}
      {notice ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {showOpenBillBanner ? (
        <div className="card card-pad mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="section-title">Open bill for this table</h2>
              <p className="section-desc">
                Order {openOrder.orderNumber} · {openOrder.itemCount} item(s)
              </p>
            </div>
            <div className="text-right">
              <Badge tone={STATUS_TONES[openOrder.status] ?? "slate"}>
                {STATUS_LABELS[openOrder.status] ?? openOrder.status}
              </Badge>
              <p className="mt-1 text-base font-bold text-slate-900">
                {formatPKR(openOrder.grandTotal, currency)}
              </p>
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            This bill was started from another device. New items can be
            added from that device, or ask the staff for help.
          </p>
        </div>
      ) : null}

      {myOrder ? (
        <section className="card card-pad mt-4" aria-label="Your order">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="section-title">Your order {myOrder.orderNumber}</h2>
              <p className="section-desc">
                Status updates automatically. Payment at the counter.
              </p>
            </div>
            <Badge tone={STATUS_TONES[myOrder.status] ?? "slate"}>
              {STATUS_LABELS[myOrder.status] ?? myOrder.status}
            </Badge>
          </div>

          <div className="mt-3 space-y-3">
            {myOrder.batches.map((batch) => (
              <div key={batch.id}>
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Batch {batch.batchNumber} ·{" "}
                  {STATUS_LABELS[batch.status] ?? batch.status}
                </p>
                <ul className="mt-1 space-y-1 text-sm">
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
                            +{" "}
                            {item.addons.map((a) => a.addonName).join(", ")}
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

          <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Subtotal</dt>
              <dd>{formatPKR(myOrder.subtotal, currency)}</dd>
            </div>
            {myOrder.discount > 0 ? (
              <div className="flex justify-between">
                <dt className="text-slate-600">Discount</dt>
                <dd>−{formatPKR(myOrder.discount, currency)}</dd>
              </div>
            ) : null}
            {myOrder.tax > 0 ? (
              <div className="flex justify-between">
                <dt className="text-slate-600">Tax</dt>
                <dd>{formatPKR(myOrder.tax, currency)}</dd>
              </div>
            ) : null}
            {myOrder.serviceCharge > 0 ? (
              <div className="flex justify-between">
                <dt className="text-slate-600">Service charge</dt>
                <dd>{formatPKR(myOrder.serviceCharge, currency)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between text-base font-bold text-slate-900">
              <dt>Total</dt>
              <dd>{formatPKR(myOrder.grandTotal, currency)}</dd>
            </div>
          </dl>

          {hasOpenMine ? (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={flagBusy !== null}
                onClick={() => sendFlag("waiter")}
                className="btn btn-secondary"
              >
                <Icon name="bell" className="h-4 w-4" />
                {flagDone.waiter ? "Waiter called ✓" : "Call waiter"}
              </button>
              <button
                type="button"
                disabled={flagBusy !== null}
                onClick={() => sendFlag("bill")}
                className="btn btn-secondary"
              >
                <Icon name="receipt" className="h-4 w-4" />
                {flagDone.bill ? "Bill requested ✓" : "Request bill"}
              </button>
            </div>
          ) : null}
          {myOrder.status === "COMPLETED" ? (
            <p className="mt-3 text-sm text-emerald-800">
              Thank you — this order is complete.
            </p>
          ) : null}
          {myOrder.status === "CANCELLED" ? (
            <p className="mt-3 text-sm text-red-700">
              This order was cancelled
              {myOrder.cancelledReason ? `: ${myOrder.cancelledReason}` : "."}
            </p>
          ) : null}
        </section>
      ) : null}

      {hasOpenMine ? (
        <p className="mt-4 rounded-lg bg-brand-50 px-3 py-2 text-center text-sm font-medium text-brand-800">
          Adding items below appends them to order {myOrder.orderNumber}.
        </p>
      ) : null}

      <div className="sticky top-0 z-10 -mx-4 bg-slate-100/95 px-4 pt-3 pb-2 backdrop-blur">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="input"
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
      </div>

      {visibleCategories.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-600">
          {menu.length === 0
            ? "The menu is empty right now. Please ask the staff."
            : "No items match your search."}
        </p>
      ) : null}

      {visibleCategories.map((category) => (
        <section key={category.id} className="mt-4">
          <h2 className="section-title">{category.name}</h2>
          <ul className="mt-2 space-y-2">
            {category.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={item.isSoldOut}
                  onClick={() => setPickerItem(item)}
                  className="card flex w-full cursor-pointer items-center gap-3 p-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.imageUrl}
                      alt=""
                      loading="lazy"
                      className="h-14 w-14 shrink-0 rounded-lg object-cover"
                    />
                  ) : null}
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
                      {item.variants.length > 0 ? " · options" : ""}
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
        </section>
      ))}

      {cart.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 px-4 pb-4">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="btn btn-primary btn-lg mx-auto flex w-full max-w-3xl justify-between shadow-lift"
          >
            <span>
              View cart · {cartCount} item{cartCount === 1 ? "" : "s"}
            </span>
            <span>{formatPKR(estimate.grandTotal, currency)}</span>
          </button>
        </div>
      ) : null}

      {cartOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button
            type="button"
            aria-label="Close cart"
            onClick={() => setCartOpen(false)}
            className="absolute inset-0 cursor-default bg-slate-950/50"
          />
          <div className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-lift sm:rounded-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
              <h2 className="text-base font-bold text-slate-900">Your cart</h2>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                aria-label="Close cart"
                className="btn btn-ghost btn-sm"
              >
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              {cart.map((line) => {
                const addonSum = line.addons.reduce((s, a) => s + a.price, 0);
                return (
                  <div
                    key={line.key}
                    className="flex items-start justify-between gap-3"
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
                      <p className="text-sm text-slate-600">
                        {formatPKR(line.unitPrice + addonSum, currency)} each
                      </p>
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
                    <p className="w-20 shrink-0 text-right text-sm font-semibold">
                      {formatPKR(
                        (line.unitPrice + addonSum) * line.quantity,
                        currency,
                      )}
                    </p>
                  </div>
                );
              })}

              {!hasOpenMine ? (
                <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="table-name" className="label">
                      Your name (optional)
                    </label>
                    <input
                      id="table-name"
                      type="text"
                      value={customerName}
                      maxLength={100}
                      onChange={(event) => setCustomerName(event.target.value)}
                      className="input"
                      placeholder="Name"
                    />
                  </div>
                  <div>
                    <label htmlFor="table-phone" className="label">
                      Phone (optional)
                    </label>
                    <input
                      id="table-phone"
                      type="tel"
                      value={customerPhone}
                      maxLength={30}
                      onChange={(event) => setCustomerPhone(event.target.value)}
                      className="input"
                      placeholder="Phone"
                    />
                  </div>
                </div>
              ) : null}

              <dl className="space-y-1 border-t border-slate-100 pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-600">Subtotal</dt>
                  <dd>{formatPKR(estimate.subtotal, currency)}</dd>
                </div>
                {estimate.tax > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Tax (estimated)</dt>
                    <dd>{formatPKR(estimate.tax, currency)}</dd>
                  </div>
                ) : null}
                {estimate.serviceCharge > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-slate-600">
                      Service charge (estimated)
                    </dt>
                    <dd>{formatPKR(estimate.serviceCharge, currency)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between text-base font-bold text-slate-900">
                  <dt>Estimated total</dt>
                  <dd>{formatPKR(estimate.grandTotal, currency)}</dd>
                </div>
              </dl>
              <p className="form-note">
                Estimated total — the final bill is calculated by the
                restaurant when your order is placed.
              </p>

              {error ? <p className="form-error">{error}</p> : null}

              <button
                type="button"
                disabled={placing || cart.length === 0}
                onClick={submitCart}
                className="btn btn-primary btn-block btn-lg"
              >
                {placing
                  ? "Sending…"
                  : hasOpenMine
                    ? `Add to order · ${formatPKR(estimate.grandTotal, currency)}`
                    : `Place order · ${formatPKR(estimate.grandTotal, currency)}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pickerItem ? (
        <ItemPicker
          item={pickerItem}
          currency={currency}
          onAdd={addToCart}
          onClose={() => setPickerItem(null)}
        />
      ) : null}
    </main>
  );
}
