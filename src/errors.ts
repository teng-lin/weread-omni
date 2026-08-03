/** Shared typed failures for the public request and authentication planes. */
export class WeReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    if (options && "cause" in options && options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * A response-level failure, including business errors and unusable responses.
 *
 * One class, one name. This used to be `ApiError` here with an empty
 * `class WeReadApiError extends ApiError {}` in `src/api/mobile.ts`, so the same failure had two
 * public names exported from two modules: the READMEs and the error-code table documented one, the
 * root export list offered both, and a consumer who caught the wrong one caught nothing — every
 * throw in `src/` was always the subclass.
 */
export class WeReadApiError extends WeReadError {
  readonly status: number;
  readonly path: string;
  readonly errCode?: number;
  /**
   * The request may have been applied upstream even though it failed here, so it must not be
   * retried automatically. Mirrors `ImportPhaseError.ambiguous`.
   */
  readonly ambiguous: boolean;

  constructor(
    message: string,
    info: { status: number; path: string; errCode?: number; ambiguous?: boolean; cause?: unknown },
  ) {
    super(message, { cause: info.cause });
    this.status = info.status;
    this.path = info.path;
    this.errCode = info.errCode;
    this.ambiguous = info.ambiguous ?? false;
  }
}

/** Authentication lifecycle failure. */
export class AuthError extends WeReadError {}

/** Network, cancellation, or timeout failure. */
export class TransportError extends WeReadError {
  /**
   * No response was ever read, and the request was not safe to send twice — so it may have been
   * applied upstream even though it failed here, and must not be retried automatically. Mirrors
   * `WeReadApiError.ambiguous` and `ImportPhaseError.ambiguous`.
   *
   * Deliberately narrow. A timed-out GET is a plain failure and stays `false`: a flag that is set
   * on failures the caller could already classify teaches the caller to ignore it.
   */
  readonly ambiguous: boolean;

  constructor(message: string, options?: { cause?: unknown; ambiguous?: boolean }) {
    super(message, options);
    this.ambiguous = options?.ambiguous === true;
  }
}

/**
 * Classify an arbitrary thrown value as a transport failure.
 *
 * `ambiguous` is the caller's to declare, because only the caller knows whether the request that
 * was lost was safe to repeat — the thrown value carries no evidence either way.
 */
export function toTransportError(error: unknown, label: string, options?: { ambiguous?: boolean }): TransportError {
  const ambiguous = options?.ambiguous === true;
  if (error instanceof TransportError) {
    // Re-labelling an already-classified failure would replace a precise message with a generic
    // one, so pass it through — unless it is missing the marker this caller is adding, which
    // would silently drop the one fact the caller has that the error does not.
    if (!ambiguous || error.ambiguous) return error;
    return new TransportError(error.message, { cause: error, ambiguous: true });
  }
  const name = (error as { name?: string } | null)?.name;
  const detail =
    name === "TimeoutError" ? "request timed out" : name === "AbortError" ? "request aborted" : "network error";
  return new TransportError(`${label}: ${detail}`, { cause: error, ambiguous });
}
