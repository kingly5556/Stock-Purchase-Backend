# Stock & Purchase Order module — backend

**[Live demo](https://k-erp-hub.vercel.app)** · Part of **[K-ERP](https://github.com/kingly5556/K-ERP)** (overview, architecture, test results)

[![CI](https://github.com/kingly5556/Stock-Purchase-Backend/actions/workflows/ci.yml/badge.svg)](https://github.com/kingly5556/Stock-Purchase-Backend/actions/workflows/ci.yml)

![Purchase order partially received](https://raw.githubusercontent.com/kingly5556/K-ERP/main/docs/images/stock-po-detail.png)

REST API for inventory/stock management and purchase orders. Runs as a standalone
service behind ERPHUB's reverse proxy — see `AGENTS.md` and the `K-ERPHub` repo's
`README.md` for the gateway/auth contract. This service **never** logs users in;
it only verifies the JWT ERPHUB forwards.

## What it does

Keeps track of products and how many are in stock, and runs the buying process: create a purchase
order, get it approved when it is over 50,000 THB, send it to the supplier, and receive the goods
(in one go or in parts). Every receipt is sent to Accounting automatically and exactly once.

## Local development

```bash
cp .env.example .env
# JWT_SECRET here must match the root ERPHUB app's JWT_SECRET exactly.

docker run -d --name k-erp-stock-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=k_erp_stock \
  -p 5433:5432 postgres:16-alpine

npm install
npm run prisma:migrate   # creates tables from prisma/schema.prisma
npm run prisma:seed      # demo products/supplier/POs
npm run dev              # listens on :4001 (see PORT in .env)
```

Health check: `GET http://localhost:4001/health`. Add `?deep=1` to also check the database (`{"ok":true,"db":"ok","commit":"..."}`, or 503 when the database is down).

### Demo data

`npm run prisma:seed` creates a minimal data set for development. For the public demo use
`npm run demo:seed` on a freshly migrated database: it creates an IT-equipment shop (10 products,
3 fictitious suppliers, 6 POs covering every status, receipts and one stock adjustment) **through
the service layer**, so stock movements and outbox events are real. Once the outbox worker has
delivered the 3 events, GL account 1300 in Accounting equals the stock value: 91,050.00 THB.
`npm run outbox:wait` exits 0 when every accounting event has been delivered (used by the nightly
demo reset).

Every other route requires `Authorization: Bearer <jwt>` signed by ERPHUB
(`src/lib/auth/jwt.ts` in the root app) with `JWT_SECRET` shared between the
two services.

## Registering with ERPHUB

Once this service is running, add it to the root app's `src/config/modules.json`:

```json
{ "key": "stock", "name": "Stock & Purchase Orders", "icon": "package", "targetUrl": "http://localhost:4001" }
```

...and add `"stock"` to the relevant users' `allowedModules` in
`src/config/users.json`. After that it's reachable at `/erp/stock/...` for any
logged-in user with access, with no separate login.

## API surface

All API routes are namespaced under `/api/*` so they never collide with the
SPA's own client-side routes (the built frontend from the sibling `Stock-Purchase-Frontend/dist` is served, with
any non-`/api/*` GET falling through to `index.html` — see `src/app.ts`).

| Method | Path | Notes |
|---|---|---|
| GET/POST/PATCH | `/api/products` | SKU master data |
| GET/POST/PATCH | `/api/suppliers` | Supplier master data |
| GET | `/api/inventory/balance/:productId` | Live balance, summed from the ledger |
| GET | `/api/inventory/low-stock` | Products at/under `reorderPoint` |
| POST | `/api/inventory/adjustments` | Manual stock adjustment (ledger entry) |
| POST | `/api/purchase-orders` | Create a `DRAFT` PO |
| POST | `/api/purchase-orders/:id/submit` | `DRAFT` → `PENDING_APPROVAL` or `APPROVED` (auto, if under threshold) |
| POST | `/api/purchase-orders/:id/approve` | `PENDING_APPROVAL` → `APPROVED` (Manager/Admin) |
| POST | `/api/purchase-orders/:id/send` | `APPROVED` → `SENT` |
| POST | `/api/purchase-orders/:id/cancel` | → `CANCELLED` (not after receiving starts) |
| POST | `/api/goods-receipts` | Receive against a `SENT`/`PARTIALLY_RECEIVED` PO, full or partial |
| GET | `/api/reports/stock-card/:productId` | Full movement history for a product |

## Tests

```bash
npm test
```

Currently covers the PO status state machine (`po-status.test.ts`). `po-number.integration.test.ts` checks that 20 concurrent PO creations get 20 distinct,
consecutive numbers and that oversized totals are rejected with 400; it runs only when
`INTEGRATION_DATABASE_URL` points at a disposable `*_test` database. The
ledger's concurrency guarantee (`SELECT ... FOR UPDATE` in
`inventory.service.ts`) needs a real Postgres instance to exercise properly —
add an integration test against the Docker Postgres above before relying on
it in production.

## How I built this

I designed the architecture, the data model and the business rules, and wrote them down as specs
(`AGENTS.md`) before any code. I used AI coding assistants to generate much of the implementation,
then reviewed it, ran and extended the tests, and fixed what was wrong. I can walk through any part
of the code and explain why it is built that way. More in the [K-ERP overview](https://github.com/kingly5556/K-ERP#how-i-built-this).
