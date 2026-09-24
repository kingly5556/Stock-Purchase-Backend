import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { prisma } from "../../shared/database/prisma.js";
import { getStockBalance, listLowStock, postStockMovement } from "./inventory.service.js";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get(
  "/balance/:productId",
  asyncHandler(async (req, res) => {
    const balance = await getStockBalance(req.params.productId);
    res.json({ productId: req.params.productId, balance });
  })
);

inventoryRouter.get(
  "/low-stock",
  asyncHandler(async (_req, res) => {
    const rows = await listLowStock();
    res.json(
      rows.map(({ product, balance }) => ({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        balance,
        reorderPoint: product.reorderPoint,
        reorderQty: product.reorderQty,
      }))
    );
  })
);

const adjustmentSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().refine((v) => v !== 0, "quantity must not be zero"),
  reason: z.string().min(1),
});

// Manual stock adjustments (e.g. cycle count corrections) — always goes
// through the same ledger as receipts/issues, never a direct balance edit.
inventoryRouter.post(
  "/adjustments",
  requireRole("Admin", "Warehouse Staff"),
  asyncHandler(async (req, res) => {
    const input = adjustmentSchema.parse(req.body);
    const movement = await prisma.$transaction((tx) =>
      postStockMovement(tx, {
        productId: input.productId,
        quantity: input.quantity,
        type: "ADJUSTMENT",
        refType: "ADJUSTMENT",
        refId: input.reason,
        createdBy: req.user!.sub,
      })
    );
    res.status(201).json(movement);
  })
);
