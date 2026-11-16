// SAVE AS: next.config.mjs
// Minimal config. cacheComponents is NOT enabled in this project, so NO
// route may use `export const instant` or any cacheComponents-only segment
// config. Pages stay dynamic via session/DB reads. Do not add `instant`
// anywhere unless cacheComponents is deliberately enabled first.

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
