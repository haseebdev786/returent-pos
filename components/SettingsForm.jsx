// SAVE AS: components/SettingsForm.jsx
// Settings form — one form for every Setting field. Client component:
// it PATCHes /api/settings and shows success only when the API really
// saved, with the API's own error text (including per-field errors)
// when it did not. Integer fields are kept as strings in state and
// checked for whole numbers before submit; ranges and URL rules are
// enforced server-side and their errors are shown here unchanged.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function toFormState(settings) {
  return {
    restaurantName: settings.restaurantName ?? "",
    address: settings.address ?? "",
    phone: settings.phone ?? "",
    currency: settings.currency ?? "",
    taxRate: String(settings.taxRate ?? 0),
    taxEnabled: Boolean(settings.taxEnabled),
    serviceChargeRate: String(settings.serviceChargeRate ?? 0),
    serviceChargeEnabled: Boolean(settings.serviceChargeEnabled),
    deliveryFee: String(settings.deliveryFee ?? 0),
    freeDeliveryThreshold: String(settings.freeDeliveryThreshold ?? 0),
    minOrderAmount: String(settings.minOrderAmount ?? 0),
    publicUrl: settings.publicUrl ?? "",
    receiptFooter: settings.receiptFooter ?? "",
  };
}

const INTEGER_FIELDS = [
  "taxRate",
  "serviceChargeRate",
  "deliveryFee",
  "freeDeliveryThreshold",
  "minOrderAmount",
];

export default function SettingsForm({ initialSettings }) {
  const router = useRouter();
  const [form, setForm] = useState(() => toFormState(initialSettings));
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    setSavedMessage("");
    setFieldErrors({});

    // Whole-number check only; ranges stay server-side.
    const localErrors = {};
    for (const field of INTEGER_FIELDS) {
      if (!/^\d+$/.test(form[field].trim())) {
        localErrors[field] = "Enter a whole number.";
      }
    }
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setFormError("Settings could not be saved. Check the highlighted fields.");
      return;
    }

    const payload = {
      restaurantName: form.restaurantName.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      currency: form.currency.trim(),
      taxRate: Number(form.taxRate.trim()),
      taxEnabled: form.taxEnabled,
      serviceChargeRate: Number(form.serviceChargeRate.trim()),
      serviceChargeEnabled: form.serviceChargeEnabled,
      deliveryFee: Number(form.deliveryFee.trim()),
      freeDeliveryThreshold: Number(form.freeDeliveryThreshold.trim()),
      minOrderAmount: Number(form.minOrderAmount.trim()),
      publicUrl: form.publicUrl.trim(),
      receiptFooter: form.receiptFooter.trim(),
    };

    setBusy(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFormError(data?.error || "Settings could not be saved.");
        setFieldErrors(data?.errors && typeof data.errors === "object" ? data.errors : {});
        return;
      }
      // Show exactly what is stored, straight from the API response.
      if (data?.settings) setForm(toFormState(data.settings));
      setSavedMessage("Settings saved.");
      router.refresh();
    } catch (err) {
      setFormError(err?.message || "Settings could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function fieldError(field) {
    return fieldErrors[field] ? (
      <p className="field-error">{fieldErrors[field]}</p>
    ) : null;
  }

  return (
    <form onSubmit={handleSubmit} className="card card-pad space-y-6">
      {formError ? <p className="form-error">{formError}</p> : null}
      {savedMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {savedMessage}
        </p>
      ) : null}

      <fieldset>
        <legend className="section-title">Restaurant</legend>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="settings-name" className="label">
              Restaurant name
            </label>
            <input
              id="settings-name"
              type="text"
              required
              value={form.restaurantName}
              onChange={(event) => setField("restaurantName", event.target.value)}
              className="input"
              placeholder="Restaurant name"
            />
            {fieldError("restaurantName")}
          </div>
          <div>
            <label htmlFor="settings-currency" className="label">
              Currency
            </label>
            <input
              id="settings-currency"
              type="text"
              required
              value={form.currency}
              onChange={(event) => setField("currency", event.target.value)}
              className="input"
              placeholder="Rs"
            />
            <p className="form-note mt-1">
              Short label shown before amounts, e.g. Rs.
            </p>
            {fieldError("currency")}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="settings-address" className="label">
              Address
            </label>
            <input
              id="settings-address"
              type="text"
              value={form.address}
              onChange={(event) => setField("address", event.target.value)}
              className="input"
              placeholder="Street address"
            />
            {fieldError("address")}
          </div>
          <div>
            <label htmlFor="settings-phone" className="label">
              Phone
            </label>
            <input
              id="settings-phone"
              type="tel"
              value={form.phone}
              onChange={(event) => setField("phone", event.target.value)}
              className="input"
              placeholder="Phone number"
            />
            {fieldError("phone")}
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend className="section-title">Tax and service charge</legend>
        <p className="section-desc">
          Rates are percentages applied to the bill subtotal after discount.
          A charge only applies when its checkbox is on.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="settings-tax-rate" className="label">
              Tax rate (%)
            </label>
            <input
              id="settings-tax-rate"
              type="number"
              inputMode="numeric"
              min="0"
              max="100"
              step="1"
              required
              value={form.taxRate}
              onChange={(event) => setField("taxRate", event.target.value)}
              className="input"
            />
            {fieldError("taxRate")}
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.taxEnabled}
                onChange={(event) => setField("taxEnabled", event.target.checked)}
              />
              Charge tax on orders
            </label>
            {fieldError("taxEnabled")}
          </div>
          <div>
            <label htmlFor="settings-service-rate" className="label">
              Service charge rate (%)
            </label>
            <input
              id="settings-service-rate"
              type="number"
              inputMode="numeric"
              min="0"
              max="100"
              step="1"
              required
              value={form.serviceChargeRate}
              onChange={(event) => setField("serviceChargeRate", event.target.value)}
              className="input"
            />
            {fieldError("serviceChargeRate")}
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.serviceChargeEnabled}
                onChange={(event) =>
                  setField("serviceChargeEnabled", event.target.checked)
                }
              />
              Charge a service charge on orders
            </label>
            {fieldError("serviceChargeEnabled")}
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend className="section-title">Delivery and orders</legend>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="settings-delivery-fee" className="label">
              Delivery fee
            </label>
            <input
              id="settings-delivery-fee"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              required
              value={form.deliveryFee}
              onChange={(event) => setField("deliveryFee", event.target.value)}
              className="input"
            />
            <p className="form-note mt-1">Whole rupees. 0 means no fee.</p>
            {fieldError("deliveryFee")}
          </div>
          <div>
            <label htmlFor="settings-free-threshold" className="label">
              Free delivery over
            </label>
            <input
              id="settings-free-threshold"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              required
              value={form.freeDeliveryThreshold}
              onChange={(event) =>
                setField("freeDeliveryThreshold", event.target.value)
              }
              className="input"
            />
            <p className="form-note mt-1">
              Subtotal at or above this amount gets free delivery. 0 means
              never free.
            </p>
            {fieldError("freeDeliveryThreshold")}
          </div>
          <div>
            <label htmlFor="settings-min-order" className="label">
              Minimum order amount
            </label>
            <input
              id="settings-min-order"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              required
              value={form.minOrderAmount}
              onChange={(event) => setField("minOrderAmount", event.target.value)}
              className="input"
            />
            <p className="form-note mt-1">Whole rupees. 0 means no minimum.</p>
            {fieldError("minOrderAmount")}
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend className="section-title">Public link and receipt</legend>
        <div className="mt-3 grid grid-cols-1 gap-4">
          <div>
            <label htmlFor="settings-public-url" className="label">
              Public URL
            </label>
            <input
              id="settings-public-url"
              type="text"
              inputMode="url"
              value={form.publicUrl}
              onChange={(event) => setField("publicUrl", event.target.value)}
              className="input"
              placeholder="https://your-restaurant.com"
            />
            <p className="form-note mt-1">used for table QR codes; leave blank until your live domain is set</p>
            {fieldError("publicUrl")}
          </div>
          <div>
            <label htmlFor="settings-receipt-footer" className="label">
              Receipt footer
            </label>
            <input
              id="settings-receipt-footer"
              type="text"
              value={form.receiptFooter}
              onChange={(event) => setField("receiptFooter", event.target.value)}
              className="input"
              placeholder="Thank you! Visit again."
            />
            <p className="form-note mt-1">
              Printed at the bottom of every receipt.
            </p>
            {fieldError("receiptFooter")}
          </div>
        </div>
      </fieldset>

      <button type="submit" disabled={busy} className="btn btn-primary btn-lg">
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
