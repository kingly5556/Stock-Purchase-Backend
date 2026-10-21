import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs only against a real, migrated, DISPOSABLE Postgres database:
//   INTEGRATION_DATABASE_URL=postgresql://.../k_erp_stock_test npm test
// (skipped in the normal unit-test run). It creates its own product and leaves it behind.
const url = process.env.INTEGRATION_DATABASE_URL;

const OPENING_STOCK = 30;
const CONCURRENT_ISSUES = 50;

describe.skipIf(!url)("stock movements under concurrency", () => {
  let prisma: typeof import("../../shared/database/prisma.js").prisma;
  let adjustStock: typeof import("./inventory.service.js").adjustStock;
  let getStockBalance: typeof import("./inventory.service.js").getStockBalance;
  let receiveGoodsAgainstPO: typeof import("../goods-receipt/goods-receipt.service.js").receiveGoodsAgainstPO;

  beforeAll(async () => {
    if (!/_test(\?|$)/.test(url!)) throw new Error("INTEGRATION_DATABASE_URL must point to a *_test database");
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("../../shared/database/prisma.js"));
    ({ adjustStock, getStockBalance } = await import("./inventory.service.js"));
    ({ receiveGoodsAgainstPO } = await import("../goods-receipt/goods-receipt.service.js"));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it(`lets exactly ${OPENING_STOCK} of ${CONCURRENT_ISSUES} concurrent issues through and never goes negative`, async () => {
    const product = await prisma.product.create({
      data: { sku: `CONC-${Date.now()}`, name: "concurrency test", unit: "pcs", cost: 100 },
    });
    await adjustStock({ productId: product.id, quantity: OPENING_STOCK, reason: "opening", createdBy: "test" });

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_ISSUES }, (_, i) =>
        adjustStock({ productId: product.id, quantity: -1, reason: `issue-${i}`, createdBy: "test" })
      )
    );

    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(OPENING_STOCK);
    expect(rejected).toHaveLength(CONCURRENT_ISSUES - OPENING_STOCK);
    for (const r of rejected) expect(r.reason).toMatchObject({ status: 409 });

    expect(await getStockBalance(product.id)).toBe(0);

    // The ledger is a single chain: every issue starts where the previous one ended.
    const issues = await prisma.stockMovement.findMany({
      where: { productId: product.id, quantity: -1 },
      orderBy: { balanceBefore: "desc" },
    });
    expect(issues.map((m) => m.balanceBefore)).toEqual(
      Array.from({ length: OPENING_STOCK }, (_, i) => OPENING_STOCK - i)
    );
    expect(new Set(issues.map((m) => m.balanceAfter)).size).toBe(OPENING_STOCK);
    expect(issues.every((m) => m.balanceAfter === m.balanceBefore - 1)).toBe(true);
  });

  it("never receives more than ordered when receipts against one PO line race", async () => {
    const product = await prisma.product.create({
      data: { sku: `CONC-GR-${Date.now()}`, name: "receipt race", unit: "pcs", cost: 100 },
    });
    const supplier = await prisma.supplier.create({ data: { name: "receipt race supplier" } });
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: `TEST-GR-${Date.now()}`,
        supplierId: supplier.id,
        status: "SENT",
        totalAmount: 1000,
        createdBy: "test",
        lines: { create: [{ productId: product.id, qtyOrdered: 10, unitCost: 100 }] },
      },
      include: { lines: true },
    });

    // 5 receipts of 3 against 10 ordered: only 3 of them fit.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        receiveGoodsAgainstPO({ poId: po.id, receivedBy: "test", lines: [{ poLineId: po.lines[0].id, qtyReceived: 3 }] })
      )
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(r.reason).toMatchObject({ status: 409 });

    const line = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: po.lines[0].id } });
    expect(line.qtyReceived).toBe(9);
    expect(await getStockBalance(product.id)).toBe(9);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PARTIALLY_RECEIVED");
  });
});
