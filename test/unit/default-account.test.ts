import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveAccountDescriptor } from "../../src/account-store.js";
import { AccountManager } from "../../src/accounts.js";
import { AuthError } from "../../src/errors.js";
import { operationEnabled } from "../../src/operation-policy.js";
import { expectPosixMode } from "../support/posix.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryEnv(...aliases: readonly string[]): NodeJS.ProcessEnv {
  const directory = mkdtempSync(join(tmpdir(), "weread-default-"));
  directories.push(directory);
  const env: NodeJS.ProcessEnv = { WEREAD_CONFIG_DIR: directory };
  for (const alias of aliases) saveAccountDescriptor(alias, { version: 1, client: "eink" }, env);
  return env;
}

describe("write gate defaults", () => {
  const writes = [
    "import.book",
    "shelf.add",
    "shelf.delete",
    "shelf.pin",
    "shelf.setPrivate",
    "shelf.markFinished",
    "shelf.markReading",
    "publicAccounts.subscribe",
    "publicAccounts.unsubscribe",
    "notes.addBookmark",
    "notes.updateBookmark",
    "notes.removeBookmark",
    "review.add",
    "review.edit",
    "review.delete",
  ];

  it("permits every account write with nothing configured", () => {
    for (const operation of writes) expect(operationEnabled(operation, {})).toBe(true);
  });

  // Upload was opt-in only because enabling it made the MCP server demand S3 storage and refuse to
  // start without it. With that server gone, `weread import book` uploads straight to WeRead, so
  // it is an ordinary write like the rest.
  it("permits personal-book import by default", () => {
    expect(operationEnabled("import.book", {})).toBe(true);
    expect(operationEnabled("import.book", { WEREAD_READONLY: "1" })).toBe(false);
  });

  it("closes every write when an operator sets the read-only switch", () => {
    for (const value of ["1", "true", "yes", "TRUE"]) {
      for (const operation of ["shelf.add", "shelf.delete", "review.add", "notes.addBookmark", "import.book"]) {
        expect(operationEnabled(operation, { WEREAD_READONLY: value }), operation).toBe(false);
      }
    }
  });

  it("leaves writes open on an unrecognized value, because the switch only ever closes them", () => {
    // The polarity is the opposite of the removed per-class gates: a typo cannot lock a deployment
    // down by accident, and cannot silently open one either -- writes are open by default anyway.
    expect(operationEnabled("shelf.add", { WEREAD_READONLY: "ture" })).toBe(true);
  });

  it("treats unset, empty, and whitespace alike, so a blank .env line changes nothing", () => {
    for (const value of [undefined, "", "   "]) {
      expect(operationEnabled("shelf.add", value === undefined ? {} : { WEREAD_READONLY: value })).toBe(true);
    }
  });

  it("never gates a read", () => {
    for (const operation of ["search.books", "book.info", "notes.mine", "readData.detail"]) {
      expect(operationEnabled(operation, { WEREAD_READONLY: "1" })).toBe(true);
    }
  });
});

describe("default account selection", () => {
  it("resolves the only account without a recorded default", () => {
    const env = temporaryEnv("solo");
    const manager = new AccountManager({ env });
    expect(manager.defaultAccount()).toBeUndefined();
    expect(manager.select()).toEqual(["solo"]);
  });

  it("names every configured account and the remedy when the choice is ambiguous", () => {
    const manager = new AccountManager({ env: temporaryEnv("personal", "work") });
    expect(() => manager.select()).toThrow(AuthError);
    expect(() => manager.select()).toThrow(/personal, work/);
    expect(() => manager.select()).toThrow(/weread accounts use <alias>/);
  });

  it("uses the recorded default once one is set", () => {
    const env = temporaryEnv("personal", "work");
    const manager = new AccountManager({ env });
    expect(manager.setDefaultAccount("work")).toEqual({ account: "work", client: "eink" });
    expect(manager.defaultAccount()).toBe("work");
    expect(manager.select()).toEqual(["work"]);
  });

  it("keeps an explicit selection authoritative over the default", () => {
    const env = temporaryEnv("personal", "work");
    const manager = new AccountManager({ env });
    manager.setDefaultAccount("work");
    expect(manager.select(["personal"])).toEqual(["personal"]);
    expect(manager.select(["work", "personal"])).toEqual(["work", "personal"]);
  });

  it("lets WEREAD_ACCOUNT override the recorded default", () => {
    const env = temporaryEnv("personal", "work");
    new AccountManager({ env }).setDefaultAccount("work");
    expect(new AccountManager({ env: { ...env, WEREAD_ACCOUNT: "personal" } }).defaultAccount()).toBe("personal");
    expect(new AccountManager({ env: { ...env, WEREAD_ACCOUNT: "  personal  " } }).defaultAccount()).toBe("personal");
  });

  it("ignores a WEREAD_ACCOUNT that names no configured account", () => {
    const env = temporaryEnv("personal", "work");
    new AccountManager({ env }).setDefaultAccount("work");
    for (const value of ["absent", "Not A Valid Alias", ""]) {
      expect(new AccountManager({ env: { ...env, WEREAD_ACCOUNT: value } }).defaultAccount()).toBe("work");
    }
  });

  // A removed account must not wedge every later command behind an unfixable default.
  it("ignores a stale default instead of failing", () => {
    const env = temporaryEnv("personal", "work");
    const manager = new AccountManager({ env });
    manager.setDefaultAccount("work");
    rmSync(join(env.WEREAD_CONFIG_DIR as string, "accounts", "work"), { recursive: true, force: true });
    expect(manager.defaultAccount()).toBeUndefined();
    expect(manager.select()).toEqual(["personal"]);
  });

  it("refuses to default to an account that does not exist", () => {
    const manager = new AccountManager({ env: temporaryEnv("work") });
    expect(() => manager.setDefaultAccount("absent")).toThrow(AuthError);
    expect(() => manager.setDefaultAccount("Not Valid")).toThrow(/invalid account alias/);
  });

  it("clears the default and returns to demanding an explicit choice", () => {
    const env = temporaryEnv("personal", "work");
    const manager = new AccountManager({ env });
    manager.setDefaultAccount("work");
    manager.clearDefaultAccount();
    expect(manager.defaultAccount()).toBeUndefined();
    expect(() => manager.select()).toThrow(/pass --account/);
  });

  it("stores the default outside the account directories, private to the user", () => {
    const env = temporaryEnv("work");
    new AccountManager({ env }).setDefaultAccount("work");
    const config = join(env.WEREAD_CONFIG_DIR as string, "config.json");
    expectPosixMode(config, 0o600);
    // accounts() enumerates directories, so a sibling config file cannot masquerade as an account.
    expect(new AccountManager({ env }).accounts()).toEqual([{ account: "work", client: "eink" }]);
  });

  it("still reports no accounts when none are configured", () => {
    const manager = new AccountManager({ env: temporaryEnv() });
    expect(manager.defaultAccount()).toBeUndefined();
    expect(() => manager.select()).toThrow(/no WeRead accounts are configured/);
  });
});
