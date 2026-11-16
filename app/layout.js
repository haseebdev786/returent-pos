// SAVE AS: app/layout.js
// Root layout. No session reads here — staff pages check auth in their
// own layouts/pages, and public pages must render without a session.

import "./globals.css";

export const metadata = {
  title: "Restaurant POS",
  description: "Counter, kitchen, delivery and QR table ordering for one restaurant.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-slate-100 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
