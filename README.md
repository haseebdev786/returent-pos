<!-- SAVE AS: README.md -->

# Restaurant POS

Single-restaurant, single-branch point of sale for dine-in, takeaway, and delivery. Customers order from their table by scanning a QR code, or staff take orders at the counter. Orders flow to a kitchen screen in batches (a later order adds to the same running bill), riders handle deliveries, and the admin manages the menu, tables, customers, reports, and settings.

Repo: <https://github.com/haseebdev786/returent-pos.git> (note the exact spelling: **returent**).

## Stack

- **Next.js 16** (App Router, JavaScript only, no `src/` folder, `@/` import alias)
- **React 19**, **Tailwind CSS 4**
- **PostgreSQL** (hosted, e.g. Neon) via **Prisma 6** — pinned, see below
- **Better Auth** (email + password, Prisma adapter)
- **Upstash Redis** (optional cache + rate limiting only — the app works without it)
- **qrcode** (table QR codes, server-only)
- **Vercel** hosting

Money is always whole PKR (`Int`, no decimals). This app is online-hosted — it never uses SQLite or a LAN server.

## Install

```bash
git clone https://github.com/haseebdev786/returent-pos.git
cd returent-pos
npm install
cp .env.example .env.local
# Fill in .env.local (see Env vars below)
npx prisma@6 migrate dev
npm run seed
npm run dev
```

Open <http://localhost:3000>.

> **Prisma pinning warning:** always use `prisma@6` (e.g. `npx prisma@6 migrate dev`). Never run bare `npx prisma` — the latest Prisma major (v8+) has an incompatible CLI and will break this project. `package.json` pins `prisma` and `@prisma/client` to `^6`.

## Env vars

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Pooled PostgreSQL connection string (runtime). |
| `DIRECT_URL` | Yes | Direct (unpooled) PostgreSQL connection string (migrations). |
| `BETTER_AUTH_SECRET` | Yes | Long random secret for signing sessions. |
| `BETTER_AUTH_URL` | Yes | Public base URL, e.g. `http://localhost:3000` locally. |
| `NEXT_PUBLIC_APP_URL` | Yes | Public base URL used to build links (e.g. table QR codes). |
| `UPSTASH_REDIS_REST_URL` | No | Upstash Redis REST URL (cache + rate limiting). |
| `UPSTASH_REDIS_REST_TOKEN` | No | Upstash Redis REST token. |

Redis is optional: if both Redis vars are unset, menu/settings reads go straight to PostgreSQL and rate limiting uses an in-memory fallback. The app never crashes without Redis.

Never commit `.env.local` or any real secret. `.env.example` holds placeholder values only.

## Seed

```bash
npm run seed
```

Idempotent upserts: 1 Settings row (`My Restaurant` defaults), 4 categories, 12 demo menu items (with variants and addon groups), 6 tables (T1–T6). No users, orders, or payments are seeded.

> **Demo-menu warning:** the seeded menu is DEMO data. Replace it with the real menu in Admin > Menu before going live.

## First run / accounts

1. Run the migrations and seed (above), then `npm run dev`.
2. Open `/signup` and create the first account — **the first account in the database automatically becomes Admin** (see the hook in `lib/auth.js`). Later accounts start as Cashier until an admin changes their role.
3. Sign in at `/login`. Staff land by role: kitchen → `/kitchen`, rider → `/delivery`, everyone else → `/dashboard`.
4. In Admin > Settings, set the real restaurant name, address, phone, tax, service charge, and delivery fee. Never hardcode these in UI code — Settings is the one source of truth.

## Route map (contract)

Public routes:

| Route | Purpose |
|---|---|
| `/` | Public landing (restaurant name, order/login buttons). |
| `/order` | Public takeaway/delivery ordering. |
| `/t/[code]` | Table QR ordering, e.g. `/t/T1`. |
| `/order/[id]` | Customer order tracking, via `?token=<accessToken>`; add-more and cancel while the order is still changeable. |
| `/login`, `/signup` | Staff auth. |

Staff routes (each page wraps `AppShell` itself, except the standalone receipt page below; only `/dashboard` uses a layout — see `app/dashboard/layout.jsx`):

| Route | Roles | Purpose |
|---|---|---|
| `/dashboard` | admin, cashier | Sales overview. |
| `/counter` | admin, cashier | Counter billing / new orders. |
| `/orders` | admin, cashier | All orders, bills, payments. |
| `/orders/new` | admin, cashier | Staff manual order (counter). |
| `/orders/[id]` | admin, cashier | One order: batches, payments, actions. |
| `/orders/[id]/receipt` | admin, cashier | Standalone 80mm print receipt (no shell). |
| `/kitchen` | admin, kitchen | Kitchen display, batch statuses. |
| `/delivery` | admin, cashier, rider | Delivery assignments + rider view. |
| `/menu` | admin | Categories, items, variants, addons. |
| `/tables` | admin, cashier | Tables + QR codes (create/edit/delete admin-only). |
| `/tables/[id]/qr` | admin, cashier | Printable table QR code. |
| `/customers` | admin, cashier | Customer list + history. |
| `/customers/[id]` | admin, cashier | One customer's order history. |
| `/reports` | admin, cashier | Sales reports. |
| `/settings` | admin | Restaurant settings. |
| `/users` | admin | Staff users + roles. |

API routes: `/api/auth/[...all]` (Better Auth); `/api/public/menu` and `/api/public/orders/*` (public ordering, rate-limited, token-checked); `/api/orders/*` (staff orders, payments, discounts, delivery status); `/api/batches/[id]/status` and `/api/kitchen` (admin + kitchen); `/api/delivery` (admin, cashier, rider — riders see only their own); `/api/menu/*` (admin); `/api/tables/*` (read admin + cashier, writes admin); `/api/settings` and `/api/users/*` (admin).

## Key decisions

- **Order numbers:** `R-YYYYMMDD-NNNN` (e.g. `R-20261116-0007`), issued from `DailyOrderCounter` inside a Prisma transaction — see `lib/order-number.js`. Numbers reset daily.
- **Totals shape:** `{ subtotal, discount, tax, serviceCharge, deliveryFee, grandTotal }`. Tax and service charge are separate fields, never merged — see `lib/menu-data.js` (`computeTotals`, discount 0), `lib/order-create.js` (`buildOrderTotals`, discount-aware; identical to `computeTotals` at discount 0), and `lib/order-totals.js` (`recomputeOrderTotals`, from stored snapshots). The minimum-order and free-delivery-threshold checks both use the food subtotal.
- **Order status:** derived from batch states by the one helper in `lib/order-status.js`. `CANCELLED`, `COMPLETED`, and `OUT_FOR_DELIVERY` are sticky and never derived backwards.
- **Prices from snapshots:** checkout APIs resolve prices from the database; stored order items freeze name/price at order time. Client input never sets a price.
- **No `instant` / `force-dynamic`:** `cacheComponents` is not enabled, so no route uses `export const instant` or cacheComponents-only segment config. Pages stay dynamic via session/DB reads.
- **No gateway in V1:** payments are counter/cash (CASH, CARD, JAZZCASH, EASYPAISA, COD recorded at the counter). `Payment` gateway fields are reserved so an online gateway can plug in later without a rewrite.

## Deploy outline (Vercel + Neon + Upstash)

1. Create a Neon PostgreSQL database; copy the pooled URL to `DATABASE_URL` and the direct URL to `DIRECT_URL`.
2. Create an Upstash Redis database; copy the REST URL/token (optional but recommended for production).
3. Create a Vercel project from this repo. Set all env vars above in Vercel (production values; `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` = the deployed domain).
4. Run migrations against production before/after deploy: `DATABASE_URL=... DIRECT_URL=... npx prisma@6 migrate deploy` (use `migrate deploy`, never `migrate dev`, on production data).
5. Seed production only if starting fresh: `npm run seed` with production `DATABASE_URL` (then replace the demo menu immediately).
6. Verify (below), then create the first Admin account via `/signup` on the live URL.

## Verify

After `npm run dev` (or after deploy), with a fresh database + seed:

- `/` shows the restaurant name from Settings and buttons to `/order` and `/login`.
- `/login` and `/signup` render; signup creates the first Admin account.
- `/dashboard` (after login) shows the staff shell with 0 sales / empty states — no demo numbers.
- `/menu` shows the 12 seeded demo items (replace with the real menu before going live).
- `/t/T1` loads the table ordering page for Table 1.
- `/kitchen` is empty with no orders; placing an order from `/t/T1` shows its batch there.

## Troubleshooting

- **Redis missing / unset:** expected locally — the app still works; cache falls back to PostgreSQL and rate limiting to memory. Check the console only if you expected Redis to be active.
- **Order-number format:** `R-YYYYMMDD-NNNN`, daily sequence from `DailyOrderCounter`. Duplicates mean a checkout ran outside a transaction — check `lib/order-number.js` usage.
- **`instant` / cacheComponents error:** this project does not enable `cacheComponents`. Remove any `export const instant` from the reported file; pages stay dynamic via session/DB reads.
- **Prisma CLI errors after install:** you probably ran bare `prisma` (v8+). Use `npx prisma@6 ...` and keep `prisma`/`@prisma/client` on `^6`.
- **First signup is not Admin:** the promotion hook counts users — if another account already exists, only an existing admin can promote roles (Admin > Users).
- **No gateway in V1:** online payment is not wired yet. Record counter payments in Orders; gateway fields on `Payment` are reserved for later.
