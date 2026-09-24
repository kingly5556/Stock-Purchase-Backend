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

async function generatePoNumber(): Promise<string> {
  const count = await prisma.purchaseOrder.count();
  const year = new Date().getFullYear();
  return `PO-${year}-${String(count + 1).padStart(5, "0")}`;
}

export async function createPurchaseOrder(input: CreatePOInput) {
  if (input.lines.length === 0) {
    throw new AppError(400, "Purchase order must have at least one line");
  }
  const totalAmount = input.lines.reduce(
    (sum, line) => sum + line.qtyOrdered * line.unitCost,
    0
  );
  const poNumber = await generatePoNumber();

  return prisma.purchaseOrder.create({
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

  return prisma.purchaseOrder.update({
    where: { id: poId },
    data:
      nextStatus === "APPROVED"
        ? { status: nextStatus, approvedBy: null, approvedAt: null }
        : { status: nextStatus },
  });
}

export async function approvePurchaseOrder(poId: string, approvedBy: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  assertTransition(po.status, "APPROVED");

  return prisma.purchaseOrder.update({
    where: { id: poId },
    data: { status: "APPROVED", approvedBy, approvedAt: new Date() },
  });
}

export async function sendPurchaseOrder(poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  assertTransition(po.status, "SENT");
  return prisma.purchaseOrder.update({ where: { id: poId }, data: { status: "SENT" } });
}

export async function cancelPurchaseOrder(poId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
  assertTransition(po.status, "CANCELLED");
  return prisma.purchaseOrder.update({ where: { id: poId }, data: { status: "CANCELLED" } });
}
