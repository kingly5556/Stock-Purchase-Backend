import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [widgetA, widgetB, boxC] = await Promise.all([
    prisma.product.create({
      data: { sku: "WID-A", name: "Widget A", unit: "pcs", cost: 1500, reorderPoint: 20, reorderQty: 100 },
    }),
    prisma.product.create({
      data: { sku: "WID-B", name: "Widget B", unit: "pcs", cost: 2200, reorderPoint: 10, reorderQty: 50 },
    }),
    prisma.product.create({
      data: { sku: "BOX-C", name: "Shipping Box C", unit: "pcs", cost: 500, reorderPoint: 50, reorderQty: 200 },
    }),
  ]);

  const supplier = await prisma.supplier.create({
    data: { name: "Acme Supply Co.", contactInfo: "sales@acme-supply.example", leadTimeDays: 7 },
  });

  // A DRAFT PO, untouched.
  await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-2026-00001",
      supplierId: supplier.id,
      status: "DRAFT",
      createdBy: "seed-user",
      totalAmount: 100 * 1500,
      lines: { create: [{ productId: widgetA.id, qtyOrdered: 100, unitCost: 1500 }] },
    },
  });

  // A SENT PO, ready to demo partial receipt against.
  const sentPO = await prisma.purchaseOrder.create({
    data: {
      poNumber: "PO-2026-00002",
      supplierId: supplier.id,
      status: "SENT",
      createdBy: "seed-user",
      approvedBy: "seed-manager",
      approvedAt: new Date(),
      totalAmount: 50 * 2200 + 200 * 500,
      lines: {
        create: [
          { productId: widgetB.id, qtyOrdered: 50, unitCost: 2200 },
          { productId: boxC.id, qtyOrdered: 200, unitCost: 500 },
        ],
      },
    },
  });

  console.log("Seeded:", { widgetA, widgetB, boxC, supplier, sentPO });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
