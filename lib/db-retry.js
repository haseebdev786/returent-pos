// SAVE AS: lib/db-retry.js
// Retry transient database failures so one click succeeds instead of
// needing 2-3. Neon (the hosted Postgres) suspends its compute after a
// few idle minutes and pooled connections go stale; the first query
// after that can fail with a closed connection or a pool timeout while
// the NEXT attempt works — exactly the "click Place order 2-3 times"
// symptom. Retrying inside the request hides the wake-up from the user.
//
// SAFETY: only errors that prove nothing was committed are retried —
// Prisma connection/pool/transaction errors. Validation errors
// (isValidation / ORDER_VALIDATION) and everything else are thrown
// immediately. The retried function MUST be a single Prisma
// transaction (or otherwise atomic): a failed transaction rolls back
// completely, so retrying it cannot create a duplicate order, consume
// an order number, or double-charge anything. Never wrap a function
// that already wrote outside a transaction.

const TRANSIENT_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // Database server reached, connection timed out
  "P1017", // Server has closed the connection
  "P2024", // Timed out fetching a connection from the pool
  "P2028", // Transaction API error (e.g. transaction closed)
  "P2034", // Transaction failed: write conflict / deadlock
]);

const TRANSIENT_MESSAGE_PARTS = [
  "server has closed the connection",
  "connection closed",
  "connection terminated",
  "terminating connection",
  "connection timed out",
  "timed out fetching a new connection",
  "can't reach database server",
  "cant reach database server",
  "could not connect to server",
  "connection refused",
  "econnreset",
  "etimedout",
  "econnrefused",
  "enotfound",
  "socket hang up",
  "deadlock detected",
  "write conflict",
  "timeout",
  "timed out",
];

function errorText(err) {
  const parts = [err?.message, err?.cause?.message, String(err || "")];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function isTransientDbError(err) {
  if (!err || err.isValidation) return false;
  if (err.code === "ORDER_VALIDATION") return false;
  const code = err.code || err.errorCode;
  if (code && TRANSIENT_CODES.has(code)) return true;
  const text = errorText(err);
  return TRANSIENT_MESSAGE_PARTS.some((part) => text.includes(part));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withDbRetry(fn, { attempts = 3, delays = [400, 1200] } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const lastAttempt = attempt === attempts - 1;
      if (lastAttempt || !isTransientDbError(err)) throw err;
      console.warn(
        `Transient DB error, retrying (${attempt + 1}/${attempts - 1}):`,
        err?.code || err?.errorCode || err?.message,
      );
      await sleep(delays[attempt] ?? 1000);
    }
  }
  throw lastError;
}
