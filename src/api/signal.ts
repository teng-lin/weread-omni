import { toTransportError } from "../errors.js";

export interface RequestSignal {
  signal: AbortSignal;
  dispose: () => void;
}

/** Combine a caller signal with a per-request timeout. */
export const requestSignal = (signal: AbortSignal | undefined, timeoutMs: number): RequestSignal => {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return { signal: timeout, dispose: () => undefined };
  if (typeof AbortSignal.any === "function") {
    return { signal: AbortSignal.any([signal, timeout]), dispose: () => undefined };
  }

  const controller = new AbortController();
  const sources = [signal, timeout];
  const abort = (event: Event) => controller.abort((event.target as AbortSignal).reason);
  for (const source of sources) {
    if (source.aborted) {
      controller.abort(source.reason);
      break;
    }
    source.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const source of sources) source.removeEventListener("abort", abort);
    },
  };
};

/**
 * A delay that ends the moment the caller aborts, instead of running to completion.
 *
 * A polling loop that only tests the signal *between* requests still leaves the caller waiting
 * out a full delay after it has disconnected — with the AI poll's 1.5s cap and 80 polls, up to
 * two minutes of it. The timer is cleared on abort so an abandoned poll does not hold the event
 * loop open either.
 */
export const abortableDelay = (milliseconds: number, label: string, signal?: AbortSignal): Promise<void> => {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, milliseconds));
  // An already-aborted signal never emits `abort`, so the listener below would wait forever.
  if (signal.aborted) return Promise.reject(toTransportError(signal.reason, label));
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      clearTimeout(timer);
      reject(toTransportError(signal.reason, label));
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

/**
 * Await `promise`, but stop waiting when `signal` aborts.
 *
 * Deliberately does NOT cancel the work: it is used where one operation is shared by several
 * callers (the single-flight token mint), and one caller giving up must not take the others'
 * result with it.
 */
export const waitUnlessAborted = <Value>(
  promise: Promise<Value>,
  label: string,
  signal?: AbortSignal,
): Promise<Value> => {
  if (!signal) return promise;
  if (signal.aborted) {
    // Keep the shared work's outcome handled: the caller walking away is not a reason to
    // report an unhandled rejection from a promise other callers are still waiting on.
    void promise.catch(() => undefined);
    return Promise.reject(toTransportError(signal.reason, label));
  }
  return new Promise<Value>((resolve, reject) => {
    const onAbort = () => reject(toTransportError(signal.reason, label));
    // Detached before settling, not in a trailing `.finally`: a caller that has already been
    // handed the result must not still be holding a listener on a long-lived signal.
    const detach = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        detach();
        resolve(value);
      },
      (error: unknown) => {
        detach();
        reject(error);
      },
    );
  });
};
