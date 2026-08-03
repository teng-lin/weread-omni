import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { abortableDelay, requestSignal, waitUnlessAborted } from "../../src/api/signal.js";
import { TransportError } from "../../src/errors.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("requestSignal", () => {
  it("uses the timeout directly without a caller signal", () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const request = requestSignal(undefined, 17);
    expect(request.signal).toBe(timeout.signal);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(17);
    request.dispose();
  });

  it("combines caller and timeout signals through the native helper", () => {
    const caller = new AbortController();
    const combined = new AbortController();
    vi.spyOn(AbortSignal, "any").mockReturnValue(combined.signal);
    const request = requestSignal(caller.signal, 21);
    expect(request.signal).toBe(combined.signal);
    expect(AbortSignal.any).toHaveBeenCalledWith([caller.signal, expect.any(AbortSignal)]);
  });

  it("falls back to manual composition and removes listeners", () => {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
    try {
      const caller = new AbortController();
      const request = requestSignal(caller.signal, 1_000);
      expect(getEventListeners(caller.signal, "abort")).toHaveLength(1);
      caller.abort(new Error("stop"));
      expect(request.signal.aborted).toBe(true);
      request.dispose();
      expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
    } finally {
      if (descriptor) Object.defineProperty(AbortSignal, "any", descriptor);
      else Reflect.deleteProperty(AbortSignal, "any");
    }
  });
});

describe("abortableDelay", () => {
  it("runs the timer to completion when no signal is supplied", async () => {
    const started = Date.now();
    await abortableDelay(5, "delay");
    expect(Date.now() - started).toBeGreaterThanOrEqual(4);
  });

  it("resolves normally when the timer wins, and stops listening to the signal", async () => {
    const caller = new AbortController();
    await abortableDelay(1, "delay", caller.signal);
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
  });

  it("refuses an already-aborted signal instead of awaiting an abort event that cannot come", async () => {
    const caller = new AbortController();
    caller.abort();
    // An hour-long delay: only the pre-abort check can make this settle.
    await expect(abortableDelay(3_600_000, "ai.askBook", caller.signal)).rejects.toBeInstanceOf(TransportError);
    await expect(abortableDelay(3_600_000, "ai.askBook", caller.signal)).rejects.toThrow("ai.askBook: request aborted");
  });

  it("ends on a mid-delay abort and clears the pending timer", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    // Deliberately far longer than any test timeout: if the abort did not cut the wait short this
    // promise could only settle by the timer firing, which the final assertion forbids.
    const delayed = abortableDelay(3_600_000, "ai.askBook", caller.signal);
    expect(vi.getTimerCount()).toBe(1);
    caller.abort(new DOMException("stop", "AbortError"));
    await expect(delayed).rejects.toThrow("ai.askBook: request aborted");
    // A cleared timer is what stops an abandoned poll holding the event loop open.
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitUnlessAborted", () => {
  it("returns the promise untouched when there is nothing to abort on", async () => {
    const promise = Promise.resolve("value");
    expect(waitUnlessAborted(promise, "label")).toBe(promise);
    await expect(promise).resolves.toBe("value");
  });

  it("passes a rejection through unchanged while a signal is attached", async () => {
    const caller = new AbortController();
    const failure = new Error("upstream");
    await expect(waitUnlessAborted(Promise.reject(failure), "label", caller.signal)).rejects.toBe(failure);
  });

  it("refuses immediately for an already-aborted signal without abandoning the shared work", async () => {
    const caller = new AbortController();
    caller.abort();
    let settled = false;
    const shared = new Promise<string>((resolve) => setTimeout(() => resolve("minted"), 5)).then((value) => {
      settled = true;
      return value;
    });
    await expect(waitUnlessAborted(shared, "mint", caller.signal)).rejects.toBeInstanceOf(TransportError);
    // The shared work keeps running; only this waiter walked away.
    await expect(shared).resolves.toBe("minted");
    expect(settled).toBe(true);
  });

  it("stops the caller waiting without disturbing the promise other callers still hold", async () => {
    const caller = new AbortController();
    let resolveShared: (value: string) => void = () => undefined;
    const shared = new Promise<string>((resolve) => {
      resolveShared = resolve;
    });
    const waiter = waitUnlessAborted(shared, "mint", caller.signal);
    const other = waitUnlessAborted(shared, "mint", new AbortController().signal);

    caller.abort(new DOMException("gone", "AbortError"));
    await expect(waiter).rejects.toThrow("mint: request aborted");

    resolveShared("minted");
    await expect(shared).resolves.toBe("minted");
    await expect(other).resolves.toBe("minted");
  });

  it("detaches its abort listener once the promise settles", async () => {
    const caller = new AbortController();
    await waitUnlessAborted(Promise.resolve(1), "label", caller.signal);
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
  });
});
