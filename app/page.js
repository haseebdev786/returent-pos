// SAVE AS: app/page.js
// Public landing page (server component). Restaurant name, address and
// phone come from Settings/defaults — never hardcoded here. No demo
// numbers, no fake stats. Dine-in guests reach ordering via table QR
// codes; everyone else can start an order or staff can sign in.

import Link from "next/link";
import { getPublicSettings } from "@/lib/settings-data";

export default async function HomePage() {
  const settings = await getPublicSettings();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center justify-center px-4 py-12">
      <div className="card card-pad w-full text-center">
        <p className="text-xs font-semibold tracking-widest text-brand-600 uppercase">
          Restaurant POS
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          {settings.restaurantName}
        </h1>
        {(settings.address || settings.phone) && (
          <p className="mt-2 text-sm text-slate-600">
            {[settings.address, settings.phone].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className="page-desc mx-auto mt-4 max-w-md">
          Order from your table with the QR code, or start a takeaway or
          delivery order below.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/order" className="btn btn-primary btn-lg">
            Start an order
          </Link>
          <Link href="/login" className="btn btn-secondary btn-lg">
            Staff login
          </Link>
        </div>
        <p className="form-note mt-6">
          Dining in? Scan the QR code on your table to order from your seat.
        </p>
      </div>
    </main>
  );
}
