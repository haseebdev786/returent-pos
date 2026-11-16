// SAVE AS: lib/prisma.js
// PrismaClient singleton, cached on globalThis so Next.js dev hot reloads
// and serverless re-invocations reuse one client instead of exhausting
// the hosted PostgreSQL connection pool. Never call $disconnect in a
// request path — disconnecting the shared client breaks later requests.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
