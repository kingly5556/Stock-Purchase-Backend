// One-time cut-over for the Accounting integration.
//
// Stock movements that happened BEFORE the outbox existed never produced events, so they
// are not in the General Ledger. This books their value once, as an opening balance:
//   Dr 1300 inventory / Cr 3200 retained earnings
// valued at product.cost (the only cost known for history).
//
// "Before the outbox" is decided by COVERAGE, not by a timestamp: a movement is covered if
// an outbox event exists for its goods receipt / adjustment, and covered movements are
// excluded (they reach the ledger through their own event). Timestamps cannot be trusted
// for this — a movement is written a few milliseconds before the outbox row of the same
// transaction. Zero-value movements have no event and are valued here at product.cost.
//
// Safe to re-run: the outbox dedupeKey is fixed, so a second run is a no-op. Run it once,
// right after the migration, before relying on Accounting reports:
//   npm run accounting:cutover
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const first = await prisma.outboxMessage.findFirst({
    where: { destination: "accounting", NOT: { topic: "OPENING_BALANCE" } },
    orderBy: { createdAt: "asc" },
  });
  const cutoff = first?.createdAt ?? new Date(); // only used to date the opening entry

  const uncovered = await prisma.$queryRaw<{ productId: string; qty: bigint }[]>`
    SELECT m."productId", SUM(m."quantity")::bigint AS qty
    FROM "stock_movements" m
    WHERE NOT EXISTS (
      SELECT 1 FROM "outbox_messages" o
      WHERE o."dedupeKey" IN (
        'accounting:GOODS_RECEIPT:' || m."refId",
        'accounting:STOCK_ADJUSTMENT:' || m."id"
      )
    )
    GROUP BY m."productId"`;
  const products = await prisma.product.findMany({ where: { id: { in: uncovered.map((g) => g.productId) } } });
  const costById = new Map(products.map((p) => [p.id, p.cost]));

  let value = 0n;
  for (const g of uncovered) {
    value += g.qty * BigInt(costById.get(g.productId) ?? 0);
  }

  const asOf = new Date(cutoff.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10); // Bangkok day
  if (value <= 0n) {
    console.log(`Nothing to book: uncovered stock value is 0.`);
    return;
  }

  const result = await prisma.outboxMessage.createMany({
    data: [
      {
        topic: "OPENING_BALANCE",
        destination: "accounting",
        dedupeKey: "accounting:OPENING_BALANCE",
        payload: {
          version: 1,
          occurredAt: cutoff.toISOString(),
          asOf,
          amountSatang: value.toString(),
        },
      },
    ],
    skipDuplicates: true,
  });
  console.log(
    result.count === 1
      ? `Queued opening balance: ${value} satang as of ${asOf} (cut-off ${cutoff.toISOString()}).`
      : "Opening balance was already queued earlier — nothing changed."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
