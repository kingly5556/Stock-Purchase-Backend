import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { prisma } from "./shared/database/prisma.js";
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

// No CORS: browsers only ever talk to ERPHUB (same origin), which calls this API
// server-to-server. Leaving CORS off means no other site can call it from a browser.
app.use(express.json());

// /health          -> process is up (cheap; used by Render's health check)
// /health?deep=1   -> also runs SELECT 1, which wakes a sleeping Neon database
// `commit` shows which build is running (Render sets RENDER_GIT_COMMIT).
app.get("/health", async (req, res) => {
  const commit = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "local";
  if (req.query.deep !== "1") return res.json({ ok: true, commit });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, db: "ok", commit });
  } catch {
    return res.status(503).json({ ok: false, db: "down", commit });
  }
});

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
// Resolved to an absolute path: res.sendFile() rejects relative paths, and on Render
// FRONTEND_DIST is the relative "frontend/dist" (resolved against the working directory).
const frontendDist = path.resolve(
  process.env.FRONTEND_DIST ?? path.resolve(__dirname, "../../Stock-Purchase-Frontend/dist")
);
// Vite puts content-hashed bundles in /assets, so they can be cached for a week;
// index.html must always be revalidated so a new deploy is picked up.
app.use("/assets", express.static(path.join(frontendDist, "assets"), { maxAge: "7d", immutable: true }));
app.use(express.static(frontendDist, { maxAge: 0 }));
app.get(/^(?!\/api\/).*/, (_req, res, next) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(frontendDist, "index.html"), (err) => {
    if (err) next(err);
  });
});

app.use(errorHandler);
