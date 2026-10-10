import type { OutboxInput } from "../../shared/outbox/outbox.service.js";

// Builds the events Accounting understands (see Accounting-Backend posting-rules.ts).
// Values are computed HERE, in bigint satang (Int x Int can exceed 32 bits), so Accounting
// never has to call back to ask Stock anything. Zero-value movements produce no event:
// there is nothing to book and Accounting rightly rejects a zero amount.

export function goodsReceivedEvent(input: {
  goodsReceiptId: string;
  poId: string;
  poNumber: string;
  occurredAt: Date;
  lines: { qtyReceived: number; unitCost: number }[];
}): OutboxInput | null {
  const amount = input.lines.reduce((sum, l) => sum + BigInt(l.qtyReceived) * BigInt(l.unitCost), 0n);
  if (amount <= 0n) return null;
  return {
    topic: "GOODS_RECEIVED",
    destination: "accounting",
    dedupeKey: `accounting:GOODS_RECEIPT:${input.goodsReceiptId}`,
    payload: {
      version: 1,
      occurredAt: input.occurredAt.toISOString(),
      goodsReceiptId: input.goodsReceiptId,
      poId: input.poId,
      poNumber: input.poNumber,
      amountSatang: amount.toString(),
    },
  };
}

export function stockAdjustedEvent(input: {
  movementId: string;
  productId: string;
  sku: string;
  quantity: number; // signed
  unitCost: number;
  reason: string;
  occurredAt: Date;
}): OutboxInput | null {
  const qty = Math.abs(input.quantity);
  const amount = BigInt(qty) * BigInt(input.unitCost);
  if (qty === 0 || amount <= 0n) return null;
  return {
    topic: "STOCK_ADJUSTED",
    destination: "accounting",
    // Keyed by the movement id, NOT the free-text reason (reasons repeat: "stock count").
    dedupeKey: `accounting:STOCK_ADJUSTMENT:${input.movementId}`,
    payload: {
      version: 1,
      occurredAt: input.occurredAt.toISOString(),
      movementId: input.movementId,
      productId: input.productId,
      sku: input.sku,
      direction: input.quantity > 0 ? "INCREASE" : "DECREASE",
      quantity: qty,
      reason: input.reason,
      amountSatang: amount.toString(),
    },
  };
}
