import { describe, expect, it } from "vitest";
import { goodsReceivedEvent, stockAdjustedEvent } from "./events.js";

const occurredAt = new Date("2026-10-10T05:00:00Z");

describe("goodsReceivedEvent", () => {
  it("60 keyboards x 500 THB = 3,000,000 satang, keyed by the receipt id", () => {
    const e = goodsReceivedEvent({
      goodsReceiptId: "gr1",
      poId: "po1",
      poNumber: "PO-2026-00002",
      occurredAt,
      lines: [{ qtyReceived: 60, unitCost: 50_000 }],
    })!;
    expect(e.destination).toBe("accounting");
    expect(e.dedupeKey).toBe("accounting:GOODS_RECEIPT:gr1");
    expect(e.payload).toMatchObject({ version: 1, goodsReceiptId: "gr1", poId: "po1", amountSatang: "3000000" });
  });

  it("sums several lines", () => {
    const e = goodsReceivedEvent({
      goodsReceiptId: "gr1",
      poId: "po1",
      poNumber: "PO",
      occurredAt,
      lines: [
        { qtyReceived: 10, unitCost: 2200 },
        { qtyReceived: 40, unitCost: 500 },
      ],
    })!;
    expect((e.payload as { amountSatang: string }).amountSatang).toBe("42000");
  });

  it("does not overflow 32 bits (Int x Int)", () => {
    const e = goodsReceivedEvent({
      goodsReceiptId: "gr1",
      poId: "po1",
      poNumber: "PO",
      occurredAt,
      lines: [{ qtyReceived: 100_000, unitCost: 2_000_000_000 }],
    })!;
    expect((e.payload as { amountSatang: string }).amountSatang).toBe("200000000000000");
  });

  it("emits nothing for a zero-value receipt", () => {
    expect(
      goodsReceivedEvent({ goodsReceiptId: "g", poId: "p", poNumber: "PO", occurredAt, lines: [{ qtyReceived: 5, unitCost: 0 }] })
    ).toBeNull();
  });
});

describe("stockAdjustedEvent", () => {
  const base = { productId: "p1", sku: "WID-A", unitCost: 1500, reason: "stock count", occurredAt };

  it("negative quantity is a DECREASE valued at product cost", () => {
    const e = stockAdjustedEvent({ ...base, movementId: "m1", quantity: -4 })!;
    expect(e.payload).toMatchObject({ direction: "DECREASE", quantity: 4, amountSatang: "6000", movementId: "m1" });
  });

  it("positive quantity is an INCREASE", () => {
    const e = stockAdjustedEvent({ ...base, movementId: "m1", quantity: 3 })!;
    expect(e.payload).toMatchObject({ direction: "INCREASE", amountSatang: "4500" });
  });

  it("is keyed by movement id, so two adjustments with the same reason stay distinct", () => {
    const a = stockAdjustedEvent({ ...base, movementId: "m1", quantity: -1 })!;
    const b = stockAdjustedEvent({ ...base, movementId: "m2", quantity: -1 })!;
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
    expect(a.dedupeKey).toBe("accounting:STOCK_ADJUSTMENT:m1");
  });

  it("emits nothing when the product has no cost", () => {
    expect(stockAdjustedEvent({ ...base, unitCost: 0, movementId: "m1", quantity: -1 })).toBeNull();
  });
});
