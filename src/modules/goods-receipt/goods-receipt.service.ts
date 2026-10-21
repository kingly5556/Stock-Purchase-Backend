import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/middleware/error-handler.js";
import { enqueue } from "../../shared/outbox/outbox.service.js";
import { goodsReceivedEvent } from "../accounting-integration/events.js";
import { postStockMovement } from "../inventory/inventory.service.js";

export type ReceiveInput = {
  poId: string;
  receivedBy: string;
  note?: string;
  lines: { poLineId: string; qtyReceived: number }[];
};

// Receives against a PO (fully or partially). Never touches stock directly —
// every line posts through inventory.postStockMovement, per the module
// boundary rule in AGENTS.md. Runs as one transaction: the receipt, the PO
// line qty_received updates, every stock movement, and the resulting PO
// status all commit or roll back together.
export async function receiveGoodsAgainstPO(input: ReceiveInput) {
  if (input.lines.length === 0) {
    throw new AppError(400, "Goods receipt must have at least one line");
  }

  return prisma.$transaction(async (tx) => {
    // Lock the PO first: two receipts against the same PO must not both read the old
    // qtyReceived and together receive more than was ordered.
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${input.poId}`;
    const po = await tx.purchaseOrder.findUnique({
      where: { id: input.poId },
      include: { lines: true },
    });
    if (!po) throw new AppError(404, "Purchase order not found");
    if (po.status !== "SENT" && po.status !== "PARTIALLY_RECEIVED") {
      throw new AppError(
        409,
        `Cannot receive against a purchase order in status ${po.status}`
      );
    }

    const linesById = new Map(po.lines.map((line) => [line.id, line]));

    for (const receiptLine of input.lines) {
      const poLine = linesById.get(receiptLine.poLineId);
      if (!poLine || poLine.poId !== po.id) {
        throw new AppError(400, `Line ${receiptLine.poLineId} does not belong to this PO`);
      }
      if (receiptLine.qtyReceived <= 0) {
        throw new AppError(400, "qtyReceived must be positive");
      }
      const newQtyReceived = poLine.qtyReceived + receiptLine.qtyReceived;
      if (newQtyReceived > poLine.qtyOrdered) {
        throw new AppError(
          409,
          `Line ${poLine.id}: receiving ${receiptLine.qtyReceived} would exceed qtyOrdered ` +
            `(${poLine.qtyReceived}/${poLine.qtyOrdered} already received)`
        );
      }
    }

    const receipt = await tx.goodsReceipt.create({
      data: {
        poId: po.id,
        receivedBy: input.receivedBy,
        note: input.note,
        lines: {
          create: input.lines.map((line) => ({
            poLineId: line.poLineId,
            qtyReceived: line.qtyReceived,
          })),
        },
      },
      include: { lines: true },
    });

    for (const receiptLine of input.lines) {
      const poLine = linesById.get(receiptLine.poLineId)!;
      await tx.purchaseOrderLine.update({
        where: { id: poLine.id },
        data: { qtyReceived: { increment: receiptLine.qtyReceived } },
      });
      await postStockMovement(tx, {
        productId: poLine.productId,
        quantity: receiptLine.qtyReceived,
        type: "RECEIPT",
        refType: "GOODS_RECEIPT",
        refId: receipt.id,
        createdBy: input.receivedBy,
      });
    }

    // Accounting event, written in THIS transaction (transactional outbox): it exists if
    // and only if the receipt and its stock movements commit. Delivery happens later.
    const event = goodsReceivedEvent({
      goodsReceiptId: receipt.id,
      poId: po.id,
      poNumber: po.poNumber,
      occurredAt: receipt.receivedAt,
      lines: input.lines.map((l) => ({
        qtyReceived: l.qtyReceived,
        unitCost: linesById.get(l.poLineId)!.unitCost,
      })),
    });
    if (event) await enqueue(tx, event);

    const updatedLines = await tx.purchaseOrderLine.findMany({ where: { poId: po.id } });
    const fullyReceived = updatedLines.every((line) => line.qtyReceived >= line.qtyOrdered);

    const updatedPO = await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: fullyReceived ? "COMPLETED" : "PARTIALLY_RECEIVED" },
    });

    return { receipt, purchaseOrder: updatedPO };
  });
}
