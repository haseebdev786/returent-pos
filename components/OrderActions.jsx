// SAVE AS: components/OrderActions.jsx
"use client";

// Client actions for the order detail page. Every action calls its
// dedicated API route and refreshes the server-rendered detail on
// success; errors are shown as returned by the API — never a fake
// success. Buttons are also hidden/disabled by the same state rules
// the APIs enforce (closed orders cannot grow, paid bills cannot
// change, completion needs full payment), but the server is always
// the final guard.
//
// Props: { order, menu, riders, currency, paidTotal, remaining }.
// `order` is a plain serialized object (dates as ISO strings).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Icon } from "@/components/ui";
import { formatPKR } from "@/lib/format";
import { MenuLinePicker, addOrMergeLine } from "@/components/ManualOrderForm";

const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "JAZZCASH", label: "JazzCash" },
  { value: "EASYPAISA", label: "EasyPaisa" },
  { value: "COD", label: "COD" },
];

const GROWABLE = ["RECEIVED", "PREPARING", "READY"];
const COMPLETABLE = ["RECEIVED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];
const CLOSED = ["COMPLETED", "CANCELLED"];

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Request failed.");
  return data;
}

function ActionError({ message }) {
  if (!message) return null;
  return <p className="form-error">{message}</p>;
}

export default function OrderActions({ order, menu, riders, currency, paidTotal, remaining }) {
  const router = useRouter();
  const isClosed = CLOSED.includes(order.status);
  const canGrow = GROWABLE.includes(order.status) && order.paymentStatus !== "PAID";
  const canDiscount = !isClosed && order.paymentStatus === "UNPAID";
  const canPay = !isClosed && remaining > 0;
  const canComplete =
    !isClosed && COMPLETABLE.includes(order.status) && order.paymentStatus === "PAID";

  // --- Add items ------------------------------------------------------
  const [pendingLines, setPendingLines] = useState([]);
  const [addError, setAddError] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  // Same quick-add behaviour as the new-order form: one click adds
  // the item, repeated clicks raise the quantity of the same line.
  function quickAddPending(line) {
    setPendingLines((current) => addOrMergeLine(current, line));
  }

  function updatePendingQty(key, delta) {
    setPendingLines((current) =>
      current.map((line) =>
        line.key === key
          ? { ...line, quantity: Math.max(1, Math.min(99, line.quantity + delta)) }
          : line,
      ),
    );
  }

  function removePendingLine(key) {
    setPendingLines((current) => current.filter((line) => line.key !== key));
  }

  async function submitAddItems() {
    setAddError("");
    if (pendingLines.length === 0) return;
    setAddBusy(true);
    try {
      await postJson(
        `/api/orders/${order.id}/add-items`,
        { lines: pendingLines.map(({ key, ...line }) => line) },
      );
      setPendingLines([]);
      router.refresh();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAddBusy(false);
    }
  }

  // --- Discount ---------------------------------------------------------
  const [discount, setDiscount] = useState(String(order.discount || 0));
  const [discountReason, setDiscountReason] = useState(order.discountReason || "");
  const [discountError, setDiscountError] = useState("");
  const [discountBusy, setDiscountBusy] = useState(false);

  async function submitDiscount(event) {
    event.preventDefault();
    setDiscountError("");
    const value = discount === "" ? 0 : Number.parseInt(discount, 10);
    if (!Number.isInteger(value) || value < 0) {
      setDiscountError("Discount must be a whole number of rupees, 0 or more.");
      return;
    }
    if (value > order.subtotal) {
      setDiscountError("Discount cannot be more than the order subtotal.");
      return;
    }
    if (value > 0 && !discountReason.trim()) {
      setDiscountError("A discount reason is required when a discount is given.");
      return;
    }
    setDiscountBusy(true);
    try {
      await postJson(`/api/orders/${order.id}/discount`, {
        discount: value,
        discountReason: discountReason.trim(),
      });
      router.refresh();
    } catch (err) {
      setDiscountError(err.message);
    } finally {
      setDiscountBusy(false);
    }
  }

  // --- Payment ----------------------------------------------------------
  const [method, setMethod] = useState("CASH");
  const [amount, setAmount] = useState(String(remaining));
  const [reference, setReference] = useState("");
  const [completeAfter, setCompleteAfter] = useState(false);
  const [payError, setPayError] = useState("");
  const [payBusy, setPayBusy] = useState(false);

  useEffect(() => {
    setAmount(String(remaining));
  }, [remaining]);

  async function submitPayment(event) {
    event.preventDefault();
    setPayError("");
    const value = Number.parseInt(amount, 10);
    if (!Number.isInteger(value) || value <= 0) {
      setPayError("Payment amount must be a whole number of rupees, more than 0.");
      return;
    }
    if (value > remaining) {
      setPayError(
        `Amount is more than the remaining balance of ${formatPKR(remaining, currency)}. Overpayment is not accepted.`,
      );
      return;
    }
    setPayBusy(true);
    try {
      await postJson(`/api/orders/${order.id}/payment`, {
        method,
        amount: value,
        reference: reference.trim() || undefined,
        complete: completeAfter,
      });
      setReference("");
      setCompleteAfter(false);
      router.refresh();
    } catch (err) {
      setPayError(err.message);
    } finally {
      setPayBusy(false);
    }
  }

  // --- Complete / cancel / flags / rider --------------------------------
  const [completeError, setCompleteError] = useState("");
  const [completeBusy, setCompleteBusy] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [flagsError, setFlagsError] = useState("");
  const [flagsBusy, setFlagsBusy] = useState(false);
  const [riderId, setRiderId] = useState(order.riderId || "");
  const [riderError, setRiderError] = useState("");
  const [riderBusy, setRiderBusy] = useState(false);

  async function submitComplete() {
    setCompleteError("");
    setCompleteBusy(true);
    try {
      await postJson(`/api/orders/${order.id}/complete`, {});
      router.refresh();
    } catch (err) {
      setCompleteError(err.message);
    } finally {
      setCompleteBusy(false);
    }
  }

  async function submitCancel(event) {
    event.preventDefault();
    setCancelError("");
    if (!cancelReason.trim()) {
      setCancelError("A cancellation reason is required.");
      return;
    }
    setCancelBusy(true);
    try {
      await postJson(`/api/orders/${order.id}/cancel`, { reason: cancelReason.trim() });
      router.refresh();
    } catch (err) {
      setCancelError(err.message);
    } finally {
      setCancelBusy(false);
    }
  }

  async function clearFlags() {
    setFlagsError("");
    setFlagsBusy(true);
    try {
      await postJson(`/api/orders/${order.id}/clear-flags`, {});
      router.refresh();
    } catch (err) {
      setFlagsError(err.message);
    } finally {
      setFlagsBusy(false);
    }
  }

  async function submitRider(event) {
    event.preventDefault();
    setRiderError("");
    setRiderBusy(true);
    try {
      await postJson(`/api/orders/${order.id}/assign-rider`, {
        riderId: riderId || null,
      });
      router.refresh();
    } catch (err) {
      setRiderError(err.message);
    } finally {
      setRiderBusy(false);
    }
  }

  const hasFlags = Boolean(order.waiterCalledAt || order.billRequestedAt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Link href={`/orders/${order.id}/receipt`} className="btn btn-secondary">
          <Icon name="printer" className="h-4 w-4" />
          Print receipt
        </Link>
        {order.type === "DINE_IN" && hasFlags ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={clearFlags}
              disabled={flagsBusy}
              className="btn btn-secondary"
            >
              {flagsBusy ? "Clearing…" : "Clear waiter / bill flags"}
            </button>
            {flagsError ? (
              <span className="text-xs font-medium text-red-600">{flagsError}</span>
            ) : null}
          </span>
        ) : null}
      </div>

      {canGrow ? (
        <section className="card card-pad space-y-3">
          <h2 className="section-title">Add items (new batch)</h2>
          <p className="section-desc">
            New items join this running bill as a fresh kitchen batch. The totals update
            automatically; any discount stays as it is.
          </p>
          <MenuLinePicker
            menu={menu}
            currency={currency}
            onAdd={(line) =>
              setPendingLines((current) => [
                ...current,
                { ...line, key: `${Date.now()}-${current.length}` },
              ])
            }
            lines={pendingLines}
            onQuickAdd={quickAddPending}
            onLineQty={updatePendingQty}
            onRemoveLine={removePendingLine}
          />
          {pendingLines.length > 0 ? (
            <div className="space-y-2">
              <ul className="space-y-1.5">
                {pendingLines.map((line, index) => {
                  let itemName = `Item #${line.menuItemId}`;
                  let variantName = "";
                  for (const category of menu || []) {
                    const found = (category.items || []).find(
                      (item) => item.id === line.menuItemId,
                    );
                    if (found) {
                      itemName = found.name;
                      variantName =
                        (found.variants || []).find((v) => v.id === line.variantId)?.name || "";
                      break;
                    }
                  }
                  return (
                    <li
                      key={line.key}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0">
                        {itemName}
                        {variantName ? ` (${variantName})` : ""}
                        {line.note ? ` — ${line.note}` : ""}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label="One less"
                          onClick={() =>
                            line.quantity <= 1
                              ? removePendingLine(line.key)
                              : updatePendingQty(line.key, -1)
                          }
                          className="btn btn-secondary btn-sm"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-semibold">{line.quantity}</span>
                        <button
                          type="button"
                          aria-label="One more"
                          onClick={() => updatePendingQty(line.key, 1)}
                          className="btn btn-secondary btn-sm"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove pending line ${index + 1}`}
                          onClick={() => removePendingLine(line.key)}
                          className="rounded-md p-1 text-red-600 hover:bg-red-50"
                        >
                          <Icon name="x" className="h-4 w-4" />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <ActionError message={addError} />
              <button
                type="button"
                onClick={submitAddItems}
                disabled={addBusy}
                className="btn btn-primary"
              >
                {addBusy ? "Adding…" : `Add ${pendingLines.length} line${pendingLines.length === 1 ? "" : "s"} to order`}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {canDiscount ? (
        <section className="card card-pad space-y-3">
          <h2 className="section-title">Discount</h2>
          <form onSubmit={submitDiscount} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="order-discount" className="label">
                  Discount ({currency})
                </label>
                <input
                  id="order-discount"
                  type="number"
                  min="0"
                  step="1"
                  value={discount}
                  onChange={(event) => setDiscount(event.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="order-discount-reason" className="label">
                  Discount reason
                </label>
                <input
                  id="order-discount-reason"
                  type="text"
                  value={discountReason}
                  onChange={(event) => setDiscountReason(event.target.value)}
                  placeholder="Required when discount is more than 0"
                  className="input"
                />
              </div>
            </div>
            <ActionError message={discountError} />
            <button type="submit" disabled={discountBusy} className="btn btn-secondary">
              {discountBusy ? "Saving…" : "Save discount"}
            </button>
          </form>
        </section>
      ) : null}

      {canPay ? (
        <section className="card card-pad space-y-3">
          <h2 className="section-title">Record payment</h2>
          <p className="section-desc">
            Paid so far: {formatPKR(paidTotal, currency)} · Remaining:{" "}
            <strong>{formatPKR(remaining, currency)}</strong>
          </p>
          <form onSubmit={submitPayment} className="space-y-3">
            <fieldset>
              <legend className="label">Method</legend>
              <div className="flex flex-wrap gap-2">
                {PAYMENT_METHODS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setMethod(option.value)}
                    className={`pill ${method === option.value ? "pill-active" : ""}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="order-amount" className="label">
                  Amount ({currency})
                </label>
                <input
                  id="order-amount"
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="input"
                />
                <p className="form-note mt-1">
                  Defaults to the full remaining balance. Partial payments are allowed;
                  overpayment is not.
                </p>
              </div>
              <div>
                <label htmlFor="order-reference" className="label">
                  Reference (optional)
                </label>
                <input
                  id="order-reference"
                  type="text"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="e.g. transaction id"
                  className="input"
                />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={completeAfter}
                onChange={(event) => setCompleteAfter(event.target.checked)}
              />
              Mark order completed after this payment (only works when the bill is fully paid)
            </label>
            <ActionError message={payError} />
            <button type="submit" disabled={payBusy} className="btn btn-primary">
              {payBusy ? "Recording…" : `Record ${formatPKR(Number.parseInt(amount, 10) || 0, currency)}`}
            </button>
          </form>
        </section>
      ) : null}

      {canComplete ? (
        <section className="card card-pad space-y-3">
          <h2 className="section-title">Complete order</h2>
          <p className="section-desc">
            This order is fully paid. Completing it frees the table and counts it in the
            customer&apos;s history.
          </p>
          <ActionError message={completeError} />
          <button
            type="button"
            onClick={submitComplete}
            disabled={completeBusy}
            className="btn btn-primary"
          >
            {completeBusy ? "Completing…" : "Mark completed"}
          </button>
        </section>
      ) : null}

      {order.type === "DELIVERY" && !isClosed ? (
        <section className="card card-pad space-y-3">
          <h2 className="section-title">Rider assignment</h2>
          <form onSubmit={submitRider} className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <label htmlFor="order-rider" className="label">
                Assigned rider
              </label>
              <select
                id="order-rider"
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
            <button type="submit" disabled={riderBusy} className="btn btn-secondary">
              {riderBusy ? "Saving…" : "Save rider"}
            </button>
          </form>
          <ActionError message={riderError} />
          {(riders || []).length === 0 ? (
            <p className="form-note">
              No active riders yet. An admin can change a staff account&apos;s role to Rider
              in Users.
            </p>
          ) : null}
        </section>
      ) : null}

      {!isClosed ? (
        <section className="card card-pad space-y-3 border-red-200">
          <h2 className="section-title">Cancel order</h2>
          {order.paymentStatus === "PAID" ? (
            <p className="section-desc">
              This order is paid — cancelling marks the payment as refunded (manual counter
              refund). The kitchen history stays as it is.
            </p>
          ) : null}
          {showCancel ? (
            <form onSubmit={submitCancel} className="space-y-3">
              <div>
                <label htmlFor="order-cancel-reason" className="label">
                  Cancellation reason *
                </label>
                <input
                  id="order-cancel-reason"
                  type="text"
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  placeholder="e.g. Customer left"
                  className="input"
                />
              </div>
              <ActionError message={cancelError} />
              <span className="flex flex-wrap gap-2">
                <button type="submit" disabled={cancelBusy} className="btn btn-danger">
                  {cancelBusy ? "Cancelling…" : "Confirm cancellation"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCancel(false)}
                  className="btn btn-secondary"
                >
                  Keep order
                </button>
              </span>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowCancel(true)}
              className="btn btn-danger-outline"
            >
              Cancel order…
            </button>
          )}
        </section>
      ) : (
        <p className="form-note">
          This order is {order.status.toLowerCase()}.{" "}
          <Badge tone={order.status === "COMPLETED" ? "emerald" : "red"}>
            {order.status}
          </Badge>
        </p>
      )}
    </div>
  );
}
