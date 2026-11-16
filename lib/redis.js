// SAVE AS: lib/redis.js
// Upstash Redis client — created ONLY when both REST env vars are set.
// Otherwise `redis` is null and every caller must fall back gracefully.
// Redis is cache + rate limiting ONLY in this app; PostgreSQL is the
// source of truth. This module never throws when Redis is unconfigured.

import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

export const redis =
  url && token ? new Redis({ url, token }) : null;

export const hasRedis = redis !== null;

export default redis;
