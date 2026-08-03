import { chmodSync, existsSync, statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { emitLog, type Logger } from "../logger.js";
import { LibraryUnsupportedError, LibraryVersionError } from "./errors.js";
import { LIBRARY_SCHEMA_VERSION, SCHEMA_STATEMENTS } from "./schema.js";

/**
 * Wait this long for a competing writer before surfacing the busy error.
 *
 * Deliberately small. `DatabaseSync` is synchronous and SQLite implements the busy timeout as a
 * sleep loop inside the C call, so the wait pins the JavaScript thread rather than yielding: a
 * five-second timeout freezes every pending timer, fetch callback and abort signal in the process
 * for five seconds. Retries belong in `withRetry`, between awaits, where the wait is real.
 */
const BUSY_TIMEOUT_MS = 100;

/**
 * Load `node:sqlite` on first use.
 *
 * Deferred because importing it emits an `ExperimentalWarning` on the whole Node 22 line, and a
 * command that never opens the library should never provoke it.
 */
async function loadSqlite(): Promise<typeof import("node:sqlite")> {
  try {
    return await import("node:sqlite");
  } catch (error) {
    throw new LibraryUnsupportedError(
      "this Node build has no node:sqlite module; the content library requires Node >= 22.13.0",
      { cause: error },
    );
  }
}

/**
 * Whether a database file was already present but carried no schema.
 *
 * That is the fingerprint of `library.db` copied without its write-ahead log: the schema and
 * `PRAGMA user_version` both live on page one, so the migration sees version zero and rebuilds an
 * empty schema. Checking afterwards cannot distinguish it from a new library -- the evidence is
 * gone by then, so it is captured here.
 */
export interface OpenedDatabase {
  database: DatabaseSync;
  schemaWasMissingFromExistingFile: boolean;
}

export interface OpenDatabaseOptions {
  path: string;
  logger?: Logger;
  /**
   * Proceed even when the filesystem cannot support write-ahead logging. Off by default: the
   * fallback is not graceful, it locks other processes out entirely.
   */
  allowUnsafe?: boolean;
}

/**
 * Open the library database, applying the schema on first use.
 *
 * Refuses rather than degrades when write-ahead logging is unavailable. `journal_mode = DELETE`
 * with `locking_mode = EXCLUSIVE` is the usual advice for a filesystem without shared memory, but
 * exclusive locking holds the lock until the connection closes: a second `weread` process then
 * fails on its own pragma sequence, before it has anything to degrade into a cache miss. Refusing
 * lets the caller run without a library, which is a real degradation.
 */
export async function openDatabase(options: OpenDatabaseOptions): Promise<OpenedDatabase> {
  const { DatabaseSync: Database } = await loadSqlite();
  const preexisting = existsSync(options.path) && statSync(options.path).size > 0;
  const database = new Database(options.path);
  try {
    database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    database.exec("PRAGMA foreign_keys = ON");

    // Converting a fresh database to write-ahead logging briefly needs an exclusive lock, so
    // several processes opening the same new library at once will collide here. Retried between
    // awaits rather than by lengthening the busy timeout, which would block the thread instead.
    const mode = await withRetry(
      () =>
        (database.prepare("PRAGMA journal_mode = WAL").get() as { journal_mode?: string } | undefined)?.journal_mode,
    );
    if (mode !== "wal") {
      if (!options.allowUnsafe) {
        throw new LibraryUnsupportedError(
          `the library location does not support write-ahead logging (journal_mode is "${mode}"), ` +
            "which usually means a network filesystem; set WEREAD_LIBRARY_ALLOW_UNSAFE=1 to proceed anyway",
        );
      }
      emitLog(options.logger, "warn", `content library opened without write-ahead logging (journal_mode is "${mode}")`);
    }

    // Durable at every commit. The cheaper NORMAL setting only fsyncs at checkpoint, so a power
    // loss can roll back to the last one -- on the order of a thousand records, whose blobs are
    // all already durable. Losing the rows that address them is the expensive half.
    database.exec("PRAGMA synchronous = FULL");

    // Retried because opening is when contention is most likely: several processes starting at
    // once all try to establish or confirm the schema, and the busy timeout is deliberately short.
    const schemaWasMissing = schemaVersion(database) === 0;
    await withRetry(() => migrate(database, options.logger));
    restrictPermissions(options.path, options.logger);
    return { database, schemaWasMissingFromExistingFile: preexisting && schemaWasMissing };
  } catch (error) {
    database.close();
    throw error;
  }
}

/**
 * Restrict the database and its sidecars to the owner.
 *
 * SQLite creates its files with the process umask, which normally leaves them group- and
 * world-readable. The library holds book text and article bodies, so it follows the
 * same 0600 rule as every other file this package writes. The write-ahead log and shared-memory
 * files carry the same data and are created separately, so all three are covered.
 */
function restrictPermissions(path: string, logger?: Logger): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      chmodSync(`${path}${suffix}`, 0o600);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // The sidecars only exist once SQLite has needed them.
      if (code !== "ENOENT") {
        emitLog(logger, "warn", `could not restrict permissions on the library database: ${code ?? "unknown error"}`);
      }
    }
  }
}

const schemaVersion = (database: DatabaseSync): number =>
  (database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)?.user_version ?? 0;

function rejectNewer(found: number): void {
  if (found > LIBRARY_SCHEMA_VERSION) {
    throw new LibraryVersionError(
      `the content library was written by a newer release (schema ${found}, this build supports ${LIBRARY_SCHEMA_VERSION})`,
      { found, supported: LIBRARY_SCHEMA_VERSION },
    );
  }
}

/** Apply the schema, or reject a database written by a newer release. */
function migrate(database: DatabaseSync, logger?: Logger): void {
  const observed = schemaVersion(database);
  rejectNewer(observed);
  if (observed === LIBRARY_SCHEMA_VERSION) return;

  // `PRAGMA user_version` is transactional, so the schema and the version it advertises commit
  // together: a crash mid-migration leaves the previous version rather than a half-built schema
  // described as complete.
  transact(database, () => {
    // Re-read now that the write lock is held. The check above ran before it, so another process
    // may have finished the whole migration in between -- two processes opening a fresh library at
    // once is the ordinary case, not a rare one, and the loser would otherwise re-run CREATE TABLE
    // against tables that already exist.
    const current = schemaVersion(database);
    rejectNewer(current);
    if (current === LIBRARY_SCHEMA_VERSION) return;

    if (current === 0) {
      for (const statement of SCHEMA_STATEMENTS) database.exec(statement);
    }
    // Later revisions add their steps here, guarded on `current`.
    database.exec(`PRAGMA user_version = ${LIBRARY_SCHEMA_VERSION}`);
    emitLog(logger, "debug", `content library schema initialised at version ${LIBRARY_SCHEMA_VERSION}`);
  });
}

/**
 * Run `work` inside an immediate transaction.
 *
 * `BEGIN IMMEDIATE`, not the default deferred mode. A deferred transaction that reads and then
 * writes can fail with `SQLITE_BUSY_SNAPSHOT` when another connection commits in between, and
 * SQLite deliberately does not invoke the busy handler for it -- waiting cannot rescue a stale read
 * snapshot. Every replace-on-newer path here reads before it writes.
 */
export function transact<T>(database: DatabaseSync, work: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  let committed = false;
  try {
    const result = work();
    database.exec("COMMIT");
    committed = true;
    return result;
  } finally {
    if (!committed) {
      // A failed COMMIT leaves the transaction open, so rolling back unconditionally is what stops
      // the next unrelated write from being swept into it.
      try {
        database.exec("ROLLBACK");
      } catch {
        // Already rolled back, or the connection is gone.
      }
    }
  }
}

const isBusy = (error: unknown): boolean =>
  /database is locked|busy/i.test((error as Error | undefined)?.message ?? "");

/**
 * Retry a synchronous database operation across event-loop turns.
 *
 * The busy timeout is kept small precisely so that contention surfaces here, where waiting yields
 * the thread instead of blocking it.
 */
export async function withRetry<T>(work: () => T, options?: { attempts?: number; delayMs?: number }): Promise<T> {
  const attempts = options?.attempts ?? 5;
  const delayMs = options?.delayMs ?? 25;
  for (let attempt = 1; ; attempt++) {
    try {
      return work();
    } catch (error) {
      if (attempt >= attempts || !isBusy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}
