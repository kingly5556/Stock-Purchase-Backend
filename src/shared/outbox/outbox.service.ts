import type { OutboxStatus, Prisma } from "@prisma/client";
import { prisma } from "../database/prisma.js";
import { AppError } from "../middleware/error-handler.js";

type TxClient = Prisma.TransactionClient;

export type OutboxInput = {
  topic: string;
  destination: string;
  dedupeKey: string;
  payload: Prisma.InputJsonValue;
};

// Always called with the SAME transaction client as the business change, so the event
// commits or rolls back together with it. skipDuplicates keeps a repeated dedupeKey
// (e.g. a re-run cut-over script) from aborting the surrounding transaction.
export async function enqueue(tx: TxClient, message: OutboxInput): Promise<void> {
  await tx.outboxMessage.createMany({ data: [message], skipDuplicates: true });
}

export function listOutbox(filter: { status?: OutboxStatus; destination?: string }) {
  return prisma.outboxMessage.findMany({
    where: { status: filter.status, destination: filter.destination },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

// A FAILED row is permanent until a person fixes the cause (e.g. the chart of accounts).
// Retrying resets it to PENDING with a fresh attempt budget.
export async function retryOutboxMessage(id: string) {
  const message = await prisma.outboxMessage.findUnique({ where: { id } });
  if (!message) throw new AppError(404, "Outbox message not found");
  if (message.status !== "FAILED") {
    throw new AppError(409, `Only FAILED messages can be retried (this one is ${message.status})`);
  }
  return prisma.outboxMessage.update({
    where: { id },
    data: { status: "PENDING", attempts: 0, nextAt: new Date(), lastError: null },
  });
}
