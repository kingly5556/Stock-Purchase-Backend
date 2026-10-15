// Realistic demo data for the public demo (an IT-equipment shop).
// Unlike prisma/seed.ts it goes through the SERVICE LAYER, so it produces real stock
// movements and outbox events: once the outbox worker delivers them, Accounting books
// the same receipts and adjustment. Expected stock value afterwards: 91,050.00 THB,
// which must equal the balance of account 1300 in Accounting.
//
//   DATABASE_URL=... npm run demo:seed     (run on an empty, migrated database)
//
// Supplier names are fictitious ("ข้อมูลสมมติ"). Unit costs on the POs equal product.cost
// so the nightly reconciliation (stock value == GL 1300) matches exactly.
import { prisma } from "../src/shared/database/prisma.js";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  sendPurchaseOrder,
  submitPurchaseOrder,
} from "../src/modules/purchase-order/purchase-order.service.js";
import { receiveGoodsAgainstPO } from "../src/modules/goods-receipt/goods-receipt.service.js";
import { adjustStock } from "../src/modules/inventory/inventory.service.js";

const thb = (amount: number) => Math.round(amount * 100);

// sku, name, unit, cost (THB), reorderPoint, reorderQty
const PRODUCTS: [string, string, string, number, number, number][] = [
  ["KB-101", "คีย์บอร์ดไร้สาย", "ชิ้น", 450, 20, 50],
  ["MS-201", "เมาส์ไร้สาย", "ชิ้น", 250, 30, 80],
  ["MN-240", "จอมอนิเตอร์ 24 นิ้ว", "เครื่อง", 3900, 5, 20],
  ["SSD-1T", "SSD 1TB NVMe", "ชิ้น", 2500, 10, 30],
  ["HD-2M", "สาย HDMI 2 เมตร", "เส้น", 120, 40, 100],
  ["HS-300", "หูฟังพร้อมไมค์", "ชิ้น", 690, 10, 30],
  ["UB-C7", "ฮับ USB-C 7 in 1", "ชิ้น", 890, 8, 20],
  ["WC-1080", "เว็บแคม 1080p", "ชิ้น", 1150, 6, 15],
  ["RT-AX", "เราเตอร์ Wi-Fi 6", "เครื่อง", 2200, 4, 10],
  ["LP-STD", "ขาตั้งโน้ตบุ๊ก", "ชิ้น", 390, 10, 25],
];

const SUPPLIERS: Record<string, [string, number]> = {
  IT: ["บริษัท ไอทีซัพพลาย จำกัด (ข้อมูลสมมติ)", 5],
  DISPLAY: ["บริษัท ดิสเพลย์ เทรดดิ้ง จำกัด (ข้อมูลสมมติ)", 7],
  NET: ["บริษัท เน็ตเวิร์ค โซลูชั่น จำกัด (ข้อมูลสมมติ)", 10],
};

async function main() {
  if ((await prisma.product.count()) > 0) {
    console.log("Products already exist — demo seed skipped (run it on a freshly reset database).");
    return;
  }

  const products = new Map<string, { id: string; cost: number }>();
  for (const [sku, name, unit, cost, reorderPoint, reorderQty] of PRODUCTS) {
    products.set(
      sku,
      await prisma.product.create({ data: { sku, name, unit, cost: thb(cost), reorderPoint, reorderQty } })
    );
  }
  const suppliers: Record<string, string> = {};
  for (const [key, [name, leadTimeDays]] of Object.entries(SUPPLIERS)) {
    const supplier = await prisma.supplier.create({
      data: { name, leadTimeDays, contactInfo: "sales@example.com (ข้อมูลสมมติ)" },
    });
    suppliers[key] = supplier.id;
  }

  const product = (sku: string) => {
    const p = products.get(sku);
    if (!p) throw new Error(`unknown sku ${sku}`);
    return p;
  };
  const createPO = (supplier: string, items: [string, number][]) =>
    createPurchaseOrder({
      supplierId: suppliers[supplier],
      createdBy: "demo.purchasing",
      lines: items.map(([sku, qty]) => ({ productId: product(sku).id, qtyOrdered: qty, unitCost: product(sku).cost })),
    });
  const receive = async (poId: string, qtyBySku: Record<string, number>) => {
    const lines = await prisma.purchaseOrderLine.findMany({ where: { poId }, include: { product: true } });
    return receiveGoodsAgainstPO({
      poId,
      receivedBy: "demo.warehouse",
      lines: lines
        .filter((line) => qtyBySku[line.product.sku])
        .map((line) => ({ poLineId: line.id, qtyReceived: qtyBySku[line.product.sku] })),
    });
  };

  // A: 45,000 THB -> auto-approved -> sent -> fully received (COMPLETED)
  const a = await createPO("IT", [["KB-101", 40], ["MS-201", 60], ["HD-2M", 100]]);
  await submitPurchaseOrder(a.id);
  await sendPurchaseOrder(a.id);
  await receive(a.id, { "KB-101": 40, "MS-201": 60, "HD-2M": 100 });

  // B: 78,000 THB -> needs a manager -> approved -> sent -> 12 of 20 received (PARTIALLY_RECEIVED)
  const b = await createPO("DISPLAY", [["MN-240", 20]]);
  await submitPurchaseOrder(b.id);
  await approvePurchaseOrder(b.id, "demo.manager");
  await sendPurchaseOrder(b.id);
  await receive(b.id, { "MN-240": 12 });

  // C: 75,000 THB -> waiting for the Manager demo account (PENDING_APPROVAL)
  const c = await createPO("IT", [["SSD-1T", 30]]);
  await submitPurchaseOrder(c.id);

  // D: 19,900 THB -> auto-approved, ready to be sent (APPROVED)
  const d = await createPO("NET", [["RT-AX", 5], ["UB-C7", 10]]);
  await submitPurchaseOrder(d.id);

  // E: still a draft (DRAFT)
  await createPO("IT", [["HS-300", 20]]);

  // F: approved then cancelled (CANCELLED)
  const f = await createPO("DISPLAY", [["WC-1080", 10]]);
  await submitPurchaseOrder(f.id);
  await cancelPurchaseOrder(f.id);

  // 3 mice damaged, found at stock count -> STOCK_ADJUSTED event (Dr 5200 / Cr 1300)
  await adjustStock({
    productId: product("MS-201").id,
    quantity: -3,
    reason: "ชำรุดจากการตรวจนับ",
    createdBy: "demo.warehouse",
  });

  console.log("Demo seed done: 10 products, 3 suppliers, 6 POs. Expected stock value 91,050.00 THB.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
