import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type MintAccessTokenOptions, mintAccessToken } from "../../src/auth/token.js";
import { AuthError, TransportError } from "../../src/errors.js";

afterEach(() => vi.restoreAllMocks());

describe("access-token mint", () => {
  it("uses the default e-ink identity and direct signature", async () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.redirect).toBe("error");
      const headers = new Headers(init?.headers);
      expect(headers.get("User-Agent")).toContain("WRBrand/Onyx wr_eink");
      expect(headers.get("channelId")).toBe("900");
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({
        deviceId: "eink-device",
        deviceName: "BOOX",
        deviceType: 3,
        refreshToken: "refresh",
      });
      expect(body).not.toHaveProperty("virtualChannelId");
      expect(body).not.toHaveProperty("wxToken");
      expect(body.signature).toBe(
        createHash("sha256")
          .update(`100eink-device${body.random as number}`)
          .digest("hex"),
      );
      return Response.json({ vid: 123, accessToken: "access", refreshToken: "rotated" });
    });

    await expect(
      mintAccessToken({ vid: "123", refreshToken: "refresh", deviceId: "eink-device" }, fetchImpl),
    ).resolves.toEqual({ vid: "123", accessToken: "access", refreshToken: "rotated" });
  });

  it("does not accept a device override", () => {
    // @ts-expect-error Identity overrides must use ClientProfile.
    const invalid: MintAccessTokenOptions = { device: {} };
    expect(invalid).toHaveProperty("device");
  });

  it("classifies network and malformed-body failures", async () => {
    const credentials = { vid: "1", refreshToken: "r", deviceId: "d" };
    await expect(
      mintAccessToken(
        credentials,
        vi.fn<typeof fetch>(async () => {
          throw new Error("offline");
        }),
      ),
    ).rejects.toBeInstanceOf(TransportError);
    await expect(
      mintAccessToken(
        credentials,
        vi.fn<typeof fetch>(async () => new Response("{")),
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it.each([
    [{ vid: null, accessToken: "a" }, /vid/],
    [{ vid: "1", accessToken: "" }, /failed/],
    [{ vid: "1", accessToken: "a", refreshToken: null }, /refreshToken/],
  ])("validates returned credentials %#", async (result, error) => {
    await expect(
      mintAccessToken(
        { vid: "1", refreshToken: "r", deviceId: "d" },
        vi.fn<typeof fetch>(async () => Response.json(result)),
      ),
    ).rejects.toThrow(error);
  });

  it("combines the caller's signal with the timeout and cancels the login request", async () => {
    const caller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      // A direct mint has exactly one waiter, so cancelling the request itself is safe here —
      // unlike TokenManager's shared mint, which never receives a caller signal.
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal?.aborted).toBe(false);
      caller.abort(new DOMException("stop", "AbortError"));
      expect(init?.signal?.aborted).toBe(true);
      throw init?.signal?.reason;
    });
    await expect(
      mintAccessToken({ vid: "1", refreshToken: "r", deviceId: "d" }, fetchImpl, { signal: caller.signal }),
    ).rejects.toThrow("WeRead access-token mint: request aborted");
  });

  it("refuses a mint whose signal is already aborted before the request goes out", async () => {
    const caller = new AbortController();
    caller.abort(new DOMException("stop", "AbortError"));
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.signal?.aborted).toBe(true);
      throw init?.signal?.reason;
    });
    await expect(
      mintAccessToken({ vid: "1", refreshToken: "r", deviceId: "d" }, fetchImpl, { signal: caller.signal }),
    ).rejects.toBeInstanceOf(TransportError);
  });
});
