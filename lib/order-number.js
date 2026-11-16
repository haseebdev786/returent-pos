// SAVE AS: lib/order-number.js
// Daily order numbers: R-YYYYMMDD-NNNN (e.g. R-20261116-0007).
//
// CONCURRENCY: nextOrderNumber MUST be called with the caller's Prisma
// transaction client (tx), never the global prisma. The upsert touches
// the DailyOrderCounter row for the local date inside that transaction,
// so PostgreSQL locks the row until commit and two concurrent checkouts
// cannot receive the same number. The date key uses the LOCAL date
// (lib/format.js todayKey), so numbers reset at local midnight.

import { todayKey } from "@/lib/format";

export async function nextOrderNumber(tx, date = new Date()) {
  const key = todayKey(date);
  const counter = await tx.dailyOrderCounter.upsert({
    where: { dateKey: key },
    update: { lastNumber: { increment: 1 } },
    create: { dateKey: key, lastNumber: 1 },
  });
  const stamp = key.replaceAll("-", "");
  const sequence = String(counter.lastNumber).padStart(4, "0");
  return `R-${stamp}-${sequence}`;
}
