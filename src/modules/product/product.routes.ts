import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { asyncHandler, AppError } from "../../shared/middleware/error-handler.js";
import { prisma } from "../../shared/database/prisma.js";

export const productRouter = Router();
productRouter.use(requireAuth);

productRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.product.findMany({ orderBy: { sku: "asc" } }));
  })
);

productRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) throw new AppError(404, "Product not found");
    res.json(product);
  })
);

const productInput = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  unit: z.string().min(1),
  cost: z.number().int().nonnegative(),
  reorderPoint: z.number().int().nonnegative().default(0),
  reorderQty: z.number().int().nonnegative().default(0),
});

productRouter.post(
  "/",
  requireRole("Admin", "Purchasing"),
  asyncHandler(async (req, res) => {
    const input = productInput.parse(req.body);
    const product = await prisma.product.create({ data: input });
    res.status(201).json(product);
  })
);

productRouter.patch(
  "/:id",
  requireRole("Admin", "Purchasing"),
  asyncHandler(async (req, res) => {
    const input = productInput.partial().parse(req.body);
    const product = await prisma.product.update({ where: { id: req.params.id }, data: input });
    res.json(product);
  })
);
