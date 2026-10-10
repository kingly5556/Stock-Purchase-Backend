import { prisma } from "../database/prisma.js";
import { nextState, type Dispatcher } from "./delivery.js";
import { accountingConfigFromEnv, createAccountingDispatcher } from "./dispatchers/accounting.dispatcher.js";

const BATCH_SIZE = 20;

/** destination -> dispatcher, only for destinations that are actually configured. */
export function dispatchersFromEnv(): Record<string, Dispatcher> {
  const dispatchers: Record<string, Dispatcher> = {};
  const accounting = accountingConfigFromEnv();
  if (accounting) dispatchers.accounting = createAccountingDispatcher(accounting);
  return dispatchers;
}

let running = false;

// Delivers due PENDING rows, oldest first. Rows for a destination with no dispatcher stay
// PENDING (nothing is dropped). A single in-process guard prevents overlapping runs; with
// several instances this would need FOR UPDATE SKIP LOCKED (see ACCOUNTING_PLAN.md).
// Rows are delivered one at a time, in creation order, so a destination sees events in the
// order they happened.
export async function processOutbox(
  dispatchers: Record<string, Dispatcher>,
  now: () => Date = () => new Date()
): Promise<{ delivered: number; failed: number; retrying: number }> {
  const stats = { delivered: 0, failed: 0, retrying: 0 };
  const destinations = Object.keys(dispatchers);
  if (running || destinations.length === 0) return stats;
  running = true;
  try {
    const due = await prisma.outboxMessage.findMany({
      where: { status: "PENDING", destination: { in: destinations }, nextAt: { lte: now() } },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
    });
    for (const message of due) {
      const result = await dispatchers[message.destination]({
        topic: message.topic,
        payload: message.payload,
        dedupeKey: message.dedupeKey,
      });
      const update = nextState(message.attempts, result, now());
      await prisma.outboxMessage.update({ where: { id: message.id }, data: update });
      if (update.status === "SENT") stats.delivered++;
      else if (update.status === "FAILED") {
        stats.failed++;
        // Never log the payload's secrets (there are none) or the service key (never in scope here).
        console.error(`[outbox] ${message.destination}/${message.topic} ${message.id} FAILED: ${update.lastError}`);
      } else stats.retrying++;
    }
  } finally {
    running = false;
  }
  return stats;
}

export function startOutboxWorker(intervalMs = 5_000): (() => void) | undefined {
  if (process.env.OUTBOX_WORKER === "off") return undefined;
  const dispatchers = dispatchersFromEnv();
  if (Object.keys(dispatchers).length === 0) {
    console.log("[outbox] no destinations configured (set ACCOUNTING_URL + ACCOUNTING_SERVICE_KEY) — worker idle");
    return undefined;
  }
  console.log(`[outbox] worker started: ${Object.keys(dispatchers).join(", ")} every ${intervalMs / 1000}s`);
  const timer = setInterval(() => {
    processOutbox(dispatchers).catch((err) => console.error("[outbox] worker error", err));
  }, intervalMs);
  return () => clearInterval(timer);
}
