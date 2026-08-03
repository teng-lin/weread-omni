import { WeReadError } from "../errors.js";

/** Base failure for the local content library. */
export class LibraryError extends WeReadError {}

/**
 * The library on disk was written by a newer release.
 *
 * Deliberately fatal rather than a miss. Every other read-path failure degrades to "refetch",
 * because the cost is one download. Silently ignoring a schema this build cannot read would
 * instead mean writing into it with the wrong shape, and the library holds content that may no
 * longer be fetchable at all.
 */
export class LibraryVersionError extends LibraryError {
  readonly found: number;
  readonly supported: number;

  constructor(message: string, info: { found: number; supported: number; cause?: unknown }) {
    super(message, { cause: info.cause });
    this.found = info.found;
    this.supported = info.supported;
  }
}

/**
 * The library root cannot host a usable store.
 *
 * Raised for a filesystem that cannot support write-ahead logging (see `openDatabase`) or that
 * rejects the primitives the blob store needs. The caller is expected to continue without a
 * library rather than fail the command.
 */
export class LibraryUnsupportedError extends LibraryError {}

/** A write failed. Unlike a read, this is surfaced rather than degraded. */
export class LibraryStoreError extends LibraryError {}
