// SAVE AS: lib/cache.js
// Tiny read-through cache for the published menu and Settings.
// Redis is optional: every read/write is wrapped in try/catch and falls
// back to the fetcher (PostgreSQL). The app NEVER crashes without Redis.
// TTL is 60s; writes invalidate immediately via the invalidate helpers.

import { redis } from "@/lib/redis";

export const MENU_CACHE_KEY = "menu:published";
export const SETTINGS_CACHE_KEY = "settings:1";
const TTL_SECONDS = 60;

function parseCached(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

async function getCached(key, fetcher) {
  if (redis) {
    try {
      const cached = parseCached(await redis.get(key));
      if (cached !== null) return cached;
    } catch {
      // Fall through to the fetcher — Redis failure is never fatal.
    }
  }

  const fresh = await fetcher();

  if (redis && fresh !== null && fresh !== undefined) {
    try {
      await redis.set(key, JSON.stringify(fresh), { ex: TTL_SECONDS });
    } catch {
      // Swallowed: caching is best-effort only.
    }
  }

  return fresh;
}

async function invalidate(key) {
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // Swallowed: a stale key expires within TTL_SECONDS anyway.
  }
}

export function getCachedMenu(fetcher) {
  return getCached(MENU_CACHE_KEY, fetcher);
}

export function invalidateMenu() {
  return invalidate(MENU_CACHE_KEY);
}

export function getCachedSettings(fetcher) {
  return getCached(SETTINGS_CACHE_KEY, fetcher);
}

export function invalidateSettings() {
  return invalidate(SETTINGS_CACHE_KEY);
}
