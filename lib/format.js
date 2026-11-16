// SAVE AS: lib/format.js
// Display formatting helpers. All money is whole PKR (Int) — no decimals
// anywhere. All date helpers use the server's LOCAL timezone and never
// shift to UTC, so order dates match the shop's wall clock.

export function roundMoney(n) {
  return Math.round(Number(n) || 0);
}

/** "Rs 1,250" — whole rupees, thousands separators, no decimals. */
export function formatPKR(amount, currency = "Rs") {
  const value = roundMoney(amount);
  return `${currency} ${value.toLocaleString("en-US")}`;
}

/** "16 Nov 2026" — local date, no UTC shift. */
export function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "16 Nov 2026, 14:30" — local date + time. */
export function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/** "14:30" — local 24-hour time. */
export function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Local YYYY-MM-DD key for DailyOrderCounter. Built from local
 * getFullYear/getMonth/getDate — never toISOString (UTC would flip the
 * date after midnight PKT and split one trading day across two keys).
 */
export function todayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
