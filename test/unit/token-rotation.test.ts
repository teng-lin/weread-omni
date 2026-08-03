import { describe, expect, it, vi } from "vitest";
import type { Credentials } from "../../src/auth/credentials.js";
import { mintAccessToken, TokenManager } from "../../src/auth/token.js";
import { AuthError, TransportError } from "../../src/errors.js";

// Rotation and persistence edges around the mint. A refresh token is the long-lived secret in this
// package: whether a rotated one reaches the caller's store, and whether a garbled mint response is
// reported as an auth failure rather than crashing, both decide if a session survives.

const credentials = { vid: "123", refreshToken: "refresh-a", deviceId: "device" };
const rotating = (): typeof fetch =>
  vi.fn<typeof fetch>(async () => Response.json({ vid: "123", accessToken: "access", refreshToken: "refresh-b" }));

describe("access-token mint response validation", () => {
  it("rejects an identity field that is present but empty", async () => {
    // An empty vid is not "missing" (which legitimately means "keep the one we have"); it is a
    // response that would silently install a broken identity.
    await expect(
      mintAccessToken(
        credentials,
        vi.fn<typeof fetch>(async () => Response.json({ vid: "", accessToken: "access" })),
      ),
    ).rejects.toThrow(/empty vid/);
  });

  it("accepts a numeric vid and normalizes it to a string", async () => {
    await expect(
      mintAccessToken(
        { ...credentials, vid: "4242" },
        vi.fn<typeof fetch>(async () => Response.json({ vid: 4242, accessToken: "access" })),
      ),
    ).resolves.toMatchObject({ vid: "4242" });
  });

  it("reports a literal null body as an auth failure rather than a crash", async () => {
    await expect(
      mintAccessToken(
        credentials,
        vi.fn<typeof fetch>(async () => new Response("null", { headers: { "content-type": "application/json" } })),
      ),
    ).rejects.toThrow(/unusable response body/);
  });

  it("reports a cancelled body read as a transport failure, not a protocol failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const aborted = new Error("The operation was aborted");
      aborted.name = "AbortError";
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(aborted);
          },
        }),
      );
    });
    await expect(mintAccessToken(credentials, fetchImpl)).rejects.toBeInstanceOf(TransportError);
  });

  it("keeps the caller's refresh token when the mint does not return a new one", async () => {
    await expect(
      mintAccessToken(
        credentials,
        vi.fn<typeof fetch>(async () => Response.json({ vid: "123", accessToken: "access" })),
      ),
    ).resolves.toMatchObject({ refreshToken: "refresh-a" });
  });

  it("surfaces the upstream error code when the mint is refused", async () => {
    await expect(
      mintAccessToken(
        credentials,
        vi.fn<typeof fetch>(async () => Response.json({ errCode: -2012, errMsg: "session expired" }, { status: 200 })),
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("TokenManager persistence", () => {
  it("rotates without a persistence callback instead of failing the mint", async () => {
    // A client constructed with no `onCredentials` still rotates upstream. Losing the new refresh
    // token is a known cost of that configuration; failing the request is not.
    const fetchImpl = rotating();
    const debug = vi.fn();
    const info = vi.fn();
    const manager = new TokenManager(credentials, { fetchImpl, logger: { debug, info } });
    await expect(manager.get()).resolves.toMatchObject({ accessToken: "access", refreshToken: "refresh-b" });
    await expect(manager.get(true)).resolves.toMatchObject({ refreshToken: "refresh-b" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(debug).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("warns when a queued credential persistence retry is swallowed", async () => {
    const warn = vi.fn();
    const onCredentials = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockRejectedValueOnce(new Error("unlabelled-secret-retry-value"));
    const manager = new TokenManager(credentials, { fetchImpl: rotating(), onCredentials, logger: { warn } });

    await expect(manager.get()).rejects.toThrow("disk full");
    await expect(manager.get()).resolves.toMatchObject({ accessToken: "access" });

    expect(warn).toHaveBeenCalledWith("WeRead access-token mint: credential persistence retry failed");
    expect(warn.mock.calls.flat().join("\n")).not.toContain("unlabelled-secret-retry-value");
  });

  it("shares one in-flight persistence between concurrent retries", async () => {
    // The first persistence fails, so the credentials stay queued. Two callers then arrive at once:
    // the retry must be joined, not duplicated — every extra write is another chance to interleave
    // two versions of the same credential file.
    let resolveSecond = (): void => {};
    const onCredentials = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const manager = new TokenManager(credentials, { fetchImpl: rotating(), onCredentials });

    await expect(manager.get()).rejects.toThrow("disk full");
    const both = Promise.all([manager.get(), manager.get()]);
    resolveSecond();
    const [first, second] = await both;

    expect(first).toBe(second);
    expect(onCredentials).toHaveBeenCalledTimes(2);
    expect(onCredentials).toHaveBeenLastCalledWith({
      ...credentials,
      accessToken: "access",
      refreshToken: "refresh-b",
    });
  });

  it("hands the persistence callback a copy the caller cannot use to mutate manager state", async () => {
    const seen: Credentials[] = [];
    const onCredentials = vi.fn((value: Credentials) => {
      seen.push(value);
      value.refreshToken = "tampered";
    });
    const manager = new TokenManager(credentials, { fetchImpl: rotating(), onCredentials });

    await manager.get();
    await expect(manager.get(true)).resolves.toMatchObject({ refreshToken: "refresh-b" });
    expect(seen[0]).toMatchObject({ refreshToken: "tampered" });
  });
});
