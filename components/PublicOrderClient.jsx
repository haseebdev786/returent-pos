// SAVE AS: components/PublicOrderClient.jsx
"use client";

// Public online ordering UI for /order (takeaway / delivery).
// Mobile-first. The menu and settings arrive as props; the only client
// fetch is the place-order POST. Cart totals are ESTIMATES — the server
// prices every order from the database. On success the customer is
// redirected to /order/[id]?token=... (tracking page).
//
// The item picker + cart pattern is intentionally duplicated from
// TableOrderClient (see the note at the top of that file): Phase 2 owns
// no shared client helper file.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPKR } from "@/lib/format";
import { Badge, Icon } from "@/components/ui";

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

export default function PublicOrderClient({ menu, settings }) {
  const router = useRouter();
  const [orderType, setOrderType] = useState("TAKEAWAY");
  const [activeCategory, setActiveCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [pickerItem, setPickerItem] = useState(null);
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const pendingKeyRef = useRef(null);

  const currency = settings.currency;

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
    () => estimateTotals(cart, settings, orderType),
    [cart, settings, orderType],
  );

  const minOrder = settings.minOrderAmount;
  const belowMinimum = minOrder > 0 && estimate.subtotal < minOrder;
  const detailsValid =
    customerName.trim().length > 0 &&
    customerPhone.trim().length > 0 &&
    (orderType !== "DELIVERY" || deliveryAddress.trim().length > 0);

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

  async function submitOrder() {
    if (cart.length === 0 || placing) return;
    setError("");
    if (!detailsValid) {
      setError(
        orderType === "DELIVERY"
          ? "Please enter your name, phone and delivery address."
          : "Please enter your name and phone.",
      );
      return;
    }
    if (belowMinimum) {
      setError(
        `Minimum order is ${formatPKR(minOrder, currency)}. Add ${formatPKR(minOrder - estimate.subtotal, currency)} more.`,
      );
      return;
    }
    // ONE idempotency key per submission, reused on retry so a failed
    // request can be safely retried without a duplicate order.
    if (!pendingKeyRef.current) {
      pendingKeyRef.current =
        window.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    setPlacing(true);
    try {
      const res = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: orderType,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          deliveryAddress:
            orderType === "DELIVERY" ? deliveryAddress.trim() : undefined,
          notes: notes.trim() || undefined,
          idempotencyKey: pendingKeyRef.current,
          lines: cartLinesForApi(cart),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not place the order.");
      }
      pendingKeyRef.current = null;
      router.push(
        `/order/${data.orderId}?token=${encodeURIComponent(data.accessToken)}`,
      );
    } catch (err) {
      // The idempotency key is deliberately kept so "try again" retries
      // the same submission instead of creating a duplicate.
      setError(err?.message || "Could not place the order. Please try again.");
      setPlacing(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-4 pb-28">
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {settings.restaurantName}
        </h1>
        {settings.address ? (
          <p className="page-desc">{settings.address}</p>
        ) : null}
        <p className="page-desc">
          Order for takeaway or delivery. Pay at pickup or on delivery.
        </p>
      </header>

      <div
        className="mt-4 flex gap-2"
        role="group"
        aria-label="Order type"
      >
        <button
          type="button"
          onClick={() => setOrderType("TAKEAWAY")}
          className={`btn flex-1 ${orderType === "TAKEAWAY" ? "btn-primary" : "btn-secondary"}`}
        >
          <Icon name="bag" className="h-4 w-4" />
          Takeaway
        </button>
        <button
          type="button"
          onClick={() => setOrderType("DELIVERY")}
          className={`btn flex-1 ${orderType === "DELIVERY" ? "btn-primary" : "btn-secondary"}`}
        >
          <Icon name="bike" className="h-4 w-4" />
          Delivery
        </button>
      </div>

      {orderType === "DELIVERY" ? (
        <p className="mt-2 text-center text-sm text-slate-600">
          Delivery fee: {formatPKR(settings.deliveryFee, currency)}
          {settings.freeDeliveryThreshold > 0
            ? ` · free over ${formatPKR(settings.freeDeliveryThreshold, currency)}`
            : ""}
        </p>
      ) : null}
      {minOrder > 0 ? (
        <p className="mt-1 text-center text-sm text-slate-600">
          Minimum order: {formatPKR(minOrder, currency)}
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
            ? "The menu is empty right now. Please try again later."
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
              <h2 className="text-base font-bold text-slate-900">
                Your cart · {orderType === "DELIVERY" ? "Delivery" : "Takeaway"}
              </h2>
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

              <div className="space-y-3 border-t border-slate-100 pt-3">
                <div>
                  <label htmlFor="order-name" className="label">
                    Your name *
                  </label>
                  <input
                    id="order-name"
                    type="text"
                    value={customerName}
                    maxLength={100}
                    onChange={(event) => setCustomerName(event.target.value)}
                    className="input"
                    placeholder="Full name"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label htmlFor="order-phone" className="label">
                    Phone *
                  </label>
                  <input
                    id="order-phone"
                    type="tel"
                    value={customerPhone}
                    maxLength={30}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                    className="input"
                    placeholder="Phone number"
                    autoComplete="tel"
                  />
                </div>
                {orderType === "DELIVERY" ? (
                  <div>
                    <label htmlFor="order-address" className="label">
                      Delivery address *
                    </label>
                    <textarea
                      id="order-address"
                      value={deliveryAddress}
                      maxLength={300}
                      rows={2}
                      onChange={(event) =>
                        setDeliveryAddress(event.target.value)
                      }
                      className="input"
                      placeholder="House / street / area"
                    />
                  </div>
                ) : null}
                <div>
                  <label htmlFor="order-notes" className="label">
                    Order note (optional)
                  </label>
                  <input
                    id="order-notes"
                    type="text"
                    value={notes}
                    maxLength={200}
                    onChange={(event) => setNotes(event.target.value)}
                    className="input"
                    placeholder="Anything the restaurant should know"
                  />
                </div>
              </div>

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
                {orderType === "DELIVERY" ? (
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Delivery fee</dt>
                    <dd>
                      {estimate.deliveryFee > 0
                        ? formatPKR(estimate.deliveryFee, currency)
                        : "Free"}
                    </dd>
                  </div>
                ) : null}
                <div className="flex justify-between text-base font-bold text-slate-900">
                  <dt>Estimated total</dt>
                  <dd>{formatPKR(estimate.grandTotal, currency)}</dd>
                </div>
              </dl>
              <p className="form-note">
                Estimated total — the final bill is calculated by the
                restaurant when your order is placed. Payment on{" "}
                {orderType === "DELIVERY" ? "delivery" : "pickup"}.
              </p>

              {belowMinimum ? (
                <p className="form-error">
                  Minimum order is {formatPKR(minOrder, currency)}. Add{" "}
                  {formatPKR(minOrder - estimate.subtotal, currency)} more.
                </p>
              ) : null}
              {error ? <p className="form-error">{error}</p> : null}

              <button
                type="button"
                disabled={placing || cart.length === 0}
                onClick={submitOrder}
                className="btn btn-primary btn-block btn-lg"
              >
                {placing
                  ? "Placing order…"
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
