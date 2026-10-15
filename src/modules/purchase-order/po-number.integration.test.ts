import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs only against a real, migrated, DISPOSABLE Postgres database:
//   INTEGRATION_DATABASE_URL=postgresql://.../k_erp_stock_test npm test
// (skipped in the normal unit-test run). It deletes all POs in that database.
const url = process.env.INTEGRATION_DATABASE_URL;

describe.skipIf(!url)("PO numbers under concurrency", () => {
  let prisma: typeof import("../../shared/database/prisma.js").prisma;
  let createPurchaseOrder: typeof import("./purchase-order.service.js").createPurchaseOrder;

  beforeAll(async () => {
    if (!/_test(\?|$)/.test(url!)) throw new Error("INTEGRATION_DATABASE_URL must point to a *_test database");
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("../../shared/database/prisma.js"));
    ({ createPurchaseOrder } = await import("./purchase-order.service.js"));
    await prisma.purchaseOrderLine.deleteMany();
    await prisma.purchaseOrder.deleteMany();
    await prisma.documentCounter.deleteMany();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("gives 20 concurrent creates 20 distinct, consecutive numbers", async () => {
    const product = await prisma.product.create({
      data: { sku: `T-${Date.now()}`, name: "test", unit: "pcs", cost: 100 },
    });
    const supplier = await prisma.supplier.create({ data: { name: "test supplier" } });

    const pos = await Promise.all(
      Array.from({ length: 20 }, () =>
        createPurchaseOrder({
          supplierId: supplier.id,
          createdBy: "test",
          lines: [{ productId: product.id, qtyOrdered: 1, unitCost: 100 }],
        })
      )
    );

    const numbers = pos.map((po) => Number(po.poNumber.split("-")[2])).sort((x, y) => x - y);
    expect(new Set(numbers).size).toBe(20);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("rejects a total that would overflow the Int column", async () => {
    const product = await prisma.product.findFirstOrThrow();
    const supplier = await prisma.supplier.findFirstOrThrow();
    await expect(
      createPurchaseOrder({
        supplierId: supplier.id,
        createdBy: "test",
        lines: [{ productId: product.id, qtyOrdered: 100_000, unitCost: 100_000 }],
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});
