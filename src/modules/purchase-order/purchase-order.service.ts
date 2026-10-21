import type { Prisma, PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/middleware/error-handler.js";
import { assertTransition } from "./po-status.js";

function getApprovalThreshold(): number {
  const raw = process.env.APPROVAL_THRESHOLD_SATANG;
  return raw ? Number(raw) : 5_000_000; // 50,000 THB default
}

export type CreatePOInput = {
  supplierId: string;
  createdBy: string;
  lines: { productId: string; qtyOrdered: number; unitCost: number }[];
};

// Prisma `Int` is 32-bit: keep totals well below 2,147,483,647 satang (~21.47M THB).
export const MAX_PO_TOTAL_SATANG = 2_000_000_000; // 20,000,000 THB

/** Year in Bangkok time (UTC+7), so a PO created at 00:30 on 1 January gets the new year. */
function bangkokYear(now: Date): number {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCFullYear();
}

// Row-locked counter: the upsert takes a row lock, so two concurrent transactions
// cannot read the same value (the old count()+1 could, and then hit the unique index).
async function generatePoNumber(tx: Prisma.TransactionClient): Promise<string> {
  const key = `PO-${bangkokYear(new Date())}`;
  const [row] = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "document_counters" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "document_counters"."value" + 1
    RETURNING "value"`;
  return `${key}-${String(row.value).padStart(5, "0")}`;
}

export async function createPurchaseOrder(input: CreatePOInput) {
  if (input.lines.length === 0) {
    throw new AppError(400, "Purchase order must have at least one line");
  }
  const totalAmount = input.lines.reduce(
    (sum, line) => sum + line.qtyOrdered * line.unitCost,
    0
  );
  if (totalAmount > MAX_PO_TOTAL_SATANG) {
    throw new AppError(400, "Purchase order total exceeds 20,000,000 THB");
  }

  return prisma.$transaction(async (tx) => {
    const poNumber = await generatePoNumber(tx);
    return tx.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: input.supplierId,
        createdBy: input.createdBy,
        totalAmount,
        status: "DRAFT",
        lines: {
          create: input.lines.map((line) => ({
            productId: line.productId,
            qtyOrdered: line.qtyOrdered,
            unitCost: line.unitCost,
          })),
        },
      },
      include: { lines: true },
    });
  });
}

// Compare-and-set: the write only applies if the PO is still in the status we checked, so two
// concurrent actions on one PO cannot both succeed (e.g. a cancel racing a goods receipt).
async function updateIfStatus(
  poId: string,
  expected: PurchaseOrderStatus,
  data: Prisma.PurchaseOrderUpdateManyMutationInput
) {
  const { count } = await prisma.purchaseOrder.updateMany({ where: { id: poId, status: expected }, data });
  if (count === 0) {
    throw new AppError(409, "Purchase order was changed by someone else; reload and try again");
  }
  return prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
}

// Submitting moves a PO out of DRAFT. Orders at/under the approval threshold
// skip the approval step and go straight to APPROVED; orders above it need
// an explicit approve() call from a Manager-capable role before they can be
// sent. See AGENTS.md "Key Business Rules" #1.
export async function submitPurchaseOrder(poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  const threshold = getApprovalThreshold();
  const nextStatus = po.totalAmount > threshold ? "PENDING_APPROVAL" : "APPROVED";
  assertTransition(po.status, nextStatus);

  return updateIfStatus(
    poId,
    po.status,
    nextStatus === "APPROVED" ? { status: nextStatus, approvedBy: null, approvedAt: null } : { status: nextStatus }
  );
}

export async function approvePurchaseOrder(poId: string, approvedBy: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  assertTransition(po.status, "APPROVED");

  return updateIfStatus(poId, po.status, { status: "APPROVED", approvedBy, approvedAt: new Date() });
}

export async function sendPurchaseOrder(poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  assertTransition(po.status, "SENT");
  return updateIfStatus(poId, po.status, { status: "SENT" });
}

export async function cancelPurchaseOrder(poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  assertTransition(po.status, "CANCELLED");
  return updateIfStatus(poId, po.status, { status: "CANCELLED" });
}
