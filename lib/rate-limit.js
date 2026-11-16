// SAVE AS: lib/rate-limit.js
// Best-effort rate limiting for public/API routes.
// Redis INCR + EXPIRE when available, otherwise an in-memory Map (per
// server instance only — good enough as a fallback, not exact across
// instances). Never throws; on ANY error it allows the request so a
// Redis outage can never take the ordering flow down.

import { redis } from "@/lib/redis";

// key -> { count, resetAt }
const memoryStore = new Map();

function pruneMemory(now) {
  for (const [key, entry] of memoryStore) {
    if (entry.resetAt <= now) memoryStore.delete(key);
  }
}

function memoryCheck(key, limit, windowSeconds) {
  const now = Date.now();
  pruneMemory(now);
  const resetAt = now + windowSeconds * 1000;
  const entry = memoryStore.get(key);
  if (!entry) {
    memoryStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(0, limit - 1) };
  }
  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
  };
}

/**
 * @returns {Promise<{allowed: boolean, remaining: number}>}
 */
export async function checkRateLimit(key, limit, windowSeconds) {
  try {
    if (redis) {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
      };
    }
    return memoryCheck(key, limit, windowSeconds);
  } catch {
    // Fail open: never block ordering because rate limiting broke.
    return { allowed: true, remaining: limit };
  }
}
