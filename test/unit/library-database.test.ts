import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, transact, withRetry } from "../../src/library/database.js";
import { LibraryUnsupportedError, LibraryVersionError } from "../../src/library/errors.js";
import { expectPosixMode } from "../support/posix.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryPath(): string {
  const root = mkdtempSync(join(tmpdir(), "weread-db-"));
  roots.push(root);
  return join(root, "library.db");
}

describe("openDatabase", () => {
  it("applies the schema and records its version", async () => {
    const { database } = await openDatabase({ path: temporaryPath() });
    try {
      expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
      expect(database.prepare("SELECT COUNT(*) AS n FROM chapter").get()).toEqual({ n: 0 });
    } finally {
      database.close();
    }
  });

  it("enables foreign keys and write-ahead logging", async () => {
    const { database } = await openDatabase({ path: temporaryPath() });
    try {
      expect(database.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(database.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    } finally {
      database.close();
    }
  });

  it("restricts the database file to its owner", async () => {
    // SQLite creates its files with the process umask, which normally leaves them readable by
    // everyone. The library holds book text and article bodies.
    const path = temporaryPath();
    const { database } = await openDatabase({ path });
    try {
      expectPosixMode(path, 0, 0o077);
    } finally {
      database.close();
    }
  });

  it("records that an existing file carried no schema", async () => {
    // The fingerprint of `library.db` copied without its write-ahead log. It has to be captured
    // here: the migration rebuilds an empty schema, so afterwards the evidence is gone.
    // A non-empty database file carrying no schema and version zero -- what a `library.db` copied
    // without its write-ahead log looks like, since the schema and the version share page one.
    const path = temporaryPath();
    const { DatabaseSync } = await import("node:sqlite");
    const seeded = new DatabaseSync(path);
    seeded.exec("CREATE TABLE unrelated (a TEXT)");
    seeded.exec("INSERT INTO unrelated VALUES ('padding')");
    seeded.exec("PRAGMA user_version = 0");
    seeded.close();

    const reopened = await openDatabase({ path });
    try {
      expect(reopened.schemaWasMissingFromExistingFile).toBe(true);
    } finally {
      reopened.database.close();
    }
  });

  it("does not flag a brand new library", async () => {
    const opened = await openDatabase({ path: temporaryPath() });
    try {
      expect(opened.schemaWasMissingFromExistingFile).toBe(false);
    } finally {
      opened.database.close();
    }
  });

  it("refuses a location that cannot support write-ahead logging", async () => {
    // An in-memory database is the portable stand-in for a filesystem without shared memory:
    // SQLite silently declines the mode change rather than failing, which is exactly the signal
    // the probe reads.
    await expect(openDatabase({ path: ":memory:" })).rejects.toThrow(LibraryUnsupportedError);
    await expect(openDatabase({ path: ":memory:" })).rejects.toThrow(/write-ahead logging/);
  });

  it("proceeds with a warning when the caller accepts the risk", async () => {
    const warnings: string[] = [];
    const { database } = await openDatabase({
      path: ":memory:",
      allowUnsafe: true,
      logger: { warn: (message) => warnings.push(message) },
    });
    try {
      expect(warnings.join(" ")).toContain("without write-ahead logging");
      expect(database.prepare("SELECT COUNT(*) AS n FROM chapter").get()).toEqual({ n: 0 });
    } finally {
      database.close();
    }
  });

  it("refuses a database written by a newer release", async () => {
    const path = temporaryPath();
    const { database: first } = await openDatabase({ path });
    first.exec("PRAGMA user_version = 2");
    first.close();

    await expect(openDatabase({ path })).rejects.toThrow(LibraryVersionError);
  });

  it("reports which versions are involved so the message can name a remedy", async () => {
    const path = temporaryPath();
    const { database: first } = await openDatabase({ path });
    first.exec("PRAGMA user_version = 7");
    first.close();

    await expect(openDatabase({ path })).rejects.toMatchObject({ found: 7, supported: 1 });
  });

  it("reopens an existing library without reapplying the schema", async () => {
    const path = temporaryPath();
    const { database: first } = await openDatabase({ path });
    first.prepare("INSERT INTO account (vid) VALUES (?)").run("vid-1");
    first.close();

    const { database: second } = await openDatabase({ path });
    try {
      expect(second.prepare("SELECT COUNT(*) AS n FROM account").get()).toEqual({ n: 1 });
    } finally {
      second.close();
    }
  });
});

describe("transact", () => {
  it("commits the work it completes", async () => {
    const { database } = await openDatabase({ path: temporaryPath() });
    try {
      transact(database, () => {
        database.prepare("INSERT INTO account (vid) VALUES (?)").run("vid-1");
      });
      expect(database.prepare("SELECT COUNT(*) AS n FROM account").get()).toEqual({ n: 1 });
    } finally {
      database.close();
    }
  });

  it("rolls back and leaves the connection usable when the work throws", async () => {
    // A transaction left open would sweep every later unrelated write into itself.
    const { database } = await openDatabase({ path: temporaryPath() });
    try {
      expect(() =>
        transact(database, () => {
          database.prepare("INSERT INTO account (vid) VALUES (?)").run("vid-1");
          throw new Error("upstream failed");
        }),
      ).toThrow("upstream failed");

      expect(database.prepare("SELECT COUNT(*) AS n FROM account").get()).toEqual({ n: 0 });

      transact(database, () => {
        database.prepare("INSERT INTO account (vid) VALUES (?)").run("vid-2");
      });
      expect(database.prepare("SELECT COUNT(*) AS n FROM account").get()).toEqual({ n: 1 });
    } finally {
      database.close();
    }
  });

  it("rolls back a constraint violation raised by the schema itself", async () => {
    const { database } = await openDatabase({ path: temporaryPath() });
    try {
      expect(() =>
        transact(database, () => {
          database.prepare("INSERT INTO blob (sha256, byte_length, stored_at) VALUES (?, ?, ?)").run(
            // Path-shaped, and exactly 64 characters: the length check alone would admit it.
            "a../../../../../../etc/passwd_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            10,
            "now",
          );
        }),
      ).toThrow();
      expect(database.prepare("SELECT COUNT(*) AS n FROM blob").get()).toEqual({ n: 0 });
    } finally {
      database.close();
    }
  });
});

describe("withRetry", () => {
  it("returns the first successful result without waiting", async () => {
    let calls = 0;
    const result = await withRetry(() => {
      calls += 1;
      return "done";
    });
    expect(result).toBe("done");
    expect(calls).toBe(1);
  });

  it("retries a busy database across event-loop turns", async () => {
    // The busy timeout is deliberately small so contention surfaces here, where the wait yields
    // instead of pinning the thread inside a synchronous call.
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        if (calls < 3) throw new Error("database is locked");
        return calls;
      },
      { delayMs: 1 },
    );
    expect(result).toBe(3);
  });

  it("gives up after the configured number of attempts", async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls += 1;
          throw new Error("database is locked");
        },
        { attempts: 3, delayMs: 1 },
      ),
    ).rejects.toThrow("database is locked");
    expect(calls).toBe(3);
  });

  it("does not retry a failure that waiting cannot fix", async () => {
    let calls = 0;
    await expect(
      withRetry(() => {
        calls += 1;
        throw new Error("CHECK constraint failed");
      }),
    ).rejects.toThrow("CHECK constraint failed");
    expect(calls).toBe(1);
  });
});
