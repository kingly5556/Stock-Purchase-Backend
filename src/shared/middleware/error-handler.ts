import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Invalid input", details: err.flatten() });
  }
  // findUniqueOrThrow() on an unknown id (e.g. POST /api/purchase-orders/<bad id>/submit)
  // is a client error, not a crash.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    return res.status(404).json({ error: "Not found" });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
}

export function asyncHandler<T extends (req: Request, res: Response) => Promise<unknown>>(
  fn: T
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}
