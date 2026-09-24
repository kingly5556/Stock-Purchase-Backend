import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { receiveGoodsAgainstPO } from "./goods-receipt.service.js";

export const goodsReceiptRouter = Router();
goodsReceiptRouter.use(requireAuth);

const receiveSchema = z.object({
  poId: z.string(),
  note: z.string().optional(),
  lines: z
    .array(
      z.object({
        poLineId: z.string(),
        qtyReceived: z.number().int().positive(),
      })
    )
    .min(1),
});

goodsReceiptRouter.post(
  "/",
  requireRole("Admin", "Warehouse Staff"),
  asyncHandler(async (req, res) => {
    const input = receiveSchema.parse(req.body);
    const result = await receiveGoodsAgainstPO({ ...input, receivedBy: req.user!.sub });
    res.status(201).json(result);
  })
);
