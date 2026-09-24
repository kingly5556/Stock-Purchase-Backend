# AGENT.md

## Project Overview

**Name:** Inventory & Purchase Order Management System (Mini-ERP Module)
**Purpose:** Portfolio project demonstrating full-stack development skills for entry-level developer job applications. Simulates a real ERP inventory/procurement module with business-realistic workflows (multi-level approval, stock movement audit trail, partial goods receipt).

**Target audience for this project:** Technical recruiters and interviewers evaluating backend design, database modeling, and business-logic implementation skills — not just CRUD screens.

## This module lives behind the ERPHUB gateway — read `K-ERPHUB/AGENTS.md` first

This is **not** a standalone app with its own login. It is one ERP module in a **path-based, modular ERP** (see the `K-ERPHub` repo's `AGENTS.md` / `README.md`): users log in once at ERPHUB (`/erphub`), and this module is reached at `/erp/stock/...` through ERPHUB's reverse proxy, which injects `Authorization: Bearer <jwt>`. Concretely:

- **No login screens, no session store here.** This module verifies the incoming JWT (same `JWT_SECRET`, HS256) and reads `{ sub, username, roles, allowedModules }` from it — it never calls back to ERPHUB and never issues its own tokens.
- **Concrete flow:** user logs in once at ERPHUB → clicks the "Stock & Purchase Order" tile → ERPHUB's proxy forwards the request to this module's `targetUrl` with `Authorization: Bearer <jwt>` already attached — the same token from login, untouched. No second login screen exists anywhere in this module.
- **No separate deployment/auth stack of its own.** Skip Railway/Vercel-as-separate-product framing — this service just needs a `targetUrl` reachable by ERPHUB's proxy, registered in `K-ERPHub`'s `src/config/modules.json` (`{ key: "stock", name, icon, targetUrl }`) plus `allowedModules` on the relevant users.
- Portfolio framing (recruiter-facing README, ER diagrams, etc.) is still fine to keep — it just needs to describe a module that plugs into an existing gateway, not a self-contained product with its own auth.

## Repo layout (backend + frontend must be sibling folders, e.g. `K-ERP/Stock and purchase/`)

- `K-ERPHub/` — auth hub + reverse proxy (issues the JWT); separate repo, only reached over HTTP (`targetUrl`), so its location doesn't matter
- `Stock-Purchase-Backend/` — this repo
- `Stock-Purchase-Frontend/` — the SPA; its Vite dev server reads this repo's `.env` (`JWT_SECRET`) via `../Stock-Purchase-Backend/.env` (override with `BACKEND_ENV_PATH`)
## Architecture

- **Pattern:** Modular Monolith (NOT microservices — scope doesn't justify the complexity, and over-engineering this is a red flag in interviews)
- **Backend:** Separate REST API service, reachable via its `targetUrl` from ERPHUB's proxy — auth is verify-only (see above), not a login system
- **Frontend:** Separate SPA in its own repo (`Stock-Purchase-Frontend`, expected as a sibling folder — this backend serves its `dist/` build; override with `FRONTEND_DIST`), consuming the API, served under `/erp/stock/...` (linked from users' ERPHUB module menu once registered)
- **Database:** PostgreSQL (chosen for transactional integrity on stock deductions)

### Backend module boundaries (enforce strictly)

```
src/
  modules/
    auth/              # JWT verification + role guard middleware only (NOT login/issuing tokens — that's ERPHUB's job)
    product/           # product master data, reorder points
    supplier/           # supplier master data
    purchase-order/     # PO creation, approval workflow, status transitions
    goods-receipt/      # receiving against a PO, partial receipt handling
    inventory/           # stock balance, stock movement ledger, valuation
    reporting/           # dashboard aggregates, stock card, exports
  shared/
    database/
    middleware/
    utils/
```

**Rule:** A module must not query another module's tables directly. Cross-module reads/writes go through that module's service layer (e.g., `goods-receipt` calls `inventory.service` to post a stock movement — it never writes to the stock table itself). This boundary is what makes the "could become microservices later" argument credible in an interview.

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend | Node.js + Express (or NestJS if time allows) | NestJS's built-in module system enforces the boundaries above |
| Database | PostgreSQL | Use real transactions (`BEGIN`/`COMMIT`) for stock deduction to prevent race conditions |
| ORM | Prisma or TypeORM | Prisma preferred for schema clarity in the README |
| Frontend | React + TypeScript | |
| Auth | Verify-only JWT middleware (Admin / Purchasing / Warehouse Staff from `roles` claim) | Issued by ERPHUB — this module never logs users in |
| Deployment | Anywhere reachable by URL (Railway/Render, etc.) — register that URL as `targetUrl` in ERPHUB's `src/config/modules.json` | Reached by users through ERPHUB at `/erp/stock/...`, not its own public domain |

## Core Domain Model

**Master data:** `Product` (sku, name, unit, cost, reorder_point, reorder_qty), `Supplier`, `User` (role)

**Transactional data:**
- `PurchaseOrder` — status flow: `Draft → Pending Approval → Approved → Sent → Partially Received → Completed → Cancelled`
- `PurchaseOrderLine` — qty_ordered vs qty_received (tracks partial fulfillment)
- `GoodsReceipt` / `GoodsReceiptLine` — records actual receipt against a PO, can be partial and repeated
- `StockMovement` — append-only ledger of every stock change (IN / OUT / ADJUSTMENT) with balance before/after — this is the audit trail; never delete or overwrite rows here
- `StockBalance` — either a materialized running total or computed live from `StockMovement` (prefer live computation to prove correctness first, add caching only if performance requires it)

## Key Business Rules to Implement Correctly

1. **Approval threshold:** POs above a configurable amount (e.g., 50,000 THB) require Manager approval before they can move to `Sent`. Do not skip this — it's the feature that shows business-logic maturity, not just CRUD.
2. **Partial receipt:** A single PO can be received across multiple `GoodsReceipt` records. `qty_received` accumulates per line; PO only moves to `Completed` when all lines are fully received.
3. **Stock deduction concurrency:** Wrap stock balance updates in a DB transaction with row-level locking (`SELECT ... FOR UPDATE`) to prevent two simultaneous receipts/withdrawals from corrupting the balance.
4. **Reorder alerting:** When a product's stock balance drops at/below `reorder_point`, flag it (dashboard + optionally an auto-drafted PO).
5. **Audit trail:** Every stock-affecting action must write a `StockMovement` row. Never mutate stock quantity without a corresponding ledger entry.

## Coding Conventions

- TypeScript strict mode on both backend and frontend
- One service per module; controllers stay thin (validation + call service)
- All monetary values as integers (smallest currency unit) or `decimal`, never `float`
- Input validation at the API boundary (e.g., zod/class-validator)
- Every endpoint that changes state requires a valid ERPHUB-issued JWT with an appropriate role in its `roles` claim — reject anything else, but don't build a login/registration flow for it
- Write tests for the business rules above first (approval threshold, partial receipt, concurrent stock deduction) — these are the tests worth showing in the portfolio, not just "GET /products returns 200"

## What "Done" Looks Like for Portfolio Purposes

- [ ] ER diagram in README matching the schema above
- [ ] Sequence/flow diagram for the PO approval → receipt → stock update flow
- [ ] Postman collection or Swagger/OpenAPI docs for the API
- [ ] Seed script with realistic demo data (products, suppliers, a few POs in different statuses)
- [ ] Deployed, working demo link (not just source code)
- [ ] README frames each feature as a business requirement ("System must require manager approval for POs exceeding X") mapped to the code that implements it

## Out of Scope (don't build these — keep scope tight)

- Multi-warehouse / multi-location stock (mention as a "future work" item instead)
- Microservices, message queues, service mesh
- Multi-currency, multi-tenant
- Full accounting/GL integration (that's a separate module — see the accounting-module idea if this one is finished early)

## Working with an AI coding agent on this repo

- Always check which module a change belongs to before writing code; don't let logic leak across module boundaries listed above.
- When implementing a business rule from "Key Business Rules," write the failing test first, then the implementation.
- Prefer explicit status enums and state-transition guards over free-text status fields.
- Flag in the PR/commit message whenever a change touches the `StockMovement` ledger — these changes need extra scrutiny since they're the audit trail.
