import type { Prisma, StockMovementType } from "@prisma/client";
import { prisma } from "../../shared/database/prisma.js";
import { AppError } from "../../shared/middleware/error-handler.js";

type TxClient = Prisma.TransactionClient;

export async function getStockBalance(productId: string, tx: TxClient | typeof prisma = prisma) {
  const result = await tx.stockMovement.aggregate({
    where: { productId },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

export type PostMovementInput = {
  productId: string;
  quantity: number; // signed: positive increases stock, negative decreases
  type: StockMovementType;
  refType: string;
  refId?: string;
  createdBy: string;
};

// The only way stock quantity is ever allowed to change. Locks the product
// row for the duration of the transaction (SELECT ... FOR UPDATE) so two
// concurrent receipts/issues against the same product can't race and
// compute the same stale balanceBefore. Always call this inside an existing
// `prisma.$transaction` when it's one step of a larger operation (e.g. a
// goods receipt), so the movement and its caller's other writes commit or
// roll back together.
export async function postStockMovement(tx: TxClient, input: PostMovementInput) {
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM products WHERE id = ${input.productId} FOR UPDATE`;
  if (locked.length === 0) {
    throw new AppError(404, `Product ${input.productId} not found`);
  }

  const balanceBefore = await getStockBalance(input.productId, tx);
  const balanceAfter = balanceBefore + input.quantity;
  if (balanceAfter < 0) {
    throw new AppError(
      409,
      `Stock movement would drive product ${input.productId} balance negative (${balanceBefore} -> ${balanceAfter})`
    );
  }

  return tx.stockMovement.create({
    data: {
      productId: input.productId,
      type: input.type,
      quantity: input.quantity,
      balanceBefore,
      balanceAfter,
      refType: input.refType,
      refId: input.refId,
      createdBy: input.createdBy,
    },
  });
}

export async function listLowStock() {
  const products = await prisma.product.findMany();
  const balances = await Promise.all(
    products.map(async (product) => ({
      product,
      balance: await getStockBalance(product.id),
    }))
  );
  return balances.filter(({ product, balance }) => balance <= product.reorderPoint);
}
