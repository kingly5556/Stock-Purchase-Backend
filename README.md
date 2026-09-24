# Stock & Purchase Order module — backend

REST API for inventory/stock management and purchase orders. Runs as a standalone
service behind ERPHUB's reverse proxy — see `AGENTS.md` and the `K-ERPHub` repo's
`README.md` for the gateway/auth contract. This service **never** logs users in;
it only verifies the JWT ERPHUB forwards.

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

Health check: `GET http://localhost:4001/health`.

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

Currently covers the PO status state machine (`po-status.test.ts`). The
ledger's concurrency guarantee (`SELECT ... FOR UPDATE` in
`inventory.service.ts`) needs a real Postgres instance to exercise properly —
add an integration test against the Docker Postgres above before relying on
it in production.
