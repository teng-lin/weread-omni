import { describe, expect, it } from "vitest";
import { einkProvider } from "../../src/eink-provider.js";
import type { JsonValue } from "../../src/plugin.js";

const einkCredentials = {
  vid: "123",
  refreshToken: "eink-refresh",
  deviceId: "eink3312345678901234567890123456",
};

describe("eink login", () => {
  it("generates a fresh E-Ink device for a new named account instead of inheriting legacy state", async () => {
    let exchangeBody: Record<string, unknown> | undefined;
    const stages: string[] = [];
    const fetchImpl = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input));
      if (url.pathname === "/wxticket") return Response.json({ signature: "signature", timeStamp: 1 });
      if (url.hostname === "open.weixin.qq.com") return Response.json({ errcode: 0, uuid: "eink-uid" });
      if (url.hostname === "long.open.weixin.qq.com") {
        return Response.json({ wx_errcode: 405, wx_code: "wx-code" });
      }
      if (url.pathname === "/login") {
        exchangeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ vid: "123", accessToken: "eink-token", refreshToken: "eink-refresh" });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const result = await einkProvider.login({
      env: {
        WEREAD_VID: "999",
        WEREAD_REFRESH_TOKEN: "legacy-refresh",
        WEREAD_DEVICE_ID: "legacy-device",
      },
      fetchImpl,
      onQr: (_url, stage) => {
        stages.push(String(stage));
      },
      onStatus: () => undefined,
      onOtp: () => "1234",
    });

    expect(stages).toEqual(["eink"]);
    expect(exchangeBody?.deviceId).toMatch(/^eink33\d{26}$/);
    expect(exchangeBody?.deviceId).not.toBe("legacy-device");
    expect(result.identity).toMatchObject({ vid: "123", deviceId: exchangeBody?.deviceId });
    expect(result.state).toEqual({
      version: 1,
      eink: {
        vid: "123",
        refreshToken: "eink-refresh",
        deviceId: exchangeBody?.deviceId,
        accessToken: "eink-token",
      },
    });
  });
});

describe("eink account state", () => {
  it("writes back a rotated secret", async () => {
    const saved: JsonValue[] = [];
    const fetchImpl = async (input: Parameters<typeof fetch>[0]) =>
      new URL(String(input)).pathname === "/login"
        ? Response.json({ accessToken: "access", refreshToken: "rotated" })
        : Response.json({ bookId: "book" });
    const opened = await einkProvider.open({
      state: { version: 1, eink: einkCredentials },
      env: {},
      fetchImpl,
      saveState: async (next) => {
        saved.push(next);
      },
    });

    expect(opened.identity).toEqual({ vid: "123", deviceId: einkCredentials.deviceId });

    await opened.client.book.info("book");

    expect(saved.at(-1)).toEqual({
      version: 1,
      eink: {
        vid: "123",
        refreshToken: "rotated",
        deviceId: einkCredentials.deviceId,
        accessToken: "access",
      },
    });
  });

  it("rejects a state version it does not understand", async () => {
    await expect(
      einkProvider.open({
        state: { version: 3, eink: einkCredentials },
        env: {},
        fetchImpl: async () => Response.json({}),
        saveState: async () => undefined,
      }),
    ).rejects.toThrow(/unsupported version/);
  });
});

describe("eink backend routing", () => {
  const state = { version: 1, eink: einkCredentials } satisfies JsonValue;

  // A regression guard, not a routing test: there is one backend, so this asserts that reading the
  // environment never introduces a second one. WEREAD_API_KEY and the gateway path are the shape a
  // reintroduction would take, which is why the assertion names them although nothing emits them.
  it("reaches only the E-Ink backend, whatever the environment holds", async () => {
    const paths: string[] = [];
    const opened = await einkProvider.open({
      state,
      env: { WEREAD_API_KEY: "wrk-secret" },
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        return url.pathname === "/login" ? Response.json({ accessToken: "access" }) : Response.json({ bookId: "book" });
      },
      saveState: async () => undefined,
    });

    await opened.client.book.info("book");

    expect(paths).not.toContain("/api/agent/gateway");
    expect(paths).toContain("/book/info");
  });
});
