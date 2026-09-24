import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { asyncHandler, AppError } from "../../shared/middleware/error-handler.js";
import { prisma } from "../../shared/database/prisma.js";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  sendPurchaseOrder,
  submitPurchaseOrder,
} from "./purchase-order.service.js";

export const purchaseOrderRouter = Router();
purchaseOrderRouter.use(requireAuth);

purchaseOrderRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.purchaseOrder.findMany({
        include: { lines: true, supplier: true },
        orderBy: { createdAt: "desc" },
      })
    );
  })
);

purchaseOrderRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { lines: { include: { product: true } }, supplier: true, goodsReceipts: true },
    });
    if (!po) throw new AppError(404, "Purchase order not found");
    res.json(po);
  })
);

const createPOSchema = z.object({
  supplierId: z.string(),
  lines: z
    .array(
      z.object({
        productId: z.string(),
        qtyOrdered: z.number().int().positive(),
        unitCost: z.number().int().nonnegative(),
      })
    )
    .min(1),
});

purchaseOrderRouter.post(
  "/",
  requireRole("Admin", "Purchasing"),
  asyncHandler(async (req, res) => {
    const input = createPOSchema.parse(req.body);
    const po = await createPurchaseOrder({ ...input, createdBy: req.user!.sub });
    res.status(201).json(po);
  })
);

purchaseOrderRouter.post(
  "/:id/submit",
  requireRole("Admin", "Purchasing"),
  asyncHandler(async (req, res) => {
    res.json(await submitPurchaseOrder(req.params.id));
  })
);

purchaseOrderRouter.post(
  "/:id/approve",
  requireRole("Admin", "Manager"),
  asyncHandler(async (req, res) => {
    res.json(await approvePurchaseOrder(req.params.id, req.user!.sub));
  })
);

purchaseOrderRouter.post(
  "/:id/send",
  requireRole("Admin", "Purchasing"),
  asyncHandler(async (req, res) => {
    res.json(await sendPurchaseOrder(req.params.id));
  })
);

purchaseOrderRouter.post(
  "/:id/cancel",
  requireRole("Admin", "Purchasing", "Manager"),
  asyncHandler(async (req, res) => {
    res.json(await cancelPurchaseOrder(req.params.id));
  })
);
