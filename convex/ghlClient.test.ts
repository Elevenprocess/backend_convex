import { describe, expect, it } from "vitest";
import { extractMessage, isRetryableFetchError, isRetryableHttpStatus, safeJson } from "./ghlClient";

describe("ghlClient purs", () => {
  it("safeJson : JSON valide parsé, invalide → texte brut", () => {
    expect(safeJson('{"a":1}')).toEqual({ a: 1 });
    expect(safeJson("pas du json")).toBe("pas du json");
  });
  it("extractMessage : string directe, message/error/error_description", () => {
    expect(extractMessage("boom")).toBe("boom");
    expect(extractMessage({ message: "m" })).toBe("m");
    expect(extractMessage({ error: "e" })).toBe("e");
    expect(extractMessage({ error_description: "d" })).toBe("d");
    expect(extractMessage(42)).toBeUndefined();
  });
  it("isRetryableHttpStatus : 5xx retryable (« Command timed out » GHL), 4xx non", () => {
    expect(isRetryableHttpStatus(500)).toBe(true);
    expect(isRetryableHttpStatus(504)).toBe(true);
    expect(isRetryableHttpStatus(429)).toBe(false);
    expect(isRetryableHttpStatus(404)).toBe(false);
    expect(isRetryableHttpStatus(200)).toBe(false);
  });
  it("isRetryableFetchError : codes réseau, TimeoutError, cause imbriquée", () => {
    expect(isRetryableFetchError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(true);
    expect(isRetryableFetchError(Object.assign(new Error("x"), { cause: { code: "UND_ERR_SOCKET" } }))).toBe(true);
    expect(isRetryableFetchError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(true);
    expect(isRetryableFetchError(new Error("x"))).toBe(false);
    expect(isRetryableFetchError(null)).toBe(false);
  });
});
