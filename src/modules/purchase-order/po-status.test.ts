import { describe, expect, it } from "vitest";
import { assertTransition } from "./po-status.js";

describe("assertTransition", () => {
  it("allows DRAFT -> PENDING_APPROVAL", () => {
    expect(() => assertTransition("DRAFT", "PENDING_APPROVAL")).not.toThrow();
  });

  it("allows DRAFT -> APPROVED (under-threshold auto-approve)", () => {
    expect(() => assertTransition("DRAFT", "APPROVED")).not.toThrow();
  });

  it("rejects skipping straight to SENT from DRAFT", () => {
    expect(() => assertTransition("DRAFT", "SENT")).toThrow();
  });

  it("rejects re-sending a COMPLETED order", () => {
    expect(() => assertTransition("COMPLETED", "SENT")).toThrow();
  });

  it("rejects cancelling a COMPLETED order", () => {
    expect(() => assertTransition("COMPLETED", "CANCELLED")).toThrow();
  });

  it("allows SENT -> PARTIALLY_RECEIVED -> COMPLETED", () => {
    expect(() => assertTransition("SENT", "PARTIALLY_RECEIVED")).not.toThrow();
    expect(() => assertTransition("PARTIALLY_RECEIVED", "COMPLETED")).not.toThrow();
  });
});
