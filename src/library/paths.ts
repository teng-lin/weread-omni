import { homedir } from "node:os";
import { join } from "node:path";
import { LibraryError } from "./errors.js";

/**
 * Root of the local content library.
 *
 * Deliberately not `WEREAD_CONFIG_DIR`. That directory is documented as secret-bearing ("treat as
 * an SSH private key" in SECURITY.md) and its reader caps state at 1 MiB; this one holds unbounded
 * bulk content with a different backup and retention profile.
 *
 * `XDG_DATA_HOME` is honoured even though the config root ignores `XDG_CONFIG_HOME`. The asymmetry
 * is intentional: relocating bulk data onto another volume is something people actually do.
 */
export function libraryRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.WEREAD_LIBRARY_DIR?.trim();
  if (explicit) return explicit;
  const xdg = env.XDG_DATA_HOME?.trim();
  if (xdg) return join(xdg, "weread", "library");
  return join(homedir(), ".local", "share", "weread", "library");
}

export function databasePath(root: string): string {
  return join(root, "library.db");
}

export function blobsDirectory(root: string): string {
  return join(root, "blobs", "sha256");
}

export function stagingDirectory(root: string): string {
  return join(root, "tmp");
}

/**
 * Path of one blob, sharded by the first byte of its digest.
 *
 * `digest` must already have passed `checkedDigest`; this function does not re-validate, because it
 * is called on every read and the callers that accept untrusted input are the ones that validate.
 */
export function blobPath(root: string, digest: string): string {
  return join(blobsDirectory(root), digest.slice(0, 2), digest);
}

const DIGEST = /^[0-9a-f]{64}$/;

/**
 * Reject anything that is not a lowercase hex SHA-256.
 *
 * A digest becomes a path component, so this is a path-safety boundary and not merely a shape
 * check. The database carries the same rule as a CHECK constraint; both exist on purpose, because
 * the constraint cannot run before the file has already been written.
 */
export function checkedDigest(digest: string): string {
  if (!DIGEST.test(digest)) {
    throw new LibraryError("blob digest must be 64 lowercase hexadecimal characters");
  }
  return digest;
}

/**
 * Reject identifiers that cannot be stored as a key.
 *
 * `bookId` is declared free-form upstream, so it can be numeric, `CB_…` or `MP_WXS_…`. None of it
 * reaches the filesystem — identity lives in database columns — but a control character would
 * still corrupt diagnostics and comparisons.
 */
export function checkedIdentifier(value: string, label: string): string {
  if (value.length === 0) throw new LibraryError(`${label} must not be empty`);
  if (value.trim().length === 0) throw new LibraryError(`${label} must not be blank`);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the entire purpose.
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new LibraryError(`${label} must not contain control characters`);
  }
  return value;
}

/** Reject a chapter identifier that is not a non-negative safe integer. */
export function checkedChapterUid(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LibraryError("chapterUid must be a non-negative integer");
  }
  return value;
}
