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
npm test                      # unit tests; integration tests are skipped
INTEGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/k_erp_stock_test npm test
```

Unit tests cover the PO state machine, the events sent to Accounting and the outbox retry rules.
Integration tests run against a real, disposable PostgreSQL database (`*_test`) and target the
places where concurrent requests could corrupt data. CI runs all of them on every push.

### Concurrency results

Measured on 21 Oct 2026 in GitHub Actions (PostgreSQL 16 service container, Node 22).
The same tests were also run on a throwaway branch with the two `SELECT … FOR UPDATE` locks removed
([`experiment/no-row-lock`](https://github.com/kingly5556/Stock-Purchase-Backend/tree/experiment/no-row-lock)),
to show what the locks prevent.

| Scenario | With the locks (main) | Without the locks |
|---|---|---|
| 50 concurrent issues of 1 unit, 30 in stock | 30 succeed, 20 refused (409), balance 0, unbroken ledger chain | **32 succeed**: 2 units oversold |
| 5 concurrent receipts of 3 against 10 ordered | 3 succeed, 2 refused (409), 9 received | **all 5 succeed**: 15 received against 10 ordered |
| 3 sends + 3 cancels on one PO at once | exactly 1 succeeds, 5 refused (409) | (not affected; uses compare-and-set) |
| 20 concurrent PO creations | numbers 1–20, no gaps or duplicates | — |

Load test ([`loadtest/adjustments.js`](loadtest/adjustments.js), k6, manual workflow
[`load-test.yml`](.github/workflows/load-test.yml); never run against the free demo):
50 virtual users posting stock adjustments to **the same product** for 30 seconds.

| Metric | Result |
|---|---|
| Requests | 10,275 (340.9 per second) |
| Failed | 0.00% |
| Latency median / p95 / max | 138.7 ms / 167.9 ms / 1,005 ms |
| Ledger after the run | 10,275 movements; sum of quantities = latest balance = 10,275; 0 duplicate `balanceBefore`; 0 rows where `balanceAfter ≠ balanceBefore + quantity` |

Environment: GitHub-hosted `ubuntu-latest` runner, API and PostgreSQL 16 on the same machine, outbox
worker off. This is the worst case for the row lock (every request waits for the same product);
requests on different products do not block each other.

## How I built this

I designed the architecture, the data model and the business rules, and wrote them down as specs
(`AGENTS.md`) before any code. I used AI coding assistants to generate much of the implementation,
then reviewed it, ran and extended the tests, and fixed what was wrong. I can walk through any part
of the code and explain why it is built that way. More in the [K-ERP overview](https://github.com/kingly5556/K-ERP#how-i-built-this).
