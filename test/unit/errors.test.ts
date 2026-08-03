import { describe, expect, it } from "vitest";
import { AuthError, TransportError, toTransportError, WeReadApiError, WeReadError } from "../../src/errors.js";

describe("error taxonomy", () => {
  it("preserves subclass names, causes, and response fields", () => {
    const cause = new Error("inner");
    const auth = new AuthError("auth", { cause });
    expect(auth).toBeInstanceOf(WeReadError);
    expect(auth.name).toBe("AuthError");
    expect(auth.cause).toBe(cause);

    const api = new WeReadApiError("bad", { status: 409, path: "/items", errCode: -9, cause });
    expect(api).toMatchObject({ name: "WeReadApiError", status: 409, path: "/items", errCode: -9, cause });
  });

  it.each([
    [new DOMException("late", "TimeoutError"), "request timed out"],
    [new DOMException("stop", "AbortError"), "request aborted"],
    [new Error("offline"), "network error"],
  ])("normalizes transport failures", (cause, detail) => {
    const error = toTransportError(cause, "request");
    expect(error).toBeInstanceOf(TransportError);
    expect(error.message).toBe(`request: ${detail}`);
    expect(error.cause).toBe(cause);
    expect(toTransportError(error, "other")).toBe(error);
  });
});

describe("transport ambiguity", () => {
  const cause = new DOMException("late", "TimeoutError");

  it("stays unmarked unless the caller says the lost request was unsafe to repeat", () => {
    expect(new TransportError("plain").ambiguous).toBe(false);
    expect(new TransportError("plain", { cause }).ambiguous).toBe(false);
    expect(new TransportError("plain", { ambiguous: false }).ambiguous).toBe(false);
    expect(toTransportError(cause, "request").ambiguous).toBe(false);
    expect(toTransportError(cause, "request", {}).ambiguous).toBe(false);
    expect(toTransportError(cause, "request", { ambiguous: false }).ambiguous).toBe(false);
  });

  it("marks a failure the caller declares unsafe to repeat, keeping the classified message", () => {
    const error = toTransportError(cause, "mobile /review/add", { ambiguous: true });
    expect(error.ambiguous).toBe(true);
    expect(error.message).toBe("mobile /review/add: request timed out");
    expect(error.cause).toBe(cause);
  });

  it("adds the marker to an already-classified failure instead of dropping it", () => {
    // Only the caller knows whether the request was safe to repeat, so a re-wrap must be able to
    // add the fact — while keeping the more precise message the first classification produced.
    const classified = new TransportError("mobile /review/add: request timed out", { cause });
    const marked = toTransportError(classified, "outer", { ambiguous: true });
    expect(marked).not.toBe(classified);
    expect(marked.ambiguous).toBe(true);
    expect(marked.message).toBe(classified.message);
    expect(marked.cause).toBe(classified);
  });

  it("never re-wraps a failure that already carries the marker", () => {
    const marked = new TransportError("mobile /review/add: request timed out", { cause, ambiguous: true });
    expect(toTransportError(marked, "outer", { ambiguous: true })).toBe(marked);
    expect(toTransportError(marked, "outer")).toBe(marked);
  });
});

describe("public failure surface", () => {
  it("exports the import validation error so a caller can branch on its code", async () => {
    const index = (await import("../../src/index.js")) as Record<string, unknown>;
    expect(typeof index.BookValidationError).toBe("function");
    expect(index.ALLOWED_EXT).toBeInstanceOf(Set);
  });

  it("carries the ambiguous marker for an outcome that must not be retried", () => {
    const ambiguous = new WeReadApiError("unknown outcome", { status: 401, path: "/x", ambiguous: true });
    expect(ambiguous.ambiguous).toBe(true);
    expect(new WeReadApiError("plain", { status: 500, path: "/x" }).ambiguous).toBe(false);
  });
});
