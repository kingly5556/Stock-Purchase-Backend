import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../modules/auth/auth.middleware.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { listOutbox, retryOutboxMessage } from "./outbox.service.js";

// Operational view of integration events. FAILED rows need a person: fix the cause
// (e.g. add the missing account in Accounting), then retry here.
export const outboxRouter = Router();
outboxRouter.use(requireAuth, requireRole("Admin"));

outboxRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = z
      .object({ status: z.enum(["PENDING", "SENT", "FAILED"]).optional(), destination: z.string().optional() })
      .parse(req.query);
    res.json(await listOutbox(q));
  })
);

outboxRouter.post(
  "/:id/retry",
  asyncHandler(async (req, res) => {
    res.json(await retryOutboxMessage(req.params.id));
  })
);
