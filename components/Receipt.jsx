// SAVE AS: components/Receipt.jsx
// Presentational 80mm thermal receipt. No hooks, no client code —
// props only. Renders inside the .receipt class from app/globals.css
// (80mm wide, print CSS hides .no-print siblings).
// Props: { order, settings }. The order carries batches (with snapshot
// items + addons), payments, and table. ALL items print with their
// snapshot prices — the receipt never re-reads the live menu. When an
// order has more than one batch, batch subheaders separate the runs so
// the customer can see what was added later. Money uses the Settings
// currency. Change is always zero: overpayment is rejected by the
// payment API, so the receipt honestly shows "Paid in full" or the
// exact balance due — never an invented change amount.

import { formatDateTime, formatPKR } from "@/lib/format";

const TYPE_LABELS = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

const METHOD_LABELS = {
  CASH: "Cash",
  CARD: "Card",
  JAZZCASH: "JazzCash",
  EASYPAISA: "EasyPaisa",
  COD: "Cash on delivery",
};

export default function Receipt({ order, settings }) {
  const currency = settings?.currency || "Rs";
  const money = (amount) => formatPKR(amount, currency);
  const batches = order?.batches || [];
  const payments = order?.payments || [];
  const paidTotal = payments.reduce(
    (sum, payment) => (payment.status === "PAID" ? sum + payment.amount : sum),
    0,
  );
  const remaining = Math.max(0, (order?.grandTotal || 0) - paidTotal);
  const showBatchHeaders = batches.length > 1;

  return (
    <div className="receipt px-2 py-4">
      <div className="text-center">
        <p className="text-base font-bold">{settings?.restaurantName || "Restaurant"}</p>
        {settings?.address ? <p>{settings.address}</p> : null}
        {settings?.phone ? <p>Tel: {settings.phone}</p> : null}
      </div>

      <hr className="my-2 border-dashed border-slate-400" />

      <div className="flex items-baseline justify-between gap-2">
        <span className="font-bold">{order?.orderNumber}</span>
        <span>{formatDateTime(order?.createdAt)}</span>
      </div>
      <p>
        {TYPE_LABELS[order?.type] || order?.type}
        {order?.table ? ` — ${order.table.name} (${order.table.code})` : ""}
      </p>
      {order?.customerName ? <p>Customer: {order.customerName}</p> : null}
      {order?.customerPhone ? <p>Phone: {order.customerPhone}</p> : null}
      {order?.deliveryAddress ? <p>Address: {order.deliveryAddress}</p> : null}

      <hr className="my-2 border-dashed border-slate-400" />

      {batches.map((batch) => (
        <div key={batch.id}>
          {showBatchHeaders ? (
            <p className="mt-1 font-semibold">Batch {batch.batchNumber}</p>
          ) : null}
          {(batch.items || []).map((item) => (
            <div key={item.id} className="py-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0">
                  {item.itemName}
                  {item.variantName ? ` (${item.variantName})` : ""} x {item.quantity}
                </span>
                <span className="shrink-0 font-medium">{money(item.lineTotal)}</span>
              </div>
              {(item.addons || []).map((addon) => (
                <div
                  key={addon.id}
                  className="flex items-baseline justify-between gap-2 pl-4 text-slate-600"
                >
                  <span>+ {addon.addonName} x {item.quantity}</span>
                  <span className="shrink-0">{money(addon.price * item.quantity)}</span>
                </div>
              ))}
              {item.note ? <p className="pl-4 text-slate-600">Note: {item.note}</p> : null}
            </div>
          ))}
        </div>
      ))}

      <hr className="my-2 border-dashed border-slate-400" />

      <div className="space-y-0.5">
        <div className="flex justify-between gap-2">
          <span>Subtotal</span>
          <span>{money(order?.subtotal)}</span>
        </div>
        {order?.discount > 0 ? (
          <div className="flex justify-between gap-2">
            <span>
              Discount
              {order.discountReason ? ` (${order.discountReason})` : ""}
            </span>
            <span>-{money(order.discount)}</span>
          </div>
        ) : null}
        {order?.tax > 0 ? (
          <div className="flex justify-between gap-2">
            <span>Tax{order.taxRateApplied ? ` (${order.taxRateApplied}%)` : ""}</span>
            <span>{money(order.tax)}</span>
          </div>
        ) : null}
        {order?.serviceCharge > 0 ? (
          <div className="flex justify-between gap-2">
            <span>
              Service charge
              {order.serviceChargeRateApplied ? ` (${order.serviceChargeRateApplied}%)` : ""}
            </span>
            <span>{money(order.serviceCharge)}</span>
          </div>
        ) : null}
        {order?.deliveryFee > 0 ? (
          <div className="flex justify-between gap-2">
            <span>Delivery fee</span>
            <span>{money(order.deliveryFee)}</span>
          </div>
        ) : null}
        <div className="flex justify-between gap-2 pt-1 text-sm font-bold">
          <span>Total</span>
          <span>{money(order?.grandTotal)}</span>
        </div>
      </div>

      {payments.length > 0 ? (
        <>
          <hr className="my-2 border-dashed border-slate-400" />
          <div className="space-y-0.5">
            {payments.map((payment) => (
              <div key={payment.id} className="flex justify-between gap-2">
                <span>
                  {METHOD_LABELS[payment.method] || payment.method}
                  {payment.reference ? ` (${payment.reference})` : ""}
                  {payment.status !== "PAID" ? ` — ${payment.status}` : ""}
                </span>
                <span>{money(payment.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-2 font-semibold">
              <span>Paid</span>
              <span>{money(paidTotal)}</span>
            </div>
          </div>
        </>
      ) : null}

      {remaining > 0 ? (
        <div className="flex justify-between gap-2 pt-1 font-bold">
          <span>Balance due</span>
          <span>{money(remaining)}</span>
        </div>
      ) : order?.paymentStatus === "PAID" ? (
        <p className="pt-1 text-center font-bold">Paid in full</p>
      ) : (
        <div className="flex justify-between gap-2 pt-1 font-bold">
          <span>Balance due</span>
          <span>{money(0)}</span>
        </div>
      )}

      {order?.cancelledReason ? <p className="pt-1">Cancelled: {order.cancelledReason}</p> : null}
      {order?.paymentStatus === "REFUNDED" ? <p className="pt-1">Payment refunded.</p> : null}

      {settings?.receiptFooter ? (
        <>
          <hr className="my-2 border-dashed border-slate-400" />
          <p className="text-center">{settings.receiptFooter}</p>
        </>
      ) : null}
    </div>
  );
}
