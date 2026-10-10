import { describe, expect, it, vi } from "vitest";
import { backoffMs, classifyHttpStatus, MAX_ATTEMPTS, nextState } from "./delivery.js";
import { accountingConfigFromEnv, createAccountingDispatcher } from "./dispatchers/accounting.dispatcher.js";

describe("classifyHttpStatus", () => {
  it("2xx is ok", () => {
    expect(classifyHttpStatus(201, "").kind).toBe("ok");
    expect(classifyHttpStatus(200, "").kind).toBe("ok");
  });
  it("5xx, 408 and 429 are retryable", () => {
    for (const s of [500, 502, 503, 408, 429]) expect(classifyHttpStatus(s, "x").kind).toBe("retryable");
  });
  it("other 4xx are permanent (never retried)", () => {
    for (const s of [400, 401, 403, 404, 409, 422]) expect(classifyHttpStatus(s, "x").kind).toBe("permanent");
  });
});

describe("backoffMs", () => {
  it("doubles from 5s and caps at 15 minutes", () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(3)).toBe(20_000);
    expect(backoffMs(20)).toBe(15 * 60_000);
  });
});

describe("nextState", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  it("ok -> SENT, clears the error", () => {
    expect(nextState(0, { kind: "ok" }, now)).toEqual({ status: "SENT", attempts: 1, lastError: null, sentAt: now });
  });
  it("permanent -> FAILED immediately on the first attempt", () => {
    const s = nextState(0, { kind: "permanent", error: "HTTP 422: no account" }, now);
    expect(s.status).toBe("FAILED");
    expect(s.attempts).toBe(1);
    expect(s.lastError).toBe("HTTP 422: no account");
  });
  it("retryable -> stays PENDING with a later nextAt", () => {
    const s = nextState(1, { kind: "retryable", error: "ECONNREFUSED" }, now);
    expect(s.status).toBe("PENDING");
    expect(s.attempts).toBe(2);
    expect(s.nextAt!.getTime()).toBe(now.getTime() + backoffMs(2));
  });
  it("retryable -> FAILED once the attempt budget is spent", () => {
    const s = nextState(MAX_ATTEMPTS - 1, { kind: "retryable", error: "HTTP 503" }, now);
    expect(s.status).toBe("FAILED");
    expect(s.lastError).toMatch(/gave up/);
  });
});

describe("accounting dispatcher", () => {
  const config = { url: "http://acct", serviceKey: "secret-key" };
  const msg = { topic: "GOODS_RECEIVED", payload: { a: 1 }, dedupeKey: "k" };

  it("posts topic + payload with the service key header only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    const result = await createAccountingDispatcher(config, fetchMock as unknown as typeof fetch)(msg);
    expect(result.kind).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://acct/api/postings");
    expect(init.headers["X-Service-Key"]).toBe("secret-key");
    expect(JSON.parse(init.body)).toEqual({ topic: "GOODS_RECEIVED", payload: { a: 1 } });
    expect(init.body).not.toContain("secret-key");
  });

  it("422 from Accounting is permanent and carries the reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Account 2150 required by posting rule does not exist" }), { status: 422 })
    );
    const result = await createAccountingDispatcher(config, fetchMock as unknown as typeof fetch)(msg);
    expect(result).toEqual({ kind: "permanent", error: "HTTP 422: Account 2150 required by posting rule does not exist" });
  });

  it("503 and network errors are retryable", async () => {
    const down = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    expect((await createAccountingDispatcher(config, down as unknown as typeof fetch)(msg)).kind).toBe("retryable");
    const refused = vi.fn().mockRejectedValue(new Error("fetch failed"));
    expect((await createAccountingDispatcher(config, refused as unknown as typeof fetch)(msg)).kind).toBe("retryable");
  });

  it("config is null unless both URL and key are set", () => {
    expect(accountingConfigFromEnv({})).toBeNull();
    expect(accountingConfigFromEnv({ ACCOUNTING_URL: "http://x" })).toBeNull();
    expect(accountingConfigFromEnv({ ACCOUNTING_URL: "http://x/", ACCOUNTING_SERVICE_KEY: "k" })).toEqual({
      url: "http://x",
      serviceKey: "k",
    });
  });
});
