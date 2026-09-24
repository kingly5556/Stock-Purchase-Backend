import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { asyncHandler, AppError } from "../../shared/middleware/error-handler.js";
import { prisma } from "../../shared/database/prisma.js";

export const supplierRouter = Router();
supplierRouter.use(requireAuth);

supplierRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.supplier.findMany({ orderBy: { name: "asc" } }));
  })
);

supplierRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) throw new AppError(404, "Supplier not found");
    res.json(supplier);
  })
);

const supplierInput = z.object({
  name: z.string().min(1),
  contactInfo: z.string().optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
});

supplierRouter.post(
  "/",
  requireRole("Admin", "Purchasing"),
  asyncHandler(async (req, res) => {
    const input = supplierInput.parse(req.body);
    const supplier = await prisma.supplier.create({ data: input });
    res.status(201).json(supplier);
  })
);

supplierRouter.patch(
  "/:id",
  requireRole("Admin", "Purchasing"),
  asyncHandler(async (req, res) => {
    const input = supplierInput.partial().parse(req.body);
    const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data: input });
    res.json(supplier);
  })
);
