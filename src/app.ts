import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { errorHandler } from "./shared/middleware/error-handler.js";
import { productRouter } from "./modules/product/product.routes.js";
import { supplierRouter } from "./modules/supplier/supplier.routes.js";
import { inventoryRouter } from "./modules/inventory/inventory.routes.js";
import { purchaseOrderRouter } from "./modules/purchase-order/purchase-order.routes.js";
import { goodsReceiptRouter } from "./modules/goods-receipt/goods-receipt.routes.js";
import { reportingRouter } from "./modules/reporting/reporting.routes.js";
import { outboxRouter } from "./shared/outbox/outbox.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// All API routes live under /api/* so they never collide with the SPA's own
// client-side routes below (e.g. the frontend's "/purchase-orders" page vs.
// this "/api/purchase-orders" resource) — a full-page refresh on a client
// route must fall through to index.html, not get swallowed by an API route.
//
// Mounted at the root here; ERPHUB's proxy is what puts this behind
// /erp/stock/... for browsers — see AGENTS.md.
app.use("/api/products", productRouter);
app.use("/api/suppliers", supplierRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/purchase-orders", purchaseOrderRouter);
app.use("/api/goods-receipts", goodsReceiptRouter);
app.use("/api/reports", reportingRouter);
app.use("/api/outbox", outboxRouter);

// Serve the built SPA from the sibling Stock-Purchase-Frontend repo (override the
// location with FRONTEND_DIST). Anything that isn't /health or
// /api/* falls through to index.html so client-side routing survives a
// full-page reload.
const frontendDist =
  process.env.FRONTEND_DIST ??
  path.resolve(__dirname, "../../Stock-Purchase-Frontend/dist");
app.use(express.static(frontendDist));
app.get(/^(?!\/api\/).*/, (_req, res, next) => {
  res.sendFile(path.join(frontendDist, "index.html"), (err) => {
    if (err) next(err);
  });
});

app.use(errorHandler);
