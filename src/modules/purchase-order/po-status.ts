import type { PurchaseOrderStatus } from "@prisma/client";
import { AppError } from "../../shared/middleware/error-handler.js";

// Explicit allow-list of transitions — no free-text status, no implicit
// jumps. See AGENTS.md "Coding Conventions".
const ALLOWED_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "APPROVED", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "CANCELLED"],
  APPROVED: ["SENT", "CANCELLED"],
  SENT: ["PARTIALLY_RECEIVED", "COMPLETED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertTransition(
  current: PurchaseOrderStatus,
  next: PurchaseOrderStatus
): void {
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new AppError(409, `Cannot move purchase order from ${current} to ${next}`);
  }
}
