import { classifyHttpStatus, type DeliveryResult, type Dispatcher } from "../delivery.js";

export type AccountingConfig = { url: string; serviceKey: string };

/** Null when accounting is not configured — the Stock module then runs fine without it. */
export function accountingConfigFromEnv(env = process.env): AccountingConfig | null {
  const url = env.ACCOUNTING_URL?.trim();
  const serviceKey = env.ACCOUNTING_SERVICE_KEY?.trim();
  return url && serviceKey ? { url: url.replace(/\/+$/, ""), serviceKey } : null;
}

// Delivers one outbox row to the Accounting module's service-to-service endpoint.
// The service key travels only in a header and is never logged.
export function createAccountingDispatcher(config: AccountingConfig, fetchImpl: typeof fetch = fetch): Dispatcher {
  return async (message): Promise<DeliveryResult> => {
    try {
      const res = await fetchImpl(`${config.url}/api/postings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Service-Key": config.serviceKey },
        body: JSON.stringify({ topic: message.topic, payload: message.payload }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { kind: "ok" };
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const detail = typeof body?.error === "string" ? body.error : res.statusText;
      return classifyHttpStatus(res.status, detail);
    } catch (err) {
      // Network error, DNS failure, timeout: Accounting may simply be down.
      return { kind: "retryable", error: err instanceof Error ? err.message : "network error" };
    }
  };
}
