import { describe, expect, it, vi } from "vitest";
import { MobileClient } from "../../src/api/mobile.js";
import { AuthError, TransportError, WeReadApiError } from "../../src/errors.js";

const MAX_JSON_RESPONSE_BYTES = 16_777_216;

// Transport internals that the main MobileClient suite does not reach: how a business error code
// is read out of a response, what the raw (byte) path does with an auth rejection, and what the
// replay refusal reports when the token refresh it promises to perform also fails.

function tokens() {
  return {
    get: vi.fn(async (force?: boolean) => ({
      vid: "123",
      accessToken: force ? "access-b" : "access-a",
      refreshToken: "refresh",
    })),
  };
}

const clientFor = (fetchImpl: typeof fetch, tokenManager = tokens()) => new MobileClient({ tokenManager, fetchImpl });

const respondWith = (body: BodyInit | null, status = 200): typeof fetch =>
  vi.fn<typeof fetch>(async () => new Response(body, { status }));

const interruptedResponse = (cause: unknown): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(cause);
      },
    }),
  );

/** Headers arrive, then the body read fails — the outcome is unknown from here on. */
const bodyReadFails = (): typeof fetch =>
  vi.fn<typeof fetch>(async () => {
    const response = new Response(Uint8Array.of(1));
    Object.defineProperty(response, "arrayBuffer", {
      value: () => Promise.reject(new Error("socket closed mid-body")),
    });
    return response;
  });

describe("MobileClient identity", () => {
  it("reads the vid from the token manager without issuing a request", async () => {
    const tokenManager = tokens();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(clientFor(fetchImpl, tokenManager).vid()).resolves.toBe("123");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("MobileClient error-code parsing", () => {
  it("accepts a numeric-string errCode and treats it as the business code", async () => {
    await expect(
      clientFor(respondWith(JSON.stringify({ errCode: "-9", errMsg: "nope" }))).call("GET", "/x"),
    ).rejects.toMatchObject({ name: "WeReadApiError", errCode: -9 });
  });

  it("replays once when the expiry code arrives as a lower-case string key", async () => {
    const tokenManager = tokens();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ errcode: "-2012" }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(clientFor(fetchImpl, tokenManager).call("GET", "/x")).resolves.toMatchObject({ body: { ok: true } });
    expect(tokenManager.get.mock.calls.filter(([force]) => force === true)).toHaveLength(1);
  });

  it.each([
    ["a non-numeric string", JSON.stringify({ errCode: "not-a-number" })],
    ["an empty string", JSON.stringify({ errCode: "" })],
    ["an object", JSON.stringify({ errCode: {} })],
    ["not finite", JSON.stringify({ errCode: null })],
  ])("rejects a body whose errCode is %s rather than guessing", async (_label, payload) => {
    await expect(clientFor(respondWith(payload)).call("GET", "/x")).rejects.toThrow(/malformed errCode/);
  });

  it("still reports an HTTP failure when the body carries no message at all", async () => {
    // `null` is a valid JSON body: the error message must fall back to the status rather than
    // throwing while trying to read `errMsg` off it.
    await expect(clientFor(respondWith("null", 500)).call("GET", "/x")).rejects.toMatchObject({
      name: "WeReadApiError",
      status: 500,
      message: expect.stringContaining("HTTP 500"),
    });
  });

  it("does not let an unreadable errCode block the one permitted refresh of a 401", async () => {
    // The 401 branch reads the body's code only to attach it to the refusal. A malformed code
    // there must not pre-empt the refresh, or a recoverable session becomes a hard failure.
    const tokenManager = tokens();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ errCode: {} }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(clientFor(fetchImpl, tokenManager).call("GET", "/x")).resolves.toMatchObject({ body: { ok: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("MobileClient raw responses", () => {
  it("classifies a raw 401 that survives the refresh as an AuthError", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(Uint8Array.of(1), { status: 401 }));
    await expect(clientFor(fetchImpl).callRaw("GET", "/binary")).rejects.toBeInstanceOf(AuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports a non-OK raw response as a WeReadApiError carrying the status", async () => {
    await expect(clientFor(respondWith(Uint8Array.of(1), 503)).callRaw("GET", "/binary")).rejects.toMatchObject({
      name: "WeReadApiError",
      status: 503,
      path: "/binary",
    });
  });

  it("normalizes a failure while reading the raw bytes into a TransportError", async () => {
    await expect(clientFor(bodyReadFails()).callRaw("GET", "/binary")).rejects.toBeInstanceOf(TransportError);
  });
});

// WeRead reports failure as HTTP 200 with a negative errCode, so the byte path cannot return on
// `response.ok` alone: before this, a raw download with an expired session resolved to a
// "successful" JSON error envelope and the token was never re-minted.
describe("MobileClient raw business codes", () => {
  it.each([
    ["space", "\x20"],
    ["tab", "\x09"],
    ["carriage return", "\x0d"],
    ["line feed", "\x0a"],
  ])("detects an error envelope preceded by JSON %s", async (_label, prefix) => {
    await expect(
      clientFor(respondWith(`${prefix}${JSON.stringify({ errCode: -9, errMsg: "no such book" })}`)).callRaw(
        "GET",
        "/book/cover",
      ),
    ).rejects.toMatchObject({ name: "WeReadApiError", errCode: -9 });
  });

  it("re-mints and replays a raw call whose HTTP 200 body carries the expiry code", async () => {
    const tokenManager = tokens();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ errCode: -2012, errMsg: "expired" })))
      .mockResolvedValueOnce(new Response(Uint8Array.from([7, 8])));
    const response = await clientFor(fetchImpl, tokenManager).callRaw("GET", "/book/cover");
    expect([...response.body]).toEqual([7, 8]);
    expect(tokenManager.get.mock.calls.filter(([force]) => force === true)).toHaveLength(1);
  });

  it("re-mints and replays a whitespace-prefixed raw expiry envelope", async () => {
    const tokenManager = tokens();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(` \t\r\n${JSON.stringify({ errCode: -2012 })}`))
      .mockResolvedValueOnce(new Response(Uint8Array.from([7, 8])));
    const response = await clientFor(fetchImpl, tokenManager).callRaw("GET", "/book/cover");
    expect([...response.body]).toEqual([7, 8]);
    expect(tokenManager.get.mock.calls.filter(([force]) => force === true)).toHaveLength(1);
  });

  it("classifies a raw expiry code that survives the refresh as an AuthError", async () => {
    const fetchImpl = respondWith(JSON.stringify({ errCode: -2012 }));
    await expect(clientFor(fetchImpl).callRaw("GET", "/book/cover")).rejects.toBeInstanceOf(AuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports any other business code on a raw call instead of returning the envelope as bytes", async () => {
    await expect(
      clientFor(respondWith(JSON.stringify({ errCode: -9, errMsg: "no such book" }))).callRaw("GET", "/book/cover"),
    ).rejects.toMatchObject({ name: "WeReadApiError", status: 200, errCode: -9, message: /no such book/ });
  });

  it("hands back a binary body that merely starts with a brace, rather than parsing it", async () => {
    // The envelope test is on the bytes, not on content-type, so it has to survive an asset whose
    // first byte happens to be `{`: the payload is not valid UTF-8 JSON, so it stays an asset.
    const asset = Uint8Array.from([0x7b, 0xff, 0xfe, 0x00, 0x01]);
    const response = await clientFor(respondWith(asset)).callRaw("GET", "/book/cover");
    expect([...response.body]).toEqual([...asset]);
  });

  it("hands back a JSON-looking body that is not an envelope, rather than failing on it", async () => {
    const notJson = new TextEncoder().encode("{not json at all");
    const response = await clientFor(respondWith(notJson)).callRaw("GET", "/book/cover");
    expect([...response.body]).toEqual([...notJson]);
  });

  it("still returns the bytes of an envelope that reports success", async () => {
    const ok = new TextEncoder().encode(JSON.stringify({ errCode: 0, data: "x" }));
    const response = await clientFor(respondWith(ok)).callRaw("GET", "/book/cover");
    expect(new TextDecoder().decode(response.body)).toBe(JSON.stringify({ errCode: 0, data: "x" }));
  });

  it("still returns a JSON array as raw bytes rather than treating it as an envelope", async () => {
    const array = new TextEncoder().encode("[1,2]");
    const response = await clientFor(respondWith(array)).callRaw("GET", "/book/cover");
    expect([...response.body]).toEqual([...array]);
  });
});

describe("MobileClient HTTP 401 body ordering", () => {
  const unread401 = (releaseFailure?: Error) => {
    const cancel = vi.fn(async () => {
      if (releaseFailure) throw releaseFailure;
    });
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 401 });
    const getReader = vi.spyOn(response.body as ReadableStream<Uint8Array>, "getReader");
    const arrayBuffer = vi.fn(() => Promise.reject(new Error("401 byte parser called")));
    Object.defineProperties(response, {
      arrayBuffer: { value: arrayBuffer },
    });
    return { response, cancel, getReader, arrayBuffer };
  };

  it.each(["parsed", "raw"] as const)("releases an unread 401 before replaying a safe %s request", async (mode) => {
    const tokenManager = tokens();
    const first = unread401();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(mode === "parsed" ? Response.json({ ok: true }) : new Response(Uint8Array.of(1)));
    const client = clientFor(fetchImpl, tokenManager);
    await expect(mode === "parsed" ? client.call("GET", "/x") : client.callRaw("GET", "/x")).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(first.getReader).not.toHaveBeenCalled();
    expect(first.arrayBuffer).not.toHaveBeenCalled();
    expect(first.cancel.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      tokenManager.get.mock.invocationCallOrder[1] ?? 0,
    );
    expect(tokenManager.get.mock.calls.filter(([force]) => force === true)).toHaveLength(1);
  });

  it("still refuses an unsafe request when releasing its unread 401 fails", async () => {
    const tokenManager = tokens();
    const first = unread401(new Error("release failed"));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(first.response);
    const error = await clientFor(fetchImpl, tokenManager)
      .call("POST", "/review/add", { body: { content: "x" } })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WeReadApiError);
    expect((error as WeReadApiError).ambiguous).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(first.getReader).not.toHaveBeenCalled();
    expect(first.arrayBuffer).not.toHaveBeenCalled();
    expect(first.cancel.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      tokenManager.get.mock.invocationCallOrder[1] ?? 0,
    );
    expect(tokenManager.get.mock.calls.filter(([force]) => force === true)).toHaveLength(1);
  });
});

// A write whose outcome is unknown is not an ordinary failure: the caller cannot tell whether the
// review it POSTed landed. `ambiguous` says so — and says nothing at all when the outcome IS
// knowable, because a caller who learns to ignore the flag is worse off than one who never had it.
describe("MobileClient unknown write outcomes", () => {
  const lostAfterSend = (): typeof fetch =>
    vi.fn<typeof fetch>(async () => {
      throw new DOMException("late", "TimeoutError");
    });

  const ambiguityOf = async (call: Promise<unknown>): Promise<{ error: unknown; ambiguous: unknown }> => {
    const error = await call.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    return { error, ambiguous: (error as { ambiguous?: unknown }).ambiguous };
  };

  it("marks a write that was lost in flight, because it may still have landed", async () => {
    const fetchImpl = lostAfterSend();
    const { error, ambiguous } = await ambiguityOf(
      clientFor(fetchImpl).call("POST", "/review/add", { body: { content: "x" } }),
    );
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).message).toContain("request timed out");
    expect(ambiguous).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("leaves a timed-out GET unmarked — it is safe to repeat, so nothing is ambiguous", async () => {
    const { error, ambiguous } = await ambiguityOf(clientFor(lostAfterSend()).call("GET", "/book/info"));
    expect(error).toBeInstanceOf(TransportError);
    expect(ambiguous).toBe(false);
  });

  it("leaves a POST that opted in as idempotent unmarked", async () => {
    const { ambiguous } = await ambiguityOf(
      clientFor(lostAfterSend()).call("POST", "/book/readreviews", { body: { reviews: [] }, idempotent: true }),
    );
    expect(ambiguous).toBe(false);
  });

  it("leaves a write cancelled before it was ever sent unmarked", async () => {
    // The outcome of a request that never left is known: it did not happen. Marking it would be
    // the over-marking that turns the flag into noise.
    const aborted = new AbortController();
    aborted.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    const { error, ambiguous } = await ambiguityOf(
      clientFor(fetchImpl).call("POST", "/review/add", { body: {}, signal: aborted.signal }),
    );
    expect(error).toBeInstanceOf(TransportError);
    expect(ambiguous).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "parsed JSON HTTP 5xx",
      response: () => respondWith(JSON.stringify({ message: "gateway failed" }), 503),
      call: (client: MobileClient) => client.call("POST", "/review/add", { body: {} }),
    },
    {
      name: "parsed JSON HTTP 5xx with a success business code",
      response: () => respondWith(JSON.stringify({ errCode: 0 }), 503),
      call: (client: MobileClient) => client.call("POST", "/review/add", { body: {} }),
    },
    {
      name: "parsed non-JSON HTTP 2xx",
      response: () => respondWith("<html>gateway</html>"),
      call: (client: MobileClient) => client.call("POST", "/review/add", { body: {} }),
    },
    {
      name: "parsed non-JSON HTTP 5xx",
      response: () => respondWith("<html>gateway</html>", 503),
      call: (client: MobileClient) => client.call("POST", "/review/add", { body: {} }),
    },
    {
      name: "malformed business code",
      response: () => respondWith(JSON.stringify({ errCode: {} })),
      call: (client: MobileClient) => client.call("POST", "/review/add", { body: {} }),
    },
    {
      name: "raw malformed business code",
      response: () => respondWith(JSON.stringify({ errCode: {} })),
      call: (client: MobileClient) => client.callRaw("POST", "/cos/notify", { body: {} }),
    },
    {
      name: "malformed success envelope",
      response: () => respondWith("null"),
      call: (client: MobileClient) => client.call("POST", "/review/add", { body: {} }),
    },
    {
      name: "raw HTTP 5xx",
      response: () => respondWith(Uint8Array.of(1), 503),
      call: (client: MobileClient) => client.callRaw("POST", "/cos/notify", { body: {} }),
    },
    {
      name: "declared oversized parsed JSON response",
      response: () =>
        vi.fn<typeof fetch>(
          async () =>
            new Response(new ReadableStream<Uint8Array>(), {
              headers: { "content-length": String(MAX_JSON_RESPONSE_BYTES + 1) },
            }),
        ),
      call: (client: MobileClient) => client.call("POST", "/review/add", { body: {} }),
    },
    {
      name: "declared oversized raw response",
      response: () =>
        vi.fn<typeof fetch>(
          async () =>
            new Response(Uint8Array.of(1, 2, 3, 4), {
              headers: { "content-length": "4" },
            }),
        ),
      call: (client: MobileClient) => client.callRaw("POST", "/cos/notify", { body: {}, maxResponseBytes: 3 }),
    },
    {
      name: "streamed oversized raw response",
      response: () =>
        vi.fn<typeof fetch>(
          async () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(Uint8Array.of(1, 2));
                  controller.enqueue(Uint8Array.of(3, 4));
                  controller.close();
                },
              }),
            ),
        ),
      call: (client: MobileClient) => client.callRaw("POST", "/cos/notify", { body: {}, maxResponseBytes: 3 }),
    },
  ])("marks an unsafe write with a $name as ambiguous without replaying it", async ({ response, call }) => {
    const fetchImpl = response();
    const { error, ambiguous } = await ambiguityOf(call(clientFor(fetchImpl)));
    expect(error).toBeInstanceOf(WeReadApiError);
    expect(ambiguous).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "a parsed definite HTTP 4xx",
      response: () => respondWith("{}", 400),
      call: (client: MobileClient) => client.call("POST", "/review/add", { body: {} }),
    },
    {
      name: "a raw definite HTTP 4xx",
      response: () => respondWith(Uint8Array.of(1), 400),
      call: (client: MobileClient) => client.callRaw("POST", "/cos/notify", { body: {} }),
    },
    {
      name: "a parsed explicit non-auth business rejection on HTTP 5xx",
      response: () => respondWith(JSON.stringify({ errCode: -9, errMsg: "rejected" }), 503),
      call: (client: MobileClient) => client.call("POST", "/review/add", { body: {} }),
    },
    {
      name: "a raw explicit non-auth business rejection on HTTP 5xx",
      response: () => respondWith(JSON.stringify({ errCode: -9, errMsg: "rejected" }), 503),
      call: (client: MobileClient) => client.callRaw("POST", "/cos/notify", { body: {} }),
    },
  ])("leaves $name unambiguous", async ({ response, call }) => {
    const fetchImpl = response();
    const { error, ambiguous } = await ambiguityOf(call(clientFor(fetchImpl)));
    expect(error).toBeInstanceOf(WeReadApiError);
    expect(ambiguous).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ["GET", "GET", false],
    ["HEAD", "HEAD", false],
    ["an explicitly idempotent POST", "POST", true],
  ] as const)("leaves %s response failures unambiguous", async (_label, method, idempotent) => {
    const fetchImpl = respondWith(JSON.stringify({ message: "gateway failed" }), 503);
    const { error, ambiguous } = await ambiguityOf(
      clientFor(fetchImpl).call(method, "/review/add", idempotent ? { body: {}, idempotent: true } : undefined),
    );
    expect(error).toBeInstanceOf(WeReadApiError);
    expect(ambiguous).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns a raw HTTP 2xx body for an unsafe write", async () => {
    const fetchImpl = respondWith(Uint8Array.of(7, 8));
    await expect(clientFor(fetchImpl).callRaw("POST", "/cos/notify", { body: {} })).resolves.toMatchObject({
      body: Uint8Array.of(7, 8),
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("marks a write whose response body was cut off after the headers arrived", async () => {
    const aborted = new Error("The operation was aborted");
    aborted.name = "AbortError";
    const fetchImpl = vi.fn<typeof fetch>(async () => interruptedResponse(aborted));
    const { ambiguous } = await ambiguityOf(clientFor(fetchImpl).call("POST", "/review/add", { body: {} }));
    expect(ambiguous).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("marks a raw write whose bytes were cut off after the headers arrived", async () => {
    const fetchImpl = bodyReadFails();
    const { ambiguous } = await ambiguityOf(clientFor(fetchImpl).callRaw("POST", "/cos/notify", { body: {} }));
    expect(ambiguous).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  // A socket reset mid-body is the motivating case, and it is not an abort or a timeout: undici
  // surfaces it as a bare `TypeError`. The two body paths have to classify it identically — the
  // same lost POST cannot be ambiguous on one and an ordinary failure on the other.
  const jsonReadFailsWith = (cause: unknown): typeof fetch =>
    vi.fn<typeof fetch>(async () => interruptedResponse(cause));

  const socketReset = () => new TypeError("terminated");

  it("marks a write whose body was cut off by a socket reset, not just by an abort", async () => {
    const fetchImpl = jsonReadFailsWith(socketReset());
    const { error, ambiguous } = await ambiguityOf(
      clientFor(fetchImpl).call("POST", "/review/add", { body: { content: "x" } }),
    );
    expect(error).toBeInstanceOf(TransportError);
    expect(ambiguous).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("classifies a socket reset identically on the JSON and the byte path", async () => {
    const jsonFetch = jsonReadFailsWith(socketReset());
    const byteFetch = bodyReadFails();
    const viaJson = await ambiguityOf(clientFor(jsonFetch).call("POST", "/review/add", { body: { content: "x" } }));
    const viaBytes = await ambiguityOf(clientFor(byteFetch).callRaw("POST", "/review/add", { body: {} }));
    expect(viaJson.error).toBeInstanceOf(TransportError);
    expect(viaBytes.error).toBeInstanceOf(TransportError);
    expect(viaJson.ambiguous).toBe(viaBytes.ambiguous);
    expect(viaJson.ambiguous).toBe(true);
    expect(jsonFetch).toHaveBeenCalledOnce();
    expect(byteFetch).toHaveBeenCalledOnce();
  });

  it("leaves a GET cut off by a socket reset unmarked — replaying it is safe", async () => {
    const { error, ambiguous } = await ambiguityOf(
      clientFor(jsonReadFailsWith(socketReset())).call("GET", "/book/info"),
    );
    expect(error).toBeInstanceOf(TransportError);
    expect(ambiguous).toBe(false);
  });

  it("marks a complete non-JSON response to a write as ambiguous", async () => {
    // Complete transport delivery proves only that the response arrived. An unusable response
    // still cannot say whether the application committed the write.
    const fetchImpl = respondWith("<html>gateway</html>");
    const { error, ambiguous } = await ambiguityOf(clientFor(fetchImpl).call("POST", "/review/add", { body: {} }));
    expect(error).toBeInstanceOf(WeReadApiError);
    expect(ambiguous).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("MobileClient body-read cancellation", () => {
  it("reports a cancelled body read as a transport failure, not a protocol failure", async () => {
    // A timeout that lands between the headers and the body must not be reported as "the server
    // sent something that was not JSON" — the caller retries those very differently.
    const aborted = new Error("The operation was aborted");
    aborted.name = "AbortError";
    const fetchImpl = vi.fn<typeof fetch>(async () => interruptedResponse(aborted));
    await expect(clientFor(fetchImpl).call("GET", "/x")).rejects.toBeInstanceOf(TransportError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("MobileClient replay refusal reporting", () => {
  // Refusing to replay a write still promises to refresh the session so the caller's NEXT request
  // works. When that refresh also fails, the promise is false and the refusal has to say so.
  const refusedWrite = (tokenManager: { get: ReturnType<typeof vi.fn> }) =>
    clientFor(respondWith("{}", 401), tokenManager as never).call("POST", "/review/add", { body: { content: "x" } });

  it("attaches the refresh failure as the cause when the forced mint also fails", async () => {
    const mintFailure = new Error("refresh token rejected");
    const tokenManager = {
      get: vi.fn(async (force?: boolean) => {
        if (force) throw mintFailure;
        return { vid: "1", accessToken: "access-a", refreshToken: "r" };
      }),
    };
    const error = await refusedWrite(tokenManager).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WeReadApiError);
    expect((error as WeReadApiError).ambiguous).toBe(true);
    expect((error as { cause?: unknown }).cause).toBe(mintFailure);
  });

  it("still forces one mint when even the cached read fails, and reports that failure", async () => {
    // The cache probe exists only to avoid a redundant mint. If it throws, the refresh must still
    // be attempted rather than skipped on the strength of a failed lookup.
    const cacheFailure = new Error("token cache unavailable");
    const tokenManager = {
      get: vi.fn(async (force?: boolean) => {
        if (force === true) throw cacheFailure;
        if (tokenManager.get.mock.calls.length > 1) throw cacheFailure;
        return { vid: "1", accessToken: "access-a", refreshToken: "r" };
      }),
    };
    const error = await refusedWrite(tokenManager).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WeReadApiError);
    expect((error as { cause?: unknown }).cause).toBe(cacheFailure);
    expect(tokenManager.get.mock.calls.filter(([force]) => force === true)).toHaveLength(1);
  });
});
