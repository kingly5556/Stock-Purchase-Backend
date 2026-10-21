import { PrismaClient } from "@prisma/client";

// Interactive transactions default to a 5s timeout. A goods receipt runs ~10 queries
// inside one transaction; from a far-away client (the nightly demo reset on GitHub
// Actions, US -> Neon Singapore) each round trip costs ~200ms, which blew that budget
// (P2028). Give transactions headroom; in-region the app finishes far below it.
export const prisma = new PrismaClient({
  transactionOptions: { maxWait: 10_000, timeout: 30_000 },
});
