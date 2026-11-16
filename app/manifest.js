// SAVE AS: app/manifest.js
// PWA manifest (static). Icons are intentionally omitted in Phase 1 —
// add icon files and reference them here before advertising install.

export default function manifest() {
  return {
    name: "Restaurant POS",
    short_name: "Restaurant POS",
    description: "Counter, kitchen, delivery and QR table ordering.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ea580c",
  };
}
