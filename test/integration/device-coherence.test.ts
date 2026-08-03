import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileClient } from "../../src/api/mobile.js";
import { loadCredentials, saveCredentials, storePath } from "../../src/auth/credentials.js";
import { login } from "../../src/auth/qrlogin.js";
import { TokenManager } from "../../src/auth/token.js";
import { einkProfile } from "../../src/profile.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing test ${label}`);
  return value;
}

describe("e-ink identity coherence", () => {
  it("keeps login, persistence, restart reuse, and mobile request on one profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "weread-coherence-"));
    roots.push(root);
    const env = { WEREAD_CONFIG_DIR: root };
    const profile = einkProfile();
    const seen: Array<{ url: string; headers: Headers; body?: string }> = [];
    const responses = [
      Response.json({ signature: "ticket-signature", timeStamp: 1 }),
      Response.json({ errcode: 0, uuid: "uuid" }),
      Response.json({ wx_errcode: 405, wx_code: "code" }),
      Response.json({ vid: "123", accessToken: "access-a", refreshToken: "refresh-a" }),
      Response.json({ ok: true }),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      seen.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: init?.body as string | undefined,
      });
      return required(responses.shift(), "response");
    });

    const loggedIn = await login({ fetchImpl, profile });
    saveCredentials(loggedIn, { env, store: "eink" });
    const restarted = loadCredentials({ env, store: "eink" });
    expect(restarted).toEqual(loggedIn);
    expect(storePath(env, "eink")).toMatch(/credentials\.eink\.json$/);
    expect(existsSync(storePath(env, ""))).toBe(false);

    const tokenManager = new TokenManager(restarted, {
      fetchImpl,
      profile,
      onCredentials: (credentials) => saveCredentials(credentials, { env, store: "eink" }),
    });
    const client = new MobileClient({ tokenManager, fetchImpl, profile });
    await expect(client.call("GET", "/library/items")).resolves.toMatchObject({ body: { ok: true } });

    const ticket = required(seen[0], "ticket");
    const exchange = required(seen[3], "exchange");
    const request = required(seen[4], "request");
    const exchangeBody = JSON.parse(required(exchange.body, "exchange body")) as Record<string, unknown>;
    expect(exchangeBody).toMatchObject({
      deviceId: loggedIn.deviceId,
      deviceName: "BOOX",
      deviceType: 3,
    });
    for (const current of [ticket, exchange, request]) {
      expect(current.headers.get("User-Agent")).toBe(profile.versionHeaders["User-Agent"]);
      expect(current.headers.get("appver")).toBe("2.1.2.10245900");
      expect(current.headers.get("channelId")).toBe("900");
    }
    expect(request.headers.get("accessToken")).toBe("access-a");
    expect(loadCredentials({ env, store: "eink" })).toEqual(loggedIn);
    expect(seen.filter(({ url }) => new URL(url).pathname === "/login")).toHaveLength(1);
  });
});
