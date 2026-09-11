import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureClientSession } from "../../src/api/mobile-client.js";
import { ImportPhaseError as InternalImportPhaseError } from "../../src/api/resources/import.js";
import * as publicApi from "../../src/index.js";
import {
  AuthError,
  type Credentials,
  createEinkClient,
  ImportPhaseError,
  isAmbiguousImportOutcome,
  loadCredentials,
  MobileApiClient,
  MobileClient,
  PUBLIC_OPERATIONS,
  saveCredentials,
  storePath,
  WeReadClient,
} from "../../src/index.js";
import type { ClientProfile } from "../../src/profile.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const temporaryEnv = (): NodeJS.ProcessEnv => {
  const directory = mkdtempSync(join(tmpdir(), "weread-public-client-"));
  directories.push(directory);
  return { WEREAD_CONFIG_DIR: directory };
};

const credentials = {
  vid: "123",
  refreshToken: "refresh-secret",
  deviceId: "eink33000000000000000000000000",
};

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function qrResponse(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  promoted: Credentials,
): Response | undefined {
  const url = new URL(String(input));
  if (url.pathname === "/wxticket") return Response.json({ signature: "signature", timeStamp: 1 });
  if (url.hostname === "open.weixin.qq.com") return Response.json({ errcode: 0, uuid: "uuid" });
  if (url.hostname === "long.open.weixin.qq.com") return Response.json({ wx_errcode: 405, wx_code: "code" });
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
  if (url.pathname === "/login" && body && "code" in body) return Response.json(promoted);
  return undefined;
}

const customProfile: ClientProfile = {
  versionHeaders: {
    "User-Agent": "PrivateProfile/1.0",
    "X-Client-Profile": "custom",
  },
  deviceName: "CUSTOM",
  deviceType: 91,
  authHeaders: ({ vid, accessToken }) => ({
    vid,
    "X-Profile-Token": accessToken,
  }),
  refreshSignature: () => "custom-signature",
  loginBodyExtras: () => ({ installShape: "custom" }),
  newDeviceId: () => "custom-device",
  newInstallId: () => "custom-install",
};

describe("MobileApiClient public boundary", () => {
  it("exposes exactly the registered namespaces and methods without enumerable credentials", () => {
    const client = new MobileApiClient({ credentials, env: {} });

    expect(Object.keys(client).sort()).toEqual(Object.keys(PUBLIC_OPERATIONS).sort());
    expect(JSON.stringify(client)).not.toContain(credentials.refreshToken);

    const namespaces = client as unknown as Record<string, Record<string, unknown>>;
    for (const [namespace, methods] of Object.entries(PUBLIC_OPERATIONS)) {
      expect(Object.keys(namespaces[namespace] ?? {}).sort()).toEqual([...methods].sort());
      for (const method of methods) {
        expect(namespaces[namespace]?.[method]).toBeTypeOf("function");
      }
    }
  });

  it("keeps the internal capture seam off the root export and supports structural clients", () => {
    const structural = {
      mobile: { call: vi.fn() },
      ai: { askBook: vi.fn(), suggest: vi.fn() },
      import: { book: vi.fn() },
    };

    const captured = captureClientSession(structural as unknown as MobileApiClient);

    expect(captured.mobile).toBe(structural.mobile);
    expect(captured.resources.ai).toBe(structural.ai);
    expect(captured.resources.import).toBe(structural.import);
    expect("captureClientSession" in publicApi).toBe(false);
  });

  it("pins every AI poll to the client captured when askBook starts", async () => {
    const pollStarted = deferred();
    const releasePoll = deferred();
    const accessTokens: string[] = [];
    const promoted = { ...credentials, accessToken: "promoted-access", refreshToken: "promoted-refresh" };
    let polls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const login = qrResponse(input, init, promoted);
      if (login) return login;
      const url = new URL(String(input));
      if (url.pathname !== "/ai/chatv2") throw new Error(`unexpected request: ${url}`);
      accessTokens.push(new Headers(init?.headers).get("accessToken") ?? "");
      polls += 1;
      return polls === 1
        ? Response.json({
            chatid: "chat",
            session_id: "session",
            request_interval: 0,
            result: { text: "partial", has_more: 1 },
          })
        : Response.json({ result: { text: "answer", has_more: 0 } });
    });
    const client = new MobileApiClient({
      credentials: { ...credentials, accessToken: "old-access" },
      env: {},
      fetchImpl,
      resources: {
        sleep: async () => {
          pollStarted.resolve();
          await releasePoll.promise;
        },
      },
    });

    const answer = client.ai.askBook({ bookId: "book", query: "question" });
    await pollStarted.promise;
    await client.login({ onQr: vi.fn() });
    releasePoll.resolve();

    await expect(answer).resolves.toEqual(expect.objectContaining({ text: "answer", complete: true }));
    expect(accessTokens).toEqual(["old-access", "old-access"]);
  });

  it("pins import credentials and notification to the client captured before upload", async () => {
    const uploadStarted = deferred();
    const releaseUpload = deferred();
    const accessTokens: string[] = [];
    const promoted = { ...credentials, accessToken: "promoted-access", refreshToken: "promoted-refresh" };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const login = qrResponse(input, init, promoted);
      if (login) return login;
      const url = new URL(String(input));
      accessTokens.push(new Headers(init?.headers).get("accessToken") ?? "");
      if (url.pathname === "/cos/getcredential") {
        return Response.json({
          bucket: "bucket",
          ObjectName: "/object",
          Response: {
            Credentials: { TmpSecretId: "id", TmpSecretKey: "key", Token: "token" },
            ExpiredTime: 123,
          },
        });
      }
      if (url.pathname === "/cos/notify") return Response.json({ status: 1, bookId: "imported" });
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new MobileApiClient({
      credentials: { ...credentials, accessToken: "old-access" },
      env: {},
      fetchImpl,
      resources: {
        cosUpload: async () => {
          uploadStarted.resolve();
          await releaseUpload.promise;
        },
      },
    });

    const imported = client.import.book({ name: "book.txt", bytes: Uint8Array.of(1) });
    await uploadStarted.promise;
    await client.login({ onQr: vi.fn() });
    releaseUpload.resolve();

    await expect(imported).resolves.toEqual({
      bookId: "imported",
      deepLink: "https://weread.qq.com/web/reader/imported",
    });
    expect(accessTokens).toEqual(["old-access", "old-access"]);
  });

  it("drops an old pinned session's rotation after credentials are reloaded", async () => {
    const env = temporaryEnv();
    const pollStarted = deferred();
    const releasePoll = deferred();
    const accessTokens: string[] = [];
    const oldCredentials = { ...credentials, accessToken: "old-access" };
    const reloadedCredentials = {
      ...credentials,
      accessToken: "reloaded-access",
      refreshToken: "reloaded-refresh",
    };
    saveCredentials(oldCredentials, { env, store: "eink" });
    let polls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/login") {
        return Response.json({
          ...oldCredentials,
          accessToken: "old-rotated-access",
          refreshToken: "old-rotated-refresh",
        });
      }
      if (url.pathname !== "/ai/chatv2") throw new Error(`unexpected request: ${url}`);
      accessTokens.push(new Headers(init?.headers).get("accessToken") ?? "");
      polls += 1;
      if (polls === 1) {
        return Response.json({
          chatid: "chat",
          session_id: "session",
          request_interval: 0,
          result: { text: "partial", has_more: 1 },
        });
      }
      if (polls === 2) return Response.json({ errCode: -2012 });
      return Response.json({ result: { text: "answer", has_more: 0 } });
    });
    const client = new MobileApiClient({
      env,
      fetchImpl,
      resources: {
        sleep: async () => {
          pollStarted.resolve();
          await releasePoll.promise;
        },
      },
    });

    const answer = client.ai.askBook({ bookId: "book", query: "question" });
    await pollStarted.promise;
    saveCredentials(reloadedCredentials, { env, store: "eink" });
    client.reloadCredentials();
    releasePoll.resolve();

    await expect(answer).resolves.toEqual(expect.objectContaining({ text: "answer", complete: true }));
    expect(accessTokens).toEqual(["old-access", "old-access", "old-rotated-access"]);
    expect(loadCredentials({ env, store: "eink" })).toEqual(reloadedCredentials);
  });

  it.each([
    ["ai.askBook", (client: MobileApiClient) => client.ai.askBook({ bookId: "book", query: "question" })],
    ["import.book", (client: MobileApiClient) => client.import.book({ name: "book.txt", bytes: Uint8Array.of(1) })],
  ])("keeps %s credential-loading failures asynchronous", async (_operation, invoke) => {
    const client = new MobileApiClient({ env: temporaryEnv() });
    let pending: Promise<unknown> | undefined;
    let synchronousError: unknown;
    try {
      pending = invoke(client);
    } catch (error) {
      synchronousError = error;
    }

    expect(synchronousError).toBeUndefined();
    if (!pending) throw new Error("operation did not return a promise");
    await expect(pending).rejects.toBeInstanceOf(AuthError);
  });

  it.each([
    [
      "ai.askBook",
      (client: MobileApiClient) => client.ai.askBook({ bookId: "book", query: "question", maxPolls: 0 }),
      "maxPolls",
    ],
    [
      "import.book",
      (client: MobileApiClient) => client.import.book({ name: "book.exe", bytes: Uint8Array.of(1) }),
      'unsupported format ".exe"',
    ],
  ])("validates %s input before loading credentials", async (_operation, invoke, message) => {
    await expect(invoke(new MobileApiClient({ env: temporaryEnv() }))).rejects.toThrow(message);
  });

  it("lets an executing old-session write finish before promoted credentials win", async () => {
    const oldWriteStarted = deferred();
    const releaseOldWrite = deferred();
    const promoted = { ...credentials, accessToken: "promoted-access", refreshToken: "promoted-refresh" };
    const completedWrites: string[] = [];
    let stored = "";
    const onCredentials = vi.fn(async (next: Credentials) => {
      if (next.refreshToken === "old-rotated") {
        oldWriteStarted.resolve();
        await releaseOldWrite.promise;
      }
      stored = next.refreshToken;
      completedWrites.push(next.refreshToken);
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const login = qrResponse(input, init, promoted);
      if (login) return login;
      const url = new URL(String(input));
      if (url.pathname === "/login") {
        return Response.json({ vid: "123", accessToken: "old-access", refreshToken: "old-rotated" });
      }
      if (url.pathname === "/book/info") return Response.json({ bookId: "book" });
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new MobileApiClient({ credentials, env: {}, fetchImpl, onCredentials });

    const oldRequest = client.book.info("book");
    await oldWriteStarted.promise;
    const login = client.login({ onQr: vi.fn() });
    await new Promise<void>(setImmediate);
    releaseOldWrite.resolve();

    await expect(oldRequest).resolves.toEqual({ bookId: "book" });
    await expect(login).resolves.toEqual(promoted);
    expect(completedWrites).toEqual(["old-rotated", "promoted-refresh"]);
    expect(stored).toBe("promoted-refresh");
  });

  it("drops a late old-session rotation after successful promotion", async () => {
    const promotionStarted = deferred();
    const releasePromotion = deferred();
    const rotationStarted = deferred();
    const promoted = { ...credentials, accessToken: "promoted-access", refreshToken: "promoted-refresh" };
    const persisted: string[] = [];
    const onCredentials = vi.fn(async (next: Credentials) => {
      persisted.push(next.refreshToken);
      if (next.refreshToken === promoted.refreshToken) {
        promotionStarted.resolve();
        await releasePromotion.promise;
      }
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const login = qrResponse(input, init, promoted);
      if (login) return login;
      const url = new URL(String(input));
      if (url.pathname === "/login") {
        rotationStarted.resolve();
        return Response.json({ vid: "123", accessToken: "old-access", refreshToken: "old-rotated" });
      }
      if (url.pathname === "/book/info") return Response.json({ bookId: "book" });
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new MobileApiClient({ credentials, env: {}, fetchImpl, onCredentials });
    void client.mobile;

    const login = client.login({ onQr: vi.fn() });
    await promotionStarted.promise;
    const oldRequest = client.book.info("book");
    await rotationStarted.promise;
    await new Promise<void>(setImmediate);

    expect(persisted).toEqual(["promoted-refresh"]);
    releasePromotion.resolve();
    await expect(login).resolves.toEqual(promoted);
    await expect(oldRequest).resolves.toEqual({ bookId: "book" });
    expect(persisted).toEqual(["promoted-refresh"]);
    expect(onCredentials).toHaveBeenCalledOnce();
  });

  it("keeps the old session unfenced when promotion persistence fails", async () => {
    const promoted = { ...credentials, accessToken: "promoted-access", refreshToken: "promoted-refresh" };
    const attempts: string[] = [];
    let stored = "";
    const onCredentials = vi.fn(async (next: Credentials) => {
      attempts.push(next.refreshToken);
      if (next.refreshToken === promoted.refreshToken) throw new Error("promotion write failed");
      stored = next.refreshToken;
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const login = qrResponse(input, init, promoted);
      if (login) return login;
      const url = new URL(String(input));
      if (url.pathname === "/login") {
        return Response.json({ vid: "123", accessToken: "old-access", refreshToken: "old-rotated" });
      }
      if (url.pathname === "/book/info") return Response.json({ bookId: "book" });
      throw new Error(`unexpected request: ${url}`);
    });
    const client = new MobileApiClient({ credentials, env: {}, fetchImpl, onCredentials });
    void client.mobile;

    await expect(client.login({ onQr: vi.fn() })).rejects.toThrow("promotion write failed");
    await expect(client.book.info("book")).resolves.toEqual({ bookId: "book" });

    expect(attempts).toEqual(["promoted-refresh", "old-rotated"]);
    expect(stored).toBe("old-rotated");
  });

  it("uses e-ink identity and the named e-ink store by default for QR login", async () => {
    const env = temporaryEnv();
    const requests: Array<{ url: URL; headers: Headers; body?: Record<string, unknown> }> = [];
    const responses: Array<Record<string, unknown>> = [];
    const queueLogin = (): void => {
      responses.push(
        { signature: "signature", timeStamp: 1 },
        { errcode: 0, uuid: "uuid" },
        { wx_errcode: 405, wx_code: "code" },
        { vid: "123", accessToken: "qr-access", refreshToken: "refresh" },
      );
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      requests.push({
        url: new URL(String(input)),
        headers: new Headers(init?.headers),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      });
      return Response.json(responses.shift());
    });

    const client = new MobileApiClient({ env, fetchImpl });
    queueLogin();
    const generated = await client.login({ onQr: vi.fn() });
    expect(generated).toEqual({
      vid: "123",
      accessToken: "qr-access",
      refreshToken: "refresh",
      deviceId: expect.stringMatching(/^eink33\d{26}$/),
    });

    expect(loadCredentials({ env, store: "eink" })).toEqual({
      vid: "123",
      accessToken: "qr-access",
      refreshToken: "refresh",
      deviceId: expect.stringMatching(/^eink33\d{26}$/),
    });
    expect(existsSync(storePath(env))).toBe(false);

    queueLogin();
    const restarted = await new MobileApiClient({ env, fetchImpl }).login({ onQr: vi.fn() });
    expect(restarted.deviceId).toBe(generated.deviceId);

    queueLogin();
    const fromEnvironment = await new MobileApiClient({
      env: {
        ...env,
        WEREAD_VID: "environment-vid",
        WEREAD_REFRESH_TOKEN: "environment-refresh",
        WEREAD_DEVICE_ID: "environment-device",
      },
      fetchImpl,
    }).login({ onQr: vi.fn() });
    expect(fromEnvironment.deviceId).toBe(generated.deviceId);

    const explicitEnv = temporaryEnv();
    queueLogin();
    await new MobileApiClient({ credentials, env: explicitEnv, fetchImpl }).login({ onQr: vi.fn() });
    expect(existsSync(storePath(explicitEnv, "eink"))).toBe(false);

    for (const request of requests.filter(({ url }) => url.hostname === "i.weread.qq.com")) {
      expect(request.headers.get("User-Agent")).toContain("WRBrand/Onyx");
    }
    expect(requests.at(-1)?.body).toEqual(
      expect.objectContaining({
        deviceName: "BOOX",
        deviceType: 3,
        installId: expect.stringMatching(/^eink31\d{26}$/),
      }),
    );
  });

  it("preserves an explicit empty store name", async () => {
    const env = temporaryEnv();
    saveCredentials(credentials, { env, store: "" });
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname === "/login"
        ? Response.json({ vid: "123", accessToken: "access", refreshToken: "rotated" })
        : Response.json({ bookId: "book" }),
    );

    await expect(new MobileApiClient({ env, store: "", fetchImpl }).book.info("book")).resolves.toEqual({
      bookId: "book",
    });

    expect(loadCredentials({ env, store: "" }).refreshToken).toBe("rotated");
    expect(existsSync(storePath(env, "eink"))).toBe(false);
  });

  // The store is chosen by the caller or defaults to "eink"; the cases below pin the file each
  // selection lands on, including where a rotated secret is written back.
  const rotatingFetch = (): ReturnType<typeof vi.fn<typeof fetch>> =>
    vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname === "/login"
        ? Response.json({ vid: "123", accessToken: "access", refreshToken: "rotated" })
        : Response.json({ bookId: "book" }),
    );

  it("bootstraps from environment once, persists the access token, and restarts from the selected file", async () => {
    const env = {
      ...temporaryEnv(),
      WEREAD_VID: "env-vid",
      WEREAD_REFRESH_TOKEN: "env-refresh",
      WEREAD_DEVICE_ID: "env-device",
    };
    const refreshTokens: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/login") {
        const refreshToken = String(JSON.parse(String(init?.body)).refreshToken);
        refreshTokens.push(refreshToken);
        return Response.json({ vid: "env-vid", accessToken: "access", refreshToken: `${refreshToken}-next` });
      }
      return Response.json({ bookId: "book" });
    });

    await new MobileApiClient({ env, fetchImpl }).book.info("first");
    await new MobileApiClient({ env, fetchImpl }).book.info("second");

    expect(refreshTokens).toEqual(["env-refresh"]);
    expect(loadCredentials({ env, store: "eink" })).toEqual({
      vid: "env-vid",
      accessToken: "access",
      refreshToken: "env-refresh-next",
      deviceId: "env-device",
    });
  });

  it("persists a forced refresh from an environment access token and restarts from the file", async () => {
    const env = {
      ...temporaryEnv(),
      WEREAD_VID: "env-vid",
      WEREAD_ACCESS_TOKEN: "env-access",
      WEREAD_REFRESH_TOKEN: "env-refresh",
      WEREAD_DEVICE_ID: "env-device",
    };
    const paths: string[] = [];
    const accessTokens: string[] = [];
    let bookCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path === "/login") {
        return Response.json({ vid: "env-vid", accessToken: "file-access", refreshToken: "file-refresh" });
      }
      accessTokens.push(new Headers(init?.headers).get("accessToken") ?? "");
      bookCalls += 1;
      return bookCalls === 1 ? Response.json({ errCode: -2012 }) : Response.json({ bookId: "book" });
    });

    await expect(new MobileApiClient({ env, fetchImpl }).book.info("first")).resolves.toEqual({ bookId: "book" });
    await expect(new MobileApiClient({ env, fetchImpl }).book.info("second")).resolves.toEqual({ bookId: "book" });

    expect(paths).toEqual(["/book/info", "/login", "/book/info", "/book/info"]);
    expect(accessTokens).toEqual(["env-access", "file-access", "file-access"]);
    expect(loadCredentials({ env, store: "eink" })).toEqual({
      vid: "env-vid",
      accessToken: "file-access",
      refreshToken: "file-refresh",
      deviceId: "env-device",
    });
  });

  it("reuses a persisted access token without a startup login request", async () => {
    const env = temporaryEnv();
    saveCredentials({ ...credentials, accessToken: "persisted-access" }, { env, store: "eink" });
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ bookId: "book" }));

    await expect(new MobileApiClient({ env, fetchImpl }).book.info("book")).resolves.toEqual({ bookId: "book" });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(new URL(String(fetchImpl.mock.calls[0]?.[0])).pathname).toBe("/book/info");
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("accessToken")).toBe("persisted-access");
  });

  it("upgrades a legacy file even when the refresh token is unchanged", async () => {
    const env = temporaryEnv();
    saveCredentials(credentials, { env, store: "eink" });
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname === "/login"
        ? Response.json({ vid: "123", accessToken: "minted-access", refreshToken: credentials.refreshToken })
        : Response.json({ bookId: "book" }),
    );

    await new MobileApiClient({ env, fetchImpl }).book.info("book");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(loadCredentials({ env, store: "eink" }).accessToken).toBe("minted-access");
  });

  it("still defaults to the eink store when nothing selects one", async () => {
    const env = temporaryEnv();
    saveCredentials(credentials, { env, store: "eink" });

    await expect(new MobileApiClient({ env, fetchImpl: rotatingFetch() }).book.info("book")).resolves.toEqual({
      bookId: "book",
    });

    expect(storePath(env, undefined)).toBe(join(env.WEREAD_CONFIG_DIR as string, "credentials.json"));
    expect(existsSync(storePath(env))).toBe(false);
    expect(existsSync(join(env.WEREAD_CONFIG_DIR as string, "credentials.eink.json"))).toBe(true);
    expect(loadCredentials({ env, store: "eink" }).refreshToken).toBe("rotated");
  });

  it("uses the eink store when the caller names none", async () => {
    const env = temporaryEnv();
    saveCredentials(credentials, { env, store: "eink" });

    await expect(new MobileApiClient({ env, fetchImpl: rotatingFetch() }).book.info("book")).resolves.toEqual({
      bookId: "book",
    });

    expect(existsSync(join(env.WEREAD_CONFIG_DIR as string, "credentials.eink.json"))).toBe(true);
    expect(existsSync(join(env.WEREAD_CONFIG_DIR as string, "credentials.json"))).toBe(false);
    // Rotation follows the same selection, so the refreshed secret lands back in credentials.eink.json.
    expect(loadCredentials({ env, store: "eink" }).refreshToken).toBe("rotated");
  });

  it("lets an explicit store name choose the file", async () => {
    const env = temporaryEnv();
    saveCredentials(credentials, { env, store: "private" });

    await expect(
      new MobileApiClient({ env, store: "private", fetchImpl: rotatingFetch() }).book.info("book"),
    ).resolves.toEqual({
      bookId: "book",
    });

    expect(existsSync(join(env.WEREAD_CONFIG_DIR as string, "credentials.private.json"))).toBe(true);
    expect(loadCredentials({ env, store: "private" }).refreshToken).toBe("rotated");
    expect(existsSync(storePath(env, "eink"))).toBe(false);
  });

  it("threads one supplied profile and store through QR login, rotation, reload, and restart", async () => {
    const env = temporaryEnv();
    const requests: Array<{ path: string; headers: Headers; body?: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      requests.push({ path: url.pathname, headers: new Headers(init?.headers), body });
      if (url.pathname === "/wxticket") return Response.json({ signature: "signature", timeStamp: 1 });
      if (url.hostname === "open.weixin.qq.com") return Response.json({ errcode: 0, uuid: "uuid" });
      if (url.hostname === "long.open.weixin.qq.com") return Response.json({ wx_errcode: 405, wx_code: "code" });
      if (url.pathname === "/login" && body && "code" in body) {
        return Response.json({ vid: "123", accessToken: "access:refresh-a", refreshToken: "refresh-a" });
      }
      if (url.pathname === "/login") {
        const refreshToken = String(body?.refreshToken);
        return Response.json({
          vid: "123",
          accessToken: `access:${refreshToken}`,
          refreshToken: `${refreshToken}-next`,
        });
      }
      return Response.json({ bookId: String(new URL(String(input)).searchParams.get("bookId")) });
    });
    const client = new MobileApiClient({
      env,
      fetchImpl,
      profile: customProfile,
      store: "private",
    });

    await client.login({
      profile: {
        ...customProfile,
        versionHeaders: { "User-Agent": "IgnoredOverride/1.0" },
        deviceName: "IGNORED",
        deviceType: 999,
      },
    } as never);
    await expect(client.book.info("first")).resolves.toEqual({ bookId: "first" });
    expect(loadCredentials({ env, store: "private" }).refreshToken).toBe("refresh-a");

    saveCredentials({ ...credentials, refreshToken: "refresh-reloaded" }, { env, store: "private" });
    client.reloadCredentials();
    await client.book.info("reloaded");
    expect(loadCredentials({ env, store: "private" }).refreshToken).toBe("refresh-reloaded-next");

    const restarted = new MobileApiClient({
      env,
      fetchImpl,
      profile: customProfile,
      store: "private",
    });
    await restarted.book.info("restart");

    const wereadRequests = requests.filter(({ path }) => path !== "/connect/sdk/qrconnect");
    for (const request of wereadRequests.filter(({ path }) => path !== "/connect/l/qrconnect")) {
      expect(request.headers.get("X-Client-Profile")).toBe("custom");
    }
    const loginBodies = requests.filter(({ path }) => path === "/login").map(({ body }) => body);
    expect(loginBodies).toEqual([
      expect.objectContaining({
        deviceId: "custom-device",
        deviceName: "CUSTOM",
        deviceType: 91,
        installId: "custom-install",
        installShape: "custom",
      }),
      expect.objectContaining({ refreshToken: "refresh-reloaded" }),
    ]);
    expect(
      requests.filter(({ path }) => path === "/book/info").map(({ headers }) => headers.get("X-Profile-Token")),
    ).toEqual(["access:refresh-a", "access:refresh-reloaded", "access:refresh-reloaded"]);
  });

  it("keeps routing rotations to the callback the login was given", async () => {
    const env = temporaryEnv();
    let bookRequests = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      if (url.pathname === "/wxticket") return Response.json({ signature: "signature", timeStamp: 1 });
      if (url.hostname === "open.weixin.qq.com") return Response.json({ errcode: 0, uuid: "uuid" });
      if (url.hostname === "long.open.weixin.qq.com") return Response.json({ wx_errcode: 405, wx_code: "code" });
      if (url.pathname === "/login") {
        return body && "code" in body
          ? Response.json({ vid: "123", accessToken: "access:vault-a", refreshToken: "vault-a" })
          : Response.json({ vid: "123", accessToken: "access", refreshToken: `${String(body?.refreshToken)}-next` });
      }
      if (url.pathname === "/book/info" && bookRequests++ === 0) return Response.json({ errCode: -2012 });
      return Response.json({ bookId: "book" });
    });
    const vault: string[] = [];
    const client = new MobileApiClient({ env, fetchImpl });

    await client.login({
      onCredentials: (next) => {
        vault.push(next.refreshToken);
      },
    });
    await client.book.info("book");

    // The rotation belongs to the session this caller routed elsewhere; letting it fall back to the
    // default saver would put a secret meant for a vault into credentials.eink.json.
    expect(vault).toEqual(["vault-a", "vault-a-next"]);
    expect(existsSync(storePath(env, "eink"))).toBe(false);
  });

  it("treats empty environment credential variables as absent", async () => {
    const env = {
      ...temporaryEnv(),
      WEREAD_VID: "",
      WEREAD_REFRESH_TOKEN: "",
      WEREAD_DEVICE_ID: "",
    };
    saveCredentials(credentials, { env, store: "eink" });
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname === "/login"
        ? Response.json({ accessToken: "access", refreshToken: "rotated-from-file" })
        : Response.json({ bookId: "book" }),
    );

    await new MobileApiClient({ env, fetchImpl }).book.info("book");

    expect(loadCredentials({ env, store: "eink" }).refreshToken).toBe("rotated-from-file");
  });

  it("forces the e-ink profile in createEinkClient even for an untyped runtime override", async () => {
    const requestHeaders: Headers[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      requestHeaders.push(new Headers(init?.headers));
      return new URL(String(input)).pathname === "/login"
        ? Response.json({ accessToken: "access" })
        : Response.json({ bookId: "book" });
    });
    const options = { credentials, env: {}, fetchImpl, profile: customProfile };

    await createEinkClient(options as never).book.info("book");

    expect(requestHeaders).toHaveLength(2);
    for (const headers of requestHeaders) {
      expect(headers.get("User-Agent")).toContain("WRBrand/Onyx");
      expect(headers.get("X-Client-Profile")).toBeNull();
    }
  });

  it("exposes the raw mobile transport without widening the resource surface", async () => {
    const debug = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname === "/login"
        ? Response.json({ accessToken: "access" })
        : new Response(Uint8Array.from([1, 2, 3]), {
            headers: { "content-type": "application/octet-stream" },
          }),
    );
    const client = new MobileApiClient({ credentials, env: {}, fetchImpl, logger: { debug } });

    expect(client.mobile).toBeInstanceOf(MobileClient);
    await expect(client.mobile.callRaw("GET", "/raw")).resolves.toEqual(
      expect.objectContaining({
        status: 200,
        body: Uint8Array.from([1, 2, 3]),
      }),
    );
    const logs = debug.mock.calls.flat().join("\n");
    expect(logs).toContain("WeRead access-token mint: started");
    expect(logs).toContain('mobile GET "/raw": HTTP 200');
  });

  it("routes every canonical operation to the E-Ink backend", () => {
    const backend = (): Record<string, Record<string, ReturnType<typeof vi.fn>>> => {
      const value: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
      for (const [resource, methods] of Object.entries(PUBLIC_OPERATIONS)) {
        value[resource] = Object.fromEntries(methods.map((method) => [method, vi.fn()]));
      }
      return value;
    };
    const eink = Object.assign(backend(), { mobile: { call: vi.fn() } });
    const client = new WeReadClient({ eink: eink as never }) as unknown as Record<string, Record<string, unknown>>;

    for (const [resource, methods] of Object.entries(PUBLIC_OPERATIONS)) {
      for (const method of methods) {
        const operation = `${resource}.${method}`;
        expect(client[resource]?.[method], operation).toBe(eink[resource]?.[method]);
      }
    }
    expect(captureClientSession(client).mobile).toBe(eink.mobile);
  });

  it("exports only the curated root runtime and the exact import error identity", () => {
    expect(Object.keys(publicApi).sort()).toEqual(
      [
        // Thrown out of the public import.book path; exported so a consumer can branch on
        // code ("unsupported-format" | "too-large") instead of string-matching a message.
        "ALLOWED_EXT",
        "AccountManager",
        "AuthError",
        "BookValidationError",
        "ContentLibrary",
        "ImportPhaseError",
        "LibraryError",
        "LibraryStoreError",
        "LibraryUnsupportedError",
        "LibraryVersionError",
        "MobileClient",
        "MobileApiClient",
        "PUBLIC_OPERATIONS",
        "PublicAccountArtifactError",
        "PublicAccountReadError",
        "TokenManager",
        "TransportError",
        "WeReadApiError",
        "WeReadError",
        "WeReadClient",
        "applyConnectAttemptTimeout",
        "buildPublicAccountFeed",
        "createEinkClient",
        "deviceVersionHeaders",
        "einkDevice",
        "einkProfile",
        "exchange",
        "exportPublicAccountArchive",
        "isAmbiguousImportOutcome",
        "libraryRoot",
        "loadCredentials",
        "login",
        "mintAccessToken",
        "pollForCode",
        "readPublicAccountArticle",
        "requestQr",
        "resolveProfile",
        "saveCredentials",
        "storePath",
        "toTransportError",
        "withContentLibrary",
      ].sort(),
    );
    expect(ImportPhaseError).toBe(InternalImportPhaseError);
    expect(
      isAmbiguousImportOutcome(
        new ImportPhaseError("unknown outcome", {
          ambiguous: true,
          phase: "post-notify",
        }),
      ),
    ).toBe(true);
  });
});
