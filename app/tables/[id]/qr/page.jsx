// SAVE AS: app/tables/[id]/qr/page.jsx
// Printable QR code page for one table. Admin + cashier, AppShell
// wrapped (same shell pattern as the other staff pages). The QR encodes
// the public ordering URL /t/<code> and is generated server-side with
// the `qrcode` package — NO external QR API.
//
// URL SOURCE: Settings.publicUrl wins, else NEXT_PUBLIC_APP_URL. If
// neither is set, no absolute link is invented: the page shows the
// relative path /t/<code> with a prominent warning, and no QR image is
// rendered (a QR code pointing at a wrong/guessed host would be worse
// than none). Set the public URL in Settings (or the env var) and
// reload to get the printable code.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { Badge, Icon, PageHeader } from "@/components/ui";
import { getCurrentUser, hasRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings-data";
import { getTableQrDataUrl } from "@/lib/qr-code";
import PrintButton from "@/components/QrPrintButton";

export default async function TableQrPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const shellUser = { name: user.name, email: user.email, role: user.role };

  if (!hasRole(user, ["admin", "cashier"])) {
    return (
      <AppShell user={shellUser}>
        <PageHeader title="Table QR code" />
        <p className="form-error mt-4">
          Your role cannot view table QR codes. Ask an admin or cashier for
          help.
        </p>
      </AppShell>
    );
  }

  const { id } = await params;
  const tableId = Number(id);
  const table = Number.isInteger(tableId)
    ? await prisma.table.findUnique({ where: { id: tableId } })
    : null;
  if (!table) notFound();

  const settings = await getSettings();
  const base = (settings.publicUrl || process.env.NEXT_PUBLIC_APP_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const relativePath = `/t/${table.code}`;
  const absoluteUrl = base ? `${base}${relativePath}` : null;
  const qrDataUrl = absoluteUrl ? await getTableQrDataUrl(absoluteUrl) : null;

  return (
    <AppShell user={shellUser}>
      <div className="no-print">
        <PageHeader
          title="Table QR code"
          description="Print this page and place it on the table so guests can scan to order."
          actions={
            <>
              <Link href="/tables" className="btn btn-secondary">
                <Icon name="arrowLeft" className="h-4 w-4" />
                Back to tables
              </Link>
              {qrDataUrl ? <PrintButton /> : null}
            </>
          }
        />
      </div>

      {!absoluteUrl ? (
        <p className="form-error mt-4">
          No public URL is configured, so no QR code can be generated. Set
          the public URL in Settings (or the NEXT_PUBLIC_APP_URL variable)
          to the address customers reach this app at, then reload this
          page. The ordering path for this table is{" "}
          <strong>{relativePath}</strong>.
        </p>
      ) : null}

      <div className="card card-pad mx-auto mt-4 max-w-md text-center">
        <p className="text-xs font-semibold tracking-widest text-brand-600 uppercase">
          {settings.restaurantName}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          {table.name}
        </h1>
        <p className="page-desc">
          Code {table.code} · {table.seats} seat{table.seats === 1 ? "" : "s"}
          {!table.isActive ? " · Inactive" : ""}
        </p>
        <div className="mt-2 flex justify-center">
          <Badge tone={table.status === "OCCUPIED" ? "amber" : "green"}>
            {table.status === "OCCUPIED" ? "Occupied" : "Free"}
          </Badge>
        </div>

        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt={`QR code for ${table.name} ordering link`}
            width={512}
            height={512}
            className="mx-auto mt-4 h-64 w-64"
          />
        ) : (
          <div className="mx-auto mt-4 flex h-64 w-64 items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-sm text-slate-500">
            QR code unavailable — public URL not set.
          </div>
        )}

        <p className="mt-3 text-base font-semibold text-slate-900">
          Scan to order from this table
        </p>
        <p className="mt-1 text-sm break-all text-slate-600">
          {absoluteUrl ?? relativePath}
        </p>
        {settings.phone ? (
          <p className="mt-2 text-sm text-slate-600">
            Questions? Call {settings.phone}
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
