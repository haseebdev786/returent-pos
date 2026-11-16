// SAVE AS: components/ManualOrderForm.jsx
"use client";

// Staff manual order form (counter orders) + the shared menu-line
// picker used by both this form and the order-detail add-items form.
//
// MenuLinePicker (named export): category pills, item list, and a
// configuration panel (variant, addons with required/maxSelect rules,
// quantity, note). Clicking an item adds it STRAIGHT to the cart with
// its default variant and no extras (quick-add); the panel opens only
// via the Options button, or automatically when the item has a
// REQUIRED addon group that needs a human choice. Cards show a −/+
// stepper for the plain cart line so quantities change by mouse.
// It calls onAdd(line) / onQuickAdd(line) with the API line shape
// { menuItemId, variantId, addonIds, quantity, note }. Prices shown
// here are ESTIMATES from the published menu — the server re-prices
// every line from the database, so the client never decides a price.
//
// ManualOrderForm (default export): order-type pills, table select for
// dine-in, customer fields, cart, discount + reason, submit to
// POST /api/orders, redirect to the created order on success. Server
// errors are shown as returned — no fake success.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Icon } from "@/components/ui";
import { formatPKR } from "@/lib/format";

function findItem(menu, itemId) {
  for (const category of menu || []) {
    for (const item of category.items || []) {
      if (item.id === itemId) return item;
    }
  }
  return null;
}

function estimateUnitPrice(item, variantId, addonIds) {
  if (!item) return 0;
  let unit = item.price;
  const variant = (item.variants || []).find((v) => v.id === variantId);
  if (variant) unit += variant.priceDelta;
  const addonById = new Map();
  for (const link of item.addonGroups || []) {
    for (const addon of link.group.addons || []) addonById.set(addon.id, addon);
  }
  for (const id of addonIds || []) {
    const addon = addonById.get(id);
    if (addon) unit += addon.price;
  }
  return unit;
}

// Default variant for quick-add and for a freshly opened panel: the
// first variant when the item has variants (e.g. Half for Karahi).
function defaultVariantId(item) {
  return item.variants?.[0]?.id ?? null;
}

function hasRequiredAddonGroup(item) {
  return (item.addonGroups || []).some((link) => link.group?.required);
}

// Merge a quick-add line into the matching plain line (same item,
// same variant, same addon set, no note) by raising its quantity;
// otherwise append it as a new line. Customised lines (extras or a
// note) never merge with plain ones. Shared with OrderActions.
export function addOrMergeLine(lines, line) {
  const index = (lines || []).findIndex(
    (current) =>
      current.menuItemId === line.menuItemId &&
      (current.variantId ?? null) === (line.variantId ?? null) &&
      (current.addonIds || []).length === (line.addonIds || []).length &&
      (current.addonIds || []).every((id) => (line.addonIds || []).includes(id)) &&
      !current.note &&
      !line.note,
  );
  if (index === -1) {
    return [...(lines || []), { ...line, key: `${Date.now()}-${(lines || []).length}` }];
  }
  return (lines || []).map((current, i) =>
    i === index
      ? { ...current, quantity: Math.min(99, current.quantity + line.quantity) }
      : current,
  );
}

const NOTE_PRESETS = ["Less spicy", "Extra spicy", "No onion", "Well done"];

export function MenuLinePicker({
  menu,
  currency,
  onAdd,
  disabled = false,
  // Optional quick-add wiring: `lines` is the parent cart/pending
  // list (drives the card steppers), `onQuickAdd` merges a default
  // line, `onLineQty`/`onRemoveLine` serve the card steppers. When
  // they are absent the picker still quick-adds through onAdd, just
  // without card steppers.
  lines = [],
  onQuickAdd,
  onLineQty,
  onRemoveLine,
}) {
  const categories = menu || [];
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? null);
  const [selectedId, setSelectedId] = useState(null);
  const [variantId, setVariantId] = useState(null);
  const [addonIds, setAddonIds] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const activeCategory =
    categories.find((category) => category.id === categoryId) || categories[0] || null;
  const selectedItem = useMemo(
    () => (selectedId === null ? null : findItem(menu, selectedId)),
    [menu, selectedId],
  );

  function selectItem(item) {
    if (item.isSoldOut) return;
    setSelectedId(item.id);
    setVariantId(defaultVariantId(item));
    setAddonIds([]);
    setQuantity(1);
    setNote("");
    setError("");
  }

  // One-click add: the item goes straight into the cart with its
  // default variant and no extras. Items with a REQUIRED addon group
  // open the panel instead — that choice has to be made by a person.
  function quickAdd(item) {
    if (item.isSoldOut || disabled) return;
    if (hasRequiredAddonGroup(item)) {
      selectItem(item);
      return;
    }
    (onQuickAdd || onAdd)({
      menuItemId: item.id,
      variantId: defaultVariantId(item),
      addonIds: [],
      quantity: 1,
      note: null,
    });
  }

  // The cart line a card stepper controls: the plain (default-config)
  // line for this item. Customised lines are edited in the cart, not
  // on the card, so a stepper never changes the wrong line.
  function plainLineFor(item) {
    return (lines || []).find(
      (line) =>
        line.menuItemId === item.id &&
        (line.variantId ?? null) === defaultVariantId(item) &&
        (line.addonIds || []).length === 0 &&
        !line.note,
    );
  }

  function hasOptions(item) {
    return (item.variants?.length || 0) > 0 || (item.addonGroups?.length || 0) > 0;
  }

  function toggleAddon(group, addonId, checked) {
    setAddonIds((current) => {
      const groupIds = new Set((group.addons || []).map((addon) => addon.id));
      const selectedInGroup = current.filter((id) => groupIds.has(id));
      if (checked) {
        if (selectedInGroup.length >= group.maxSelect) return current;
        return [...current, addonId];
      }
      return current.filter((id) => id !== addonId);
    });
  }

  function handleAdd() {
    if (!selectedItem) return;
    setError("");
    // Required-group check mirrors the server (priceOrderLines
    // re-validates); failing early here saves a round trip.
    for (const link of selectedItem.addonGroups || []) {
      const group = link.group;
      const picked = addonIds.filter((id) =>
        (group.addons || []).some((addon) => addon.id === id),
      ).length;
      if (group.required && picked === 0) {
        setError(`Please choose at least one option from "${group.name}".`);
        return;
      }
    }
    onAdd({
      menuItemId: selectedItem.id,
      variantId: variantId ?? null,
      addonIds: [...addonIds],
      quantity,
      note: note.trim() || null,
    });
    setSelectedId(null);
    setAddonIds([]);
    setQuantity(1);
    setNote("");
  }

  const unitEstimate = selectedItem
    ? estimateUnitPrice(selectedItem, variantId, addonIds)
    : 0;

  return (
    <div className="space-y-3">
      {categories.length === 0 ? (
        <p className="form-note">No menu items are published yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setCategoryId(category.id)}
                className={`pill ${category.id === activeCategory?.id ? "pill-active" : ""}`}
              >
                {category.name}
              </button>
            ))}
          </div>

          <p className="form-note">
            Click an item to add it straight to the cart — click again to add one more.
            Use Options only when you need a size, extras, or a kitchen note.
          </p>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(activeCategory?.items || []).map((item) => {
              const plainLine = plainLineFor(item);
              const canStep = Boolean(plainLine && onLineQty && onRemoveLine);
              const isOpen = item.id === selectedId;
              return (
                <div
                  key={item.id}
                  className={`flex items-stretch justify-between gap-1 rounded-lg border transition-colors ${
                    isOpen
                      ? "border-brand-600 bg-brand-50"
                      : plainLine
                        ? "border-brand-200 bg-brand-50/50"
                        : "border-slate-200 bg-white"
                  } ${item.isSoldOut ? "opacity-50" : ""}`}
                >
                  <button
                    type="button"
                    disabled={disabled || item.isSoldOut}
                    onClick={() => quickAdd(item)}
                    title="Click to add to cart"
                    className="flex min-w-0 flex-1 items-start justify-between gap-2 px-3 py-2 text-left disabled:cursor-not-allowed"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {item.name}
                      </span>
                      {item.description ? (
                        <span className="block truncate text-xs text-slate-500">
                          {item.description}
                        </span>
                      ) : null}
                      {item.isSoldOut ? <Badge tone="red">Sold out</Badge> : null}
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-slate-900">
                      {formatPKR(item.price, currency)}
                    </span>
                  </button>
                  {canStep ? (
                    <span className="flex items-center gap-1 pr-1">
                      <button
                        type="button"
                        aria-label="One less"
                        onClick={() =>
                          plainLine.quantity <= 1
                            ? onRemoveLine(plainLine.key)
                            : onLineQty(plainLine.key, -1)
                        }
                        className="btn btn-secondary btn-sm"
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">
                        {plainLine.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="One more"
                        onClick={() => onLineQty(plainLine.key, 1)}
                        className="btn btn-secondary btn-sm"
                      >
                        +
                      </button>
                    </span>
                  ) : null}
                  {hasOptions(item) ? (
                    <button
                      type="button"
                      disabled={disabled || item.isSoldOut}
                      onClick={() => selectItem(item)}
                      title="Size, extras, kitchen note"
                      className="shrink-0 self-center rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed"
                    >
                      Options
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {(activeCategory?.items || []).length === 0 ? (
            <p className="form-note">No items in this category.</p>
          ) : null}
        </>
      )}

      {selectedItem ? (
        <div className="card card-pad space-y-4 border-brand-200 bg-brand-50/50">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="section-title">{selectedItem.name}</h3>
              <p className="section-desc">
                {formatPKR(selectedItem.price, currency)}
                {selectedItem.variants?.length > 0 ? " + variant" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close item options"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>

          {selectedItem.variants?.length > 0 ? (
            <fieldset>
              <legend className="label">Size / variant</legend>
              <div className="flex flex-wrap gap-2">
                {selectedItem.variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => setVariantId(variant.id)}
                    className={`pill ${variant.id === variantId ? "pill-active" : ""}`}
                  >
                    {variant.name}
                    {variant.priceDelta !== 0
                      ? ` (${variant.priceDelta > 0 ? "+" : ""}${formatPKR(variant.priceDelta, currency)})`
                      : ""}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          {(selectedItem.addonGroups || []).map((link) => {
            const group = link.group;
            const pickedCount = addonIds.filter((id) =>
              (group.addons || []).some((addon) => addon.id === id),
            ).length;
            return (
              <fieldset key={link.id}>
                <legend className="label">
                  {group.name}
                  {group.required ? " (required)" : ""}
                  {group.maxSelect > 1 ? ` — up to ${group.maxSelect}` : ""}
                </legend>
                <div className="space-y-1.5">
                  {(group.addons || []).map((addon) => {
                    const checked = addonIds.includes(addon.id);
                    const atMax = !checked && pickedCount >= group.maxSelect;
                    return (
                      <label
                        key={addon.id}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                          atMax ? "opacity-50" : "cursor-pointer"
                        } border-slate-200 bg-white`}
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={atMax}
                            onChange={(event) =>
                              toggleAddon(group, addon.id, event.target.checked)
                            }
                          />
                          {addon.name}
                        </span>
                        <span className="text-slate-600">
                          {addon.price > 0 ? `+${formatPKR(addon.price, currency)}` : "Free"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="picker-qty" className="label">
                Quantity
              </label>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="btn btn-secondary btn-sm"
                >
                  −
                </button>
                <input
                  id="picker-qty"
                  type="number"
                  min="1"
                  max="99"
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(Math.max(1, Math.min(99, Number(event.target.value) || 1)))
                  }
                  className="input w-16 text-center"
                />
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                  className="btn btn-secondary btn-sm"
                >
                  +
                </button>
              </span>
            </div>
            <div className="min-w-48 flex-1">
              <label htmlFor="picker-note" className="label">
                Note for kitchen (optional)
              </label>
              <input
                id="picker-note"
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. Less spicy"
                className="input"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {NOTE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setNote((current) => (current === preset ? "" : preset))}
                className={`pill ${note === preset ? "pill-active" : ""}`}
              >
                {preset}
              </button>
            ))}
          </div>

          {error ? <p className="form-error">{error}</p> : null}

          <button
            type="button"
            onClick={handleAdd}
            disabled={disabled}
            className="btn btn-primary"
          >
            Add — {formatPKR(unitEstimate * quantity, currency)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const TYPE_OPTIONS = [
  { value: "DINE_IN", label: "Dine-in" },
  { value: "TAKEAWAY", label: "Takeaway" },
  { value: "DELIVERY", label: "Delivery" },
];

// One-click discount presets — no typing needed for the common cases.
// The number input and reason field stay for anything custom.
const DISCOUNT_AMOUNTS = [0, 50, 100, 200, 500];
const DISCOUNT_REASONS = ["Regular customer", "Promo offer", "Staff meal", "Goodwill"];

export default function ManualOrderForm({ menu, tables, settings, initialTableCode }) {
  const router = useRouter();
  const currency = settings?.currency || "Rs";
  const [type, setType] = useState("DINE_IN");
  const [tableCode, setTableCode] = useState(initialTableCode || "");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const estimatedSubtotal = useMemo(
    () =>
      cart.reduce(
        (sum, line) =>
          sum +
          estimateUnitPrice(findItem(menu, line.menuItemId), line.variantId, line.addonIds) *
            line.quantity,
        0,
      ),
    [cart, menu],
  );

  function addToCart(line) {
    setCart((current) => [...current, { ...line, key: `${Date.now()}-${current.length}` }]);
  }

  // Quick-add merges into the matching plain line so repeated clicks
  // raise the quantity instead of stacking duplicate lines.
  function quickAddToCart(line) {
    setCart((current) => addOrMergeLine(current, line));
  }

  function updateQty(key, delta) {
    setCart((current) =>
      current.map((line) =>
        line.key === key
          ? { ...line, quantity: Math.max(1, Math.min(99, line.quantity + delta)) }
          : line,
      ),
    );
  }

  function removeLine(key) {
    setCart((current) => current.filter((line) => line.key !== key));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (cart.length === 0) {
      setError("Add at least one item before placing the order.");
      return;
    }
    if (type === "DINE_IN" && !tableCode) {
      setError("Choose a table for a dine-in order.");
      return;
    }
    if (type === "DELIVERY" && !customerPhone.trim()) {
      setError("A customer phone number is required for delivery.");
      return;
    }
    if (type === "DELIVERY" && !deliveryAddress.trim()) {
      setError("A delivery address is required for delivery.");
      return;
    }
    if (type === "TAKEAWAY" && !customerName.trim() && !customerPhone.trim()) {
      setError("A customer name or phone number is required for takeaway.");
      return;
    }
    const discountValue = discount === "" ? 0 : Number.parseInt(discount, 10);
    if (!Number.isInteger(discountValue) || discountValue < 0) {
      setError("Discount must be a whole number of rupees, 0 or more.");
      return;
    }
    if (discountValue > estimatedSubtotal) {
      setError("Discount cannot be more than the order subtotal.");
      return;
    }
    if (discountValue > 0 && !discountReason.trim()) {
      setError("A discount reason is required when a discount is given.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          tableCode: type === "DINE_IN" ? tableCode : undefined,
          customerName: customerName.trim() || undefined,
          customerPhone: customerPhone.trim() || undefined,
          deliveryAddress: type === "DELIVERY" ? deliveryAddress.trim() : undefined,
          notes: notes.trim() || undefined,
          lines: cart.map((line) => ({
            menuItemId: line.menuItemId,
            variantId: line.variantId ?? undefined,
            addonIds: line.addonIds,
            quantity: line.quantity,
            note: line.note || undefined,
          })),
          discount: discountValue,
          discountReason: discountValue > 0 ? discountReason.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Order could not be created.");
        return;
      }
      router.push(`/orders/${data.order.id}`);
    } catch {
      setError("Order could not be created. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const minOrder = settings?.minOrderAmount || 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error ? <p className="form-error">{error}</p> : null}

      {/* POS layout: menu on the left, order details + cart on the
          right, so taking an order on the restaurant PC never needs
          scrolling past the menu to reach the cart. Stacks on small
          screens with the menu first for the fast tap flow. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="card card-pad space-y-3">
          <h2 className="section-title">Menu</h2>
          <MenuLinePicker
            menu={menu}
            currency={currency}
            onAdd={addToCart}
            lines={cart}
            onQuickAdd={quickAddToCart}
            onLineQty={updateQty}
            onRemoveLine={removeLine}
          />
        </section>

        <div className="space-y-6">
      <section className="card card-pad space-y-4">
        <h2 className="section-title">Order details</h2>
        <fieldset>
          <legend className="label">Order type</legend>
          <div className="flex flex-wrap gap-2">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(option.value)}
                className={`pill ${type === option.value ? "pill-active" : ""}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        {type === "DINE_IN" ? (
          <div>
            <label htmlFor="manual-table" className="label">
              Table
            </label>
            <select
              id="manual-table"
              value={tableCode}
              onChange={(event) => setTableCode(event.target.value)}
              className="input"
              required
            >
              <option value="">Choose a table…</option>
              {(tables || []).map((table) => (
                <option
                  key={table.id}
                  value={table.code}
                  disabled={table.status === "OCCUPIED" && table.code !== initialTableCode}
                >
                  {table.name} ({table.code}) — {table.seats} seats
                  {table.status === "OCCUPIED" ? " — occupied" : ""}
                </option>
              ))}
            </select>
            <p className="form-note mt-1">
              Occupied tables already have an open order — add items to that order instead.
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label htmlFor="manual-name" className="label">
              Customer name{type === "TAKEAWAY" ? " *" : ""}
            </label>
            <input
              id="manual-name"
              type="text"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Customer name"
              className="input"
            />
          </div>
          <div>
            <label htmlFor="manual-phone" className="label">
              Customer phone{type === "DELIVERY" ? " *" : ""}
            </label>
            <input
              id="manual-phone"
              type="tel"
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value)}
              placeholder="03xx-xxxxxxx"
              className="input"
            />
          </div>
        </div>

        {type === "DELIVERY" ? (
          <div>
            <label htmlFor="manual-address" className="label">
              Delivery address *
            </label>
            <textarea
              id="manual-address"
              value={deliveryAddress}
              onChange={(event) => setDeliveryAddress(event.target.value)}
              placeholder="House, street, area"
              rows={2}
              className="input"
            />
          </div>
        ) : null}

        <div>
          <label htmlFor="manual-notes" className="label">
            Order notes (optional)
          </label>
          <input
            id="manual-notes"
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Anything the kitchen or rider should know"
            className="input"
          />
        </div>
      </section>

      <section className="card card-pad space-y-3">
        <h2 className="section-title">Cart ({cart.length})</h2>
        {cart.length === 0 ? (
          <p className="form-note">No items yet — click any menu item and it goes straight in here.</p>
        ) : (
          <ul className="space-y-2">
            {cart.map((line) => {
              const item = findItem(menu, line.menuItemId);
              const variant = (item?.variants || []).find((v) => v.id === line.variantId);
              const addonNames = [];
              for (const link of item?.addonGroups || []) {
                for (const addon of link.group.addons || []) {
                  if (line.addonIds.includes(addon.id)) addonNames.push(addon.name);
                }
              }
              const unit = estimateUnitPrice(item, line.variantId, line.addonIds);
              return (
                <li
                  key={line.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {item?.name || "Item"}
                      {variant ? ` (${variant.name})` : ""} — {formatPKR(unit, currency)} each
                    </p>
                    {addonNames.length > 0 ? (
                      <p className="text-xs text-slate-500">+ {addonNames.join(", ")}</p>
                    ) : null}
                    {line.note ? <p className="text-xs text-slate-500">Note: {line.note}</p> : null}
                  </div>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => updateQty(line.key, -1)}
                      className="btn btn-secondary btn-sm"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-semibold">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => updateQty(line.key, 1)}
                      className="btn btn-secondary btn-sm"
                    >
                      +
                    </button>
                    <span className="w-20 text-right text-sm font-semibold">
                      {formatPKR(unit * line.quantity, currency)}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove line"
                      onClick={() => removeLine(line.key)}
                      className="rounded-md p-1.5 text-red-600 hover:bg-red-50"
                    >
                      <Icon name="x" className="h-4 w-4" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-between gap-2 border-t border-slate-100 pt-2 text-sm">
          <span className="text-slate-600">Estimated subtotal (final bill is calculated by the server)</span>
          <span className="font-semibold">{formatPKR(estimatedSubtotal, currency)}</span>
        </div>
        {minOrder > 0 ? (
          <p className="form-note">
            Minimum order is {formatPKR(minOrder, currency)}.
            {estimatedSubtotal < minOrder
              ? ` Add ${formatPKR(minOrder - estimatedSubtotal, currency)} more to reach it.`
              : " Minimum reached."}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3">
          <div>
            <label htmlFor="manual-discount" className="label">
              Discount ({currency})
            </label>
            <input
              id="manual-discount"
              type="number"
              min="0"
              step="1"
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
              placeholder="0"
              className="input"
            />
            <span className="mt-2 flex flex-wrap gap-2">
              {DISCOUNT_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setDiscount(String(amount))}
                  className={`pill ${discount !== "" && Number(discount) === amount ? "pill-active" : ""}`}
                >
                  {amount === 0 ? "No discount" : formatPKR(amount, currency)}
                </button>
              ))}
            </span>
          </div>
          <div>
            <label htmlFor="manual-discount-reason" className="label">
              Discount reason{discount && Number(discount) > 0 ? " *" : ""}
            </label>
            <input
              id="manual-discount-reason"
              type="text"
              value={discountReason}
              onChange={(event) => setDiscountReason(event.target.value)}
              placeholder="e.g. Regular customer"
              className="input"
            />
            <span className="mt-2 flex flex-wrap gap-2">
              {DISCOUNT_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setDiscountReason(reason)}
                  className={`pill ${discountReason === reason ? "pill-active" : ""}`}
                >
                  {reason}
                </button>
              ))}
            </span>
          </div>
        </div>
      </section>

      <div className="space-y-2">
        <button type="submit" disabled={busy || cart.length === 0} className="btn btn-primary btn-lg btn-block">
          {busy ? "Placing order…" : "Place order"}
        </button>
        {cart.length === 0 ? (
          <p className="form-note text-center">
            Place order stays off until the cart has an item — click any menu item to add one.
          </p>
        ) : null}
      </div>
        </div>
      </div>
    </form>
  );
}
