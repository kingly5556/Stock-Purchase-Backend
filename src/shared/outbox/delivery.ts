// Pure delivery rules shared by every destination — no database, no network, easy to test.

export type DeliveryResult =
  | { kind: "ok" }
  | { kind: "retryable"; error: string } // timeout / network / 5xx: try again later
  | { kind: "permanent"; error: string }; // 4xx: sending the same payload again cannot help

export type Dispatcher = (message: {
  topic: string;
  payload: unknown;
  dedupeKey: string;
}) => Promise<DeliveryResult>;

export const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15 * 60_000;

/** Exponential backoff: 5s, 10s, 20s, ... capped at 15 minutes. `attempts` = failures so far (>= 1). */
export function backoffMs(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
}

/** Map an HTTP status to a delivery result. 2xx ok; 408/429 and 5xx retry; any other 4xx is permanent. */
export function classifyHttpStatus(status: number, detail: string): DeliveryResult {
  if (status >= 200 && status < 300) return { kind: "ok" };
  if (status === 408 || status === 429 || status >= 500) {
    return { kind: "retryable", error: `HTTP ${status}: ${detail}` };
  }
  return { kind: "permanent", error: `HTTP ${status}: ${detail}` };
}

export type RowUpdate = {
  status: "SENT" | "PENDING" | "FAILED";
  attempts: number;
  lastError: string | null;
  nextAt?: Date;
  sentAt?: Date;
};

/** What to write back to the row after one delivery attempt. */
export function nextState(currentAttempts: number, result: DeliveryResult, now: Date): RowUpdate {
  const attempts = currentAttempts + 1;
  if (result.kind === "ok") {
    return { status: "SENT", attempts, lastError: null, sentAt: now };
  }
  if (result.kind === "permanent") {
    return { status: "FAILED", attempts, lastError: result.error };
  }
  if (attempts >= MAX_ATTEMPTS) {
    return { status: "FAILED", attempts, lastError: `gave up after ${attempts} attempts: ${result.error}` };
  }
  return { status: "PENDING", attempts, lastError: result.error, nextAt: new Date(now.getTime() + backoffMs(attempts)) };
}
