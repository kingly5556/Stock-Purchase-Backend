// Waits until every outbox message for Accounting has been delivered.
// Used by the nightly demo reset after both services have been woken up.
//   DATABASE_URL=... WAIT_MS=240000 npm run outbox:wait
// Exits 1 if any message is FAILED or some are still PENDING when time runs out.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const deadline = Date.now() + Number(process.env.WAIT_MS ?? 180_000);
const where = { destination: "accounting" };

async function main() {
  for (;;) {
    const [pending, failed] = await Promise.all([
      prisma.outboxMessage.count({ where: { ...where, status: "PENDING" } }),
      prisma.outboxMessage.count({ where: { ...where, status: "FAILED" } }),
    ]);
    if (failed > 0) throw new Error(`${failed} outbox message(s) FAILED — check GET /api/outbox`);
    if (pending === 0) {
      console.log("Outbox drained: all accounting events delivered.");
      return;
    }
    if (Date.now() > deadline) throw new Error(`${pending} outbox message(s) still PENDING`);
    console.log(`Waiting: ${pending} pending...`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
