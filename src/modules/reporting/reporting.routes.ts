import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { asyncHandler, AppError } from "../../shared/middleware/error-handler.js";
import { prisma } from "../../shared/database/prisma.js";

export const reportingRouter = Router();
reportingRouter.use(requireAuth);

// Stock card: full movement history + running balance for one product.
reportingRouter.get(
  "/stock-card/:productId",
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({ where: { id: req.params.productId } });
    if (!product) throw new AppError(404, "Product not found");

    const movements = await prisma.stockMovement.findMany({
      where: { productId: req.params.productId },
      orderBy: { createdAt: "asc" },
    });

    res.json({ product, movements });
  })
);
