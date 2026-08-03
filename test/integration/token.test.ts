import { describe, expect, it, vi } from "vitest";
import { mintAccessToken, TokenManager } from "../../src/auth/token.js";
import { AuthError, TransportError } from "../../src/errors.js";
import type { ClientProfile } from "../../src/profile.js";

const MAX_JSON_RESPONSE_BYTES = 16_777_216;
const credentials = { vid: "123", refreshToken: "refresh-a", deviceId: "device" };

const interruptedResponse = (cause: Error): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(cause);
      },
    }),
  );

function repeatingResponse(
  chunk: Uint8Array,
  count: number,
  cancelFailure: Error,
): { cancel: ReturnType<typeof vi.fn>; response: Response } {
  let emitted = 0;
  const cancel = vi.fn(async () => {
    throw cancelFailure;
  });
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted < count) {
        emitted += 1;
        controller.enqueue(chunk);
      }
    },
    cancel,
  });
  return { cancel, response: new Response(body, { headers: { "content-length": "1" } }) };
}

describe("access-token mint response handling", () => {
  it.each([
    ["socket reset", new TypeError("terminated"), "network error"],
    ["abort", new DOMException("cancelled", "AbortError"), "request aborted"],
    ["timeout", new DOMException("deadline", "TimeoutError"), "request timed out"],
  ])("classifies a body-read %s as a transport failure", async (_label, cause, detail) => {
    await expect(
      mintAccessToken(
        credentials,
        vi.fn<typeof fetch>(async () => interruptedResponse(cause)),
      ),
    ).rejects.toMatchObject({
      name: TransportError.name,
      message: `WeRead access-token mint: ${detail}`,
      cause,
    });
  });

  it("keeps a fully received non-JSON body as an auth failure", async () => {
    await expect(
      mintAccessToken(
        credentials,
        vi.fn<typeof fetch>(async () => new Response("<html>maintenance</html>")),
      ),
    ).rejects.toMatchObject({
      name: AuthError.name,
      message: "WeRead access-token mint returned a non-JSON response",
      cause: expect.any(SyntaxError),
    });
  });

  it("rejects a declared oversized body before acquiring a reader", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { "content-length": String(MAX_JSON_RESPONSE_BYTES + 1) },
    });
    const getReader = vi.spyOn(response.body as ReadableStream<Uint8Array>, "getReader");
    const error = await mintAccessToken(
      credentials,
      vi.fn<typeof fetch>(async () => response),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      message: `WeRead access-token mint: response exceeds ${MAX_JSON_RESPONSE_BYTES} bytes`,
    });
    expect(error).not.toHaveProperty("cause");
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps streamed overflow primary when cancellation cleanup fails", async () => {
    const cleanupFailure = new Error("cancel failed");
    const { cancel, response } = repeatingResponse(new Uint8Array(1024 * 1024), 17, cleanupFailure);
    const error = await mintAccessToken(
      credentials,
      vi.fn<typeof fetch>(async () => response),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      message: `WeRead access-token mint: response exceeds ${MAX_JSON_RESPONSE_BYTES} bytes`,
    });
    expect(error).not.toHaveProperty("cause");
    expect(error).not.toBe(cleanupFailure);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("TokenManager", () => {
  it("starts from a persisted access token without minting", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const manager = new TokenManager({ ...credentials, accessToken: "persisted" }, { fetchImpl });

    await expect(manager.get()).resolves.toEqual({
      vid: credentials.vid,
      accessToken: "persisted",
      refreshToken: credentials.refreshToken,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("coalesces concurrent mints, caches, and persists one rotation", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ vid: "123", accessToken: "access", refreshToken: "refresh-b" }),
    );
    const onCredentials = vi.fn();
    const manager = new TokenManager(credentials, { fetchImpl, onCredentials });
    const [first, second] = await Promise.all([manager.get(), manager.get()]);
    expect(first).toBe(second);
    expect(await manager.get()).toBe(first);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(onCredentials).toHaveBeenCalledOnce();
    expect(onCredentials).toHaveBeenCalledWith({ ...credentials, accessToken: "access", refreshToken: "refresh-b" });
  });

  it("does not reuse a rejected cached token when forced refresh fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ errCode: -2012, errMsg: "expired" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ vid: "123", accessToken: "fresh", refreshToken: "refresh-a" }));
    const manager = new TokenManager({ ...credentials, accessToken: "rejected" }, { fetchImpl });

    await expect(manager.get()).resolves.toMatchObject({ accessToken: "rejected" });
    await expect(manager.get(true)).rejects.toThrow("access-token mint failed");
    await expect(manager.get()).resolves.toMatchObject({ accessToken: "fresh" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("invalidates a rejected token before retrying queued persistence", async () => {
    let releaseRetry: () => void = () => undefined;
    const retry = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    const onCredentials = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockReturnValueOnce(retry);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ vid: "123", accessToken: "rejected", refreshToken: "refresh-a" }))
      .mockResolvedValueOnce(Response.json({ vid: "123", accessToken: "fresh", refreshToken: "refresh-a" }));
    const manager = new TokenManager(credentials, { fetchImpl, onCredentials });

    await expect(manager.get()).rejects.toThrow("disk full");
    const forced = manager.get(true);
    await vi.waitFor(() => expect(onCredentials).toHaveBeenCalledTimes(2));
    const ordinary = manager.get();
    releaseRetry();

    await expect(ordinary).resolves.toMatchObject({ accessToken: "fresh" });
    await expect(forced).resolves.toMatchObject({ accessToken: "fresh" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("persists an updated access token when the refresh token is unchanged", async () => {
    const response = { vid: "123", accessToken: "next", refreshToken: "refresh-a" };
    const onCredentials = vi.fn();
    const manager = new TokenManager(
      { ...credentials, accessToken: "current" },
      {
        fetchImpl: vi.fn<typeof fetch>(async () => Response.json(response)),
        onCredentials,
      },
    );

    await manager.get(true);

    expect(onCredentials).toHaveBeenCalledWith({ ...credentials, ...response });
  });

  it("rejects a refresh response for a different account before caching or persistence", async () => {
    const onCredentials = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ vid: "456", accessToken: "wrong-account" }))
      .mockResolvedValueOnce(Response.json({ vid: "123", accessToken: "correct-account" }));
    const manager = new TokenManager(credentials, { fetchImpl, onCredentials });

    await expect(manager.get()).rejects.toThrow("credentials for a different account");
    expect(onCredentials).not.toHaveBeenCalled();
    await expect(manager.get()).resolves.toMatchObject({ vid: "123", accessToken: "correct-account" });
  });

  it("coalesces forced refreshes and clears a failed in-flight mint", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async () => Response.json({ vid: "123", accessToken: "access" }));
    const manager = new TokenManager(credentials, { fetchImpl });
    await expect(manager.get()).rejects.toThrow("network error");
    await manager.get();
    await Promise.all([manager.get(true), manager.get(true), manager.get()]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retains a minted token when rotation persistence fails and retries persistence", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ vid: "123", accessToken: "access", refreshToken: "refresh-b" }),
    );
    const onCredentials = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(undefined);
    const manager = new TokenManager(credentials, { fetchImpl, onCredentials });
    await expect(manager.get()).rejects.toThrow("disk full");
    await expect(manager.get()).resolves.toMatchObject({ accessToken: "access", refreshToken: "refresh-b" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(onCredentials).toHaveBeenCalledTimes(2);
  });

  it("resolves and stores one profile for every mint", async () => {
    let headers = 0;
    const profile: ClientProfile = {
      get versionHeaders() {
        headers += 1;
        return { "User-Agent": "single-profile" };
      },
      deviceName: "single",
      deviceType: 8,
      authHeaders: ({ vid, accessToken }) => ({ vid, accessToken }),
      refreshSignature: () => "proof",
      loginBodyExtras: () => ({ privateField: "yes" }),
      newDeviceId: () => "device",
      newInstallId: () => "install",
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ vid: "123", accessToken: "access" }));
    const manager = new TokenManager(credentials, { fetchImpl, profile });
    await manager.get();
    await manager.get(true);
    expect(headers).toBe(2);
    expect(
      fetchImpl.mock.calls.every(([, init]) => new Headers(init?.headers).get("User-Agent") === "single-profile"),
    ).toBe(true);
    expect(
      fetchImpl.mock.calls.every(([, init]) => {
        const body = JSON.parse(init?.body as string) as Record<string, unknown>;
        return body.deviceType === 8 && body.privateField === "yes";
      }),
    ).toBe(true);
  });

  it("does not accept a device override", () => {
    // @ts-expect-error Identity overrides must use ClientProfile.
    new TokenManager(credentials, { device: {} });
  });
});

/**
 * The mint is single-flight. Cancellation therefore has to cancel the *wait*, never the mint:
 * one caller giving up must not take away the token, the cache entry, or the credential
 * rotation that the other waiters are still depending on.
 */
describe("TokenManager cancellation", () => {
  /**
   * A mint that stays in flight until the test releases it — and that honours whatever signal it
   * is handed, exactly as a real `fetch` would. Without that, "the shared mint is never given a
   * caller's signal" would be an assumption rather than something these tests can catch.
   */
  function blockingMint() {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      await Promise.race([
        gate,
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
      ]);
      return Response.json({ vid: "123", accessToken: "access", refreshToken: "refresh-b" });
    });
    return { fetchImpl, release: () => release() };
  }

  it("stops one waiter without cancelling the mint the others share", async () => {
    const { fetchImpl, release } = blockingMint();
    const onCredentials = vi.fn();
    const manager = new TokenManager(credentials, { fetchImpl, onCredentials });
    const leaving = new AbortController();

    const staying = manager.get();
    const abandoning = manager.get(false, leaving.signal);
    const rejection = expect(abandoning).rejects.toThrow("WeRead access-token mint: request aborted");
    leaving.abort(new DOMException("caller gone", "AbortError"));
    await rejection;

    release();
    // The surviving caller still gets its token, and the rotation still reaches the store.
    await expect(staying).resolves.toMatchObject({ accessToken: "access", refreshToken: "refresh-b" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(onCredentials).toHaveBeenCalledWith({ ...credentials, accessToken: "access", refreshToken: "refresh-b" });
  });

  it("survives the abort of the very caller that started the mint", async () => {
    // The ordering matters: whoever calls first is the one whose signal could reach the mint.
    // A later joiner aborting proves nothing, because its signal was never near `/login`.
    const { fetchImpl, release } = blockingMint();
    const onCredentials = vi.fn();
    const manager = new TokenManager(credentials, { fetchImpl, onCredentials });
    const leaving = new AbortController();

    const initiator = manager.get(false, leaving.signal);
    const joiner = manager.get();
    const rejection = expect(initiator).rejects.toThrow("request aborted");
    leaving.abort(new DOMException("caller gone", "AbortError"));
    await rejection;

    release();
    await expect(joiner).resolves.toMatchObject({ accessToken: "access", refreshToken: "refresh-b" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(onCredentials).toHaveBeenCalledWith({ ...credentials, accessToken: "access", refreshToken: "refresh-b" });
    // Proof the mint was never handed the caller's signal in the first place.
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  });

  it("keeps the in-flight slot after an abort, so the next caller joins rather than re-mints", async () => {
    const { fetchImpl, release } = blockingMint();
    const manager = new TokenManager(credentials, { fetchImpl });
    const leaving = new AbortController();

    const abandoning = manager.get(false, leaving.signal);
    const rejection = expect(abandoning).rejects.toThrow("request aborted");
    leaving.abort(new DOMException("caller gone", "AbortError"));
    await rejection;

    // Releasing the abort must not have released the single-flight slot: a caller arriving now
    // has to join the running mint. Clearing the slot on abort would start a second /login.
    const late = manager.get();
    release();
    await expect(late).resolves.toMatchObject({ accessToken: "access" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuses a pre-aborted caller that arrives while a mint is in flight", async () => {
    const { fetchImpl, release } = blockingMint();
    const manager = new TokenManager(credentials, { fetchImpl });
    const staying = manager.get();

    const gone = new AbortController();
    gone.abort();
    await expect(manager.get(false, gone.signal)).rejects.toThrow("WeRead access-token mint: request aborted");

    release();
    await expect(staying).resolves.toMatchObject({ accessToken: "access" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuses a pre-aborted caller even when the answer is already cached", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ vid: "123", accessToken: "access" }));
    const manager = new TokenManager(credentials, { fetchImpl });
    await manager.get();

    const gone = new AbortController();
    gone.abort();
    // A cached hit is the cheapest path in the whole client, and it is exactly where a
    // cancelled caller would otherwise be handed a result it no longer has any use for.
    await expect(manager.get(false, gone.signal)).rejects.toThrow("WeRead access-token mint: request aborted");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("serves a live signal from cache without waiting on anything", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ vid: "123", accessToken: "access" }));
    const manager = new TokenManager(credentials, { fetchImpl });
    await manager.get();
    await expect(manager.get(false, new AbortController().signal)).resolves.toMatchObject({ accessToken: "access" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not leave a failed mint unhandled when its only waiter has already aborted", async () => {
    // The abandoned mint still rejects. Nothing else is holding it, so if the abort path did not
    // keep a handler attached this would surface as an unhandled rejection — which crashes a
    // Node server rather than failing one request.
    let failMint: (error: Error) => void = () => undefined;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((_resolve, reject) => {
            failMint = reject;
          }),
      )
      .mockImplementation(async () => {
        throw new Error("offline");
      });
    const manager = new TokenManager(credentials, { fetchImpl });
    const leaving = new AbortController();

    const abandoned = manager.get(false, leaving.signal);
    const rejection = expect(abandoned).rejects.toThrow("request aborted");
    leaving.abort(new DOMException("caller gone", "AbortError"));
    await rejection;

    failMint(new Error("offline"));
    await new Promise((resolve) => setImmediate(resolve));

    // The failed mint also released its slot, so the next caller mints again rather than
    // attaching to a promise that has already rejected.
    await expect(manager.get()).rejects.toThrow("network error");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("propagates a mint failure to an un-aborted waiter unchanged", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    const manager = new TokenManager(credentials, { fetchImpl });
    await expect(manager.get(false, new AbortController().signal)).rejects.toThrow("network error");
    // The failed mint still released its slot, so a retry is possible.
    await expect(manager.get(false, new AbortController().signal)).rejects.toThrow("network error");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  /**
   * The cached path is not just a cache read: when an earlier persistence failed, the credentials
   * stay queued and the next caller retries the write. `onCredentials` is user code — a keychain,
   * an HTTP secret store — so that retry can be arbitrarily slow, and it is shared between
   * callers exactly like the mint is. Both halves of the rule therefore apply to it.
   */
  function stalledPersistence() {
    let release: () => void = () => undefined;
    const onCredentials = vi
      .fn()
      // The first write fails, which is what leaves the credentials queued for a retry.
      .mockRejectedValueOnce(new Error("disk full"))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ vid: "123", accessToken: "access", refreshToken: "refresh-b" }),
    );
    return { onCredentials, fetchImpl, release: () => release() };
  }

  it("stops waiting on a slow persistence retry the moment the caller aborts", async () => {
    const { onCredentials, fetchImpl, release } = stalledPersistence();
    const manager = new TokenManager(credentials, { fetchImpl, onCredentials });
    await expect(manager.get()).rejects.toThrow("disk full");

    const leaving = new AbortController();
    // Serves from cache, but first triggers the queued write — which now hangs.
    const abandoning = manager.get(false, leaving.signal);
    const rejection = expect(abandoning).rejects.toThrow("WeRead access-token mint: request aborted");
    leaving.abort(new DOMException("caller gone", "AbortError"));
    // Resolves while the persistence is still in flight: without the abort-aware wait this line
    // would sit here until the test timed out.
    await rejection;

    release();
    await expect(manager.get()).resolves.toMatchObject({ accessToken: "access", refreshToken: "refresh-b" });
    expect(onCredentials).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("still lands the persistence retry for the other callers after one of them aborts", async () => {
    const { onCredentials, fetchImpl, release } = stalledPersistence();
    const manager = new TokenManager(credentials, { fetchImpl, onCredentials });
    await expect(manager.get()).rejects.toThrow("disk full");

    const leaving = new AbortController();
    const abandoning = manager.get(false, leaving.signal);
    const staying = manager.get();
    const rejection = expect(abandoning).rejects.toThrow("request aborted");
    leaving.abort(new DOMException("caller gone", "AbortError"));
    await rejection;

    release();
    await expect(staying).resolves.toMatchObject({ accessToken: "access", refreshToken: "refresh-b" });
    // One shared write, joined rather than duplicated, and the queue is drained — so a later
    // caller does not retry a third time.
    expect(onCredentials).toHaveBeenCalledTimes(2);
    expect(onCredentials).toHaveBeenLastCalledWith({
      ...credentials,
      accessToken: "access",
      refreshToken: "refresh-b",
    });
    await manager.get();
    expect(onCredentials).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuses a pre-aborted caller without abandoning the queued credentials", async () => {
    const { onCredentials, fetchImpl, release } = stalledPersistence();
    const manager = new TokenManager(credentials, { fetchImpl, onCredentials });
    await expect(manager.get()).rejects.toThrow("disk full");

    const gone = new AbortController();
    gone.abort();
    await expect(manager.get(false, gone.signal)).rejects.toThrow("WeRead access-token mint: request aborted");
    // The retry belongs to the manager, not to the caller that happened to walk past it, so an
    // already-cancelled caller still starts it rather than leaving the rotation on the floor.
    expect(onCredentials).toHaveBeenCalledTimes(2);

    release();
    await expect(manager.get()).resolves.toMatchObject({ refreshToken: "refresh-b" });
    expect(onCredentials).toHaveBeenCalledTimes(2);
  });
});
