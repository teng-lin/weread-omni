import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountManager } from "../../src/accounts.js";
import type { CanonicalClient } from "../../src/api/client.js";
import { PUBLIC_OPERATIONS } from "../../src/api/operations.js";
import { runAccountCli } from "../../src/cli.js";
import {
  CLIENT_PLUGIN_API_VERSION,
  type ClientOpenResult,
  type ClientPlugin,
  type JsonValue,
  loadClientPlugins,
  pluginSpecifiers,
} from "../../src/plugin.js";
import { expectPosixMode } from "../support/posix.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryEnv(): NodeJS.ProcessEnv {
  const directory = mkdtempSync(join(tmpdir(), "weread-accounts-"));
  directories.push(directory);
  // WEREAD_LIBRARY_DIR as well as the config dir: `libraryRoot` falls back to the real home
  // directory, which `homedir()` reads from the OS rather than from this object. Without it a unit
  // test creates a SQLite library under the developer's actual $HOME and never removes it.
  return { WEREAD_CONFIG_DIR: directory, WEREAD_LIBRARY_DIR: join(directory, "library") };
}

function canonical(): CanonicalClient {
  const client: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};
  for (const [resource, methods] of Object.entries(PUBLIC_OPERATIONS)) {
    client[resource] = Object.fromEntries(
      methods.map((method) => [method, vi.fn(async () => ({ operation: `${resource}.${method}` }))]),
    );
  }
  return client as unknown as CanonicalClient;
}

function sink() {
  let value = "";
  return {
    stream: { write: (chunk: string | Uint8Array) => (value += chunk.toString()) },
    read: () => value,
  };
}

function plugin(client: ClientOpenResult["client"] = canonical()): ClientPlugin {
  return {
    meta: {
      name: "test-client-plugin",
      version: "0.1.0",
      apiVersion: CLIENT_PLUGIN_API_VERSION,
    },
    clients: {
      mobile: {
        async login(context) {
          await context.onQr("https://example.test/qr", "mobile");
          context.onStatus("confirmed", "mobile");
          return {
            state: { version: 1, secret: "credential" },
            identity: { vid: "123", deviceId: "device" },
          };
        },
        async open(context) {
          await context.saveState({ version: 1, secret: "rotated" });
          return { client, identity: { vid: "123", deviceId: "device" } };
        },
      },
    },
  };
}

function mobileProvider(candidate: ClientPlugin) {
  const provider = candidate.clients.mobile;
  if (!provider) throw new Error("test plugin did not register mobile");
  return provider;
}

describe("client plugins and account storage", () => {
  it("reports the built-in provider at the package version", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };

    expect(new AccountManager().clients()).toContainEqual({
      client: "eink",
      plugin: "weread-omni",
      version: manifest.version,
      apiVersion: CLIENT_PLUGIN_API_VERSION,
    });
  });

  it("loads descriptors from semicolon-separated module specifiers", async () => {
    const directory = mkdtempSync(join(tmpdir(), "client-plugin-test-"));
    directories.push(directory);
    const modulePath = join(directory, "plugin.mjs");
    writeFileSync(
      modulePath,
      `export default {
        meta: { name: "loaded-plugin", version: "0.1.0", apiVersion: 1 },
        clients: { loaded: { async login() {}, async open() {} } }
      };`,
    );

    expect(pluginSpecifiers({ WEREAD_PLUGINS: ` ${modulePath}; ;example-plugin ` })).toEqual([
      modulePath,
      "example-plugin",
    ]);
    await expect(loadClientPlugins([modulePath])).resolves.toMatchObject([
      { meta: { name: "loaded-plugin", version: "0.1.0" }, clients: { loaded: {} } },
    ]);
  });

  it("persists one provider per account with private file modes and reopens it", async () => {
    const env = temporaryEnv();
    const onQr = vi.fn();
    const onStatus = vi.fn();
    const manager = new AccountManager({ env, plugins: [plugin()] });

    await expect(
      manager.login("work", {
        client: "mobile",
        onQr,
        onStatus,
        onOtp: vi.fn(),
      }),
    ).resolves.toEqual({ account: "work", client: "mobile", vid: "123", deviceId: "device" });
    expect(onQr).toHaveBeenCalledWith("https://example.test/qr", "mobile");
    expect(onStatus).toHaveBeenCalledWith("confirmed", "mobile");

    const root = env.WEREAD_CONFIG_DIR as string;
    const descriptor = join(root, "accounts", "work", "account.json");
    const state = join(root, "accounts", "work", "clients", "mobile.json");
    expect(JSON.parse(readFileSync(descriptor, "utf8"))).toEqual({ version: 1, client: "mobile" });
    expect(JSON.parse(readFileSync(state, "utf8"))).toEqual({ version: 1, secret: "credential" });
    expectPosixMode(descriptor, 0o600);
    expectPosixMode(state, 0o600);
    expectPosixMode(join(root, "accounts", "work"), 0o700);

    await expect(manager.open("work")).resolves.toMatchObject({
      account: "work",
      client: "mobile",
      identity: { vid: "123", deviceId: "device" },
    });
    expect(JSON.parse(readFileSync(state, "utf8"))).toEqual({ version: 1, secret: "rotated" });
  });

  it("adapts version-1 clients that predate search.suggest", async () => {
    const env = temporaryEnv();
    const legacy = canonical() as unknown as Record<string, Record<string, unknown>>;
    delete legacy.search?.suggest;
    const manager = new AccountManager({ env, plugins: [plugin(legacy as unknown as ClientOpenResult["client"])] });

    await manager.login("work", {
      client: "mobile",
      onQr: vi.fn(),
      onStatus: vi.fn(),
      onOtp: vi.fn(),
    });
    const opened = await manager.open("work");

    expect(opened.canonical.search.suggest).toEqual(expect.any(Function));
    await expect(opened.canonical.search.suggest("prefix")).rejects.toThrow(
      "client plugin does not implement search.suggest",
    );
  });

  it("keeps multiple accounts explicit and rejects absent or partial providers", async () => {
    const env = temporaryEnv();
    const callbacks = { client: "mobile", onQr: vi.fn(), onStatus: vi.fn(), onOtp: vi.fn() };
    const manager = new AccountManager({ env, plugins: [plugin()] });
    await manager.login("personal", { ...callbacks, client: "mobile" });
    await manager.login("work", { ...callbacks, client: "mobile" });

    expect(manager.accounts()).toEqual([
      { account: "personal", client: "mobile" },
      { account: "work", client: "mobile" },
    ]);
    expect(() => manager.select()).toThrow(/multiple/);
    expect(manager.select(["work", "personal"])).toEqual(["work", "personal"]);
    await expect(new AccountManager({ env }).open("work")).rejects.toThrow(/no loaded plugin/);

    const partialClient = canonical() as unknown as Record<string, Record<string, unknown>>;
    delete partialClient.book?.progress;
    const partial = plugin(partialClient as unknown as CanonicalClient);
    await expect(new AccountManager({ env, plugins: [partial] }).open("work")).rejects.toThrow(
      /progress must be callable/,
    );
  });

  it("accepts a client without chapter content and one that carries it as an extra", async () => {
    // Chapter text is outside the canonical contract: a client that omits it is valid, and a
    // client that attaches it keeps the extra method after validation rather than being rejected.
    const plain = canonical();
    expect("chapterContent" in (plain.book as object)).toBe(false);

    const chapterContent = vi.fn(async () => ({ operation: "book.chapterContent" }));
    const extended = canonical();
    Object.assign(extended.book, { chapterContent });

    for (const [alias, client] of [
      ["plain", plain],
      ["extended", extended],
    ] as const) {
      const env = temporaryEnv();
      const manager = new AccountManager({ env, plugins: [plugin(client)] });
      await manager.login(alias, { client: "mobile", onQr: vi.fn(), onStatus: vi.fn(), onOtp: vi.fn() });
      const opened = await manager.open(alias);
      expect(opened.canonical).toBe(client);
    }

    expect(typeof (extended.book as { chapterContent?: unknown }).chapterContent).toBe("function");
  });

  it("rejects malformed plugin identity and non-JSON state before it reaches account storage", async () => {
    const env = temporaryEnv();
    const callbacks = { client: "mobile", onQr: vi.fn(), onStatus: vi.fn(), onOtp: vi.fn() };
    const badState = plugin();
    mobileProvider(badState).login = async () => ({
      state: { secret: undefined } as unknown as JsonValue,
      identity: { vid: "123" },
    });
    await expect(new AccountManager({ env, plugins: [badState] }).login("bad-state", callbacks)).rejects.toThrow(
      /only JSON values/,
    );
    const sparse = Array<unknown>(2);
    sparse[1] = true;
    Object.assign(sparse, { named: true });
    mobileProvider(badState).login = async () => ({
      state: sparse as JsonValue,
      identity: { vid: "123" },
    });
    await expect(new AccountManager({ env, plugins: [badState] }).login("bad-array", callbacks)).rejects.toThrow(
      /must not be sparse/,
    );

    const badIdentity = plugin();
    mobileProvider(badIdentity).login = async () => ({
      state: { version: 1 },
      identity: { vid: " " },
    });
    await expect(new AccountManager({ env, plugins: [badIdentity] }).login("bad-id", callbacks)).rejects.toThrow(
      /invalid identity/,
    );
    expect(new AccountManager({ env }).accounts()).toEqual([]);
  });

  it("validates plugin state updates made while an account is open", async () => {
    const env = temporaryEnv();
    const unsafe = plugin();
    mobileProvider(unsafe).open = async (context) => {
      await context.saveState({ refreshedAt: Number.NaN } as unknown as JsonValue);
      return { client: canonical(), identity: { vid: "123" } };
    };
    const manager = new AccountManager({ env, plugins: [unsafe] });
    await manager.login("work", {
      client: "mobile",
      onQr: vi.fn(),
      onStatus: vi.fn(),
      onOtp: vi.fn(),
    });

    await expect(manager.open("work")).rejects.toThrow(/numbers must be finite/);
    writeFileSync(join(env.WEREAD_CONFIG_DIR as string, "accounts", "work", "clients", "mobile.json"), "1e400\n");
    await expect(manager.open("work")).rejects.toThrow(/numbers must be finite/);
  });

  it("lets the stock CLI discover, log in, and use a plugin-backed account", async () => {
    const env = temporaryEnv();
    const manager = new AccountManager({ env, plugins: [plugin()] });
    const loginOut = sink();
    const loginStatus = sink();

    await expect(
      runAccountCli(["node", "weread", "--account", "work", "login", "--client", "mobile", "--json"], {
        accountManager: manager,
        env,
        stdout: loginOut.stream,
        stderr: loginStatus.stream,
        renderQr: async (url) => `QR ${url}`,
      }),
    ).resolves.toBe(0);
    expect(JSON.parse(loginOut.read())).toMatchObject({ account: "work", client: "mobile", vid: "123" });
    expect(loginStatus.read()).toContain("mobile login:\nQR https://example.test/qr");

    const commandOut = sink();
    await expect(
      runAccountCli(["node", "weread", "book", "info", "book", "--json"], {
        accountManager: manager,
        env,
        stdout: commandOut.stream,
        stderr: sink().stream,
      }),
    ).resolves.toBe(0);
    expect(JSON.parse(commandOut.read())).toEqual({ operation: "book.info" });
  });
});
