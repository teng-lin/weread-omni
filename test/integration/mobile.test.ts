import { getEventListeners } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { MobileCallOptions } from "../../src/api/mobile.js";
import { MobileClient, type MobileClientOptions } from "../../src/api/mobile.js";
import { TokenManager } from "../../src/auth/token.js";
import { AuthError, TransportError, WeReadApiError } from "../../src/errors.js";

const MAX_JSON_RESPONSE_BYTES = 16_777_216;

function tokens() {
  return {
    get: vi.fn(async (force?: boolean) => ({
      vid: "123",
      accessToken: force ? "access-b" : "access-a",
      refreshToken: "refresh",
    })),
  };
}

function streamedResponse(chunks: Uint8Array[], contentLength?: string) {
  let index = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel,
  });
  return {
    cancel,
    response: new Response(body, {
      headers: contentLength === undefined ? undefined : { "content-length": contentLength },
    }),
  };
}

function repeatingResponse(
  chunk: Uint8Array,
  count: number,
  contentLength?: string,
  cancelImpl?: () => Promise<void>,
): { cancel: ReturnType<typeof vi.fn>; response: Response } {
  let emitted = 0;
  const cancel = vi.fn(cancelImpl ?? (async () => undefined));
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted < count) {
        emitted += 1;
        controller.enqueue(chunk);
      }
    },
    cancel,
  });
  return {
    cancel,
    response: new Response(body, {
      headers: contentLength === undefined ? undefined : { "content-length": contentLength },
    }),
  };
}

async function settleWithoutWaitingForCleanup<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("response handling waited for cleanup")), 250);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

describe("MobileClient", () => {
  it.each([
    "",
    "items",
    "@attacker.example",
    "https://attacker.example/items",
    "//attacker.example/items",
    "/\\attacker.example/items",
    "/..%2fitems",
  ])("rejects unsafe path %s before auth or fetch", async (path) => {
    const tokenManager = tokens();
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new MobileClient({ tokenManager, fetchImpl });
    await expect(client.call("GET", path)).rejects.toThrow(TypeError);
    expect(tokenManager.get).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects traversal that escapes a configured base path before auth or fetch", async () => {
    const tokenManager = tokens();
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new MobileClient({
      tokenManager,
      fetchImpl,
      baseUrl: "https://mobile.example.test/api/",
    });
    await expect(client.call("GET", "/%2e%2e/items")).rejects.toThrow(TypeError);
    expect(tokenManager.get).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("supports arbitrary safe paths, query values, request bodies, and a custom base", async () => {
    const debug = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        "https://mobile.example.test/api/library/items?count=2&active=false&accessToken=query-secret",
      );
      expect(init).toMatchObject({
        method: "POST",
        body: '{"name":"ink","refreshToken":"body-secret"}',
        redirect: "error",
      });
      const headers = new Headers(init?.headers);
      expect(headers.get("vid")).toBe("123");
      expect(headers.get("accessToken")).toBe("access-a");
      expect(headers.get("User-Agent")).toContain("WRBrand/Onyx wr_eink");
      expect(headers.get("content-type")).toBe("application/json; charset=UTF-8");
      return Response.json({ ok: true }, { headers: { "x-trace": "trace" } });
    });
    const client = new MobileClient({
      tokenManager: tokens(),
      fetchImpl,
      baseUrl: "https://mobile.example.test/api/",
      logger: { debug },
    });
    await expect(
      client.call("POST", "/library/items", {
        query: { count: 2, active: false, missing: undefined, accessToken: "query-secret" },
        body: { name: "ink", refreshToken: "body-secret" },
      }),
    ).resolves.toMatchObject({ status: 200, body: { ok: true } });
    const logs = debug.mock.calls.flat().join("\n");
    expect(logs).toContain('mobile POST "/library/items": started');
    expect(logs).toContain('mobile POST "/library/items": HTTP 200');
    expect(logs).not.toMatch(/query-secret|body-secret|access-a/);
  });

  it.each(["401", "-2012"] as const)("forces exactly one token refresh on %s", async (failure) => {
    const debug = vi.fn();
    const tokenManager = tokens();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        failure === "401"
          ? new Response("unauthorized", { status: 401 })
          : Response.json({ errCode: -2012, errMsg: "expired" }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const client = new MobileClient({ tokenManager, fetchImpl, logger: { debug } });
    await expect(client.call("GET", "/library/items")).resolves.toMatchObject({ body: { ok: true } });
    expect(tokenManager.get).toHaveBeenNthCalledWith(1, false, undefined);
    // Exactly one FORCED mint. The replay path also reads the cache first, to reuse a token a
    // concurrent caller may already have refreshed, so assert the count rather than a position.
    expect(tokenManager.get.mock.calls.filter(([force]) => force === true)).toHaveLength(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).not.toBe(fetchImpl.mock.calls[1]?.[1]?.signal);
    expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("accessToken")).toBe("access-b");
    expect(debug.mock.calls.flat().join("\n")).toContain("authentication rejected; refreshing for replay");
  });

  it("returns raw bytes and response headers", async () => {
    const client = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(
        async () => new Response(Uint8Array.from([1, 2, 3]), { headers: { "x-binary": "yes" } }),
      ),
    });
    const response = await client.callRaw("GET", "/binary");
    expect([...response.body]).toEqual([1, 2, 3]);
    expect(response.headers.get("x-binary")).toBe("yes");
  });

  it("retries a raw 401 once with a refreshed token", async () => {
    const tokenManager = tokens();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(Uint8Array.from([9])));
    const response = await new MobileClient({ tokenManager, fetchImpl }).callRaw("GET", "/binary");
    expect([...response.body]).toEqual([9]);
    expect(tokenManager.get.mock.calls.filter(([force]) => force === true)).toHaveLength(1);
  });

  it("does not offer a raw flag that would make the response type a lie", () => {
    // `call<Foo>(…, { raw: true })` used to type-check and resolve to a Uint8Array, because the
    // flag and the generic were independent. The byte path is `callRaw`, whose return type is
    // fixed; if `raw` ever returns to the options bag this directive goes unused and fails.
    // @ts-expect-error the byte path is callRaw(), not a flag on call()
    const invalid: MobileCallOptions = { raw: true };
    expect(invalid).toHaveProperty("raw");
  });

  it.each(["401", "-2012"] as const)("classifies a repeated %s as AuthError", async (failure) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      failure === "401"
        ? Response.json({ message: "unauthorized" }, { status: 401 })
        : Response.json({ errCode: -2012 }),
    );
    const rejection = new MobileClient({ tokenManager: tokens(), fetchImpl }).call("GET", "/items");
    await expect(rejection).rejects.toBeInstanceOf(AuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("normalizes response, protocol, parse, and network failures", async () => {
    const error = vi.fn();
    const responseFailure = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(async () => Response.json({ errCode: -9, errMsg: "response-secret" })),
      logger: { error },
    });
    await expect(
      responseFailure.call("GET", "/bad?inline=path-secret", { query: { accessToken: "query-secret" } }),
    ).rejects.toMatchObject({
      name: "WeReadApiError",
      status: 200,
      path: "/bad?inline=path-secret",
      errCode: -9,
    });
    expect(error).toHaveBeenCalledWith('mobile GET "/bad": failed');
    expect(error.mock.calls.flat().join("\n")).not.toMatch(/path-secret|query-secret|response-secret/);

    const malformed = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(async () => Response.json({ errCode: null })),
    });
    await expect(malformed.call("GET", "/bad")).rejects.toBeInstanceOf(WeReadApiError);

    const parse = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(async () => new Response("{")),
    });
    await expect(parse.call("GET", "/bad")).rejects.toMatchObject({ cause: expect.any(SyntaxError) });

    const network = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(async () => {
        throw new Error("offline");
      }),
    });
    await expect(network.call("GET", "/bad")).rejects.toBeInstanceOf(TransportError);
  });

  it("cancels before auth and cleans up the manual-composition listener after a request", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const tokenManager = tokens();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      new MobileClient({ tokenManager, fetchImpl }).call("GET", "/items", { signal: aborted.signal }),
    ).rejects.toBeInstanceOf(TransportError);
    expect(tokenManager.get).not.toHaveBeenCalled();

    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
    try {
      const controller = new AbortController();
      const client = new MobileClient({
        tokenManager: tokens(),
        fetchImpl: vi.fn<typeof fetch>(async () => Response.json({ ok: true })),
      });
      await client.call("GET", "/items", { signal: controller.signal });
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    } finally {
      if (descriptor) Object.defineProperty(AbortSignal, "any", descriptor);
      else Reflect.deleteProperty(AbortSignal, "any");
    }
  });

  it("does not accept a device override", () => {
    // @ts-expect-error Identity overrides must use ClientProfile.
    const invalid: MobileClientOptions = { tokenManager: tokens(), device: {} };
    expect(invalid).toHaveProperty("device");
  });
});

describe("MobileClient bounded raw responses", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects maxResponseBytes=%s before auth or fetch",
    async (maxResponseBytes) => {
      const tokenManager = tokens();
      const fetchImpl = vi.fn<typeof fetch>();
      const request = new MobileClient({ tokenManager, fetchImpl }).callRaw("GET", "/binary", {
        maxResponseBytes,
      });

      await expect(request).rejects.toThrow(/positive safe integer/);
      expect(tokenManager.get).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("accepts the exact limit and preserves status and headers", async () => {
    const client = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(
        async () =>
          new Response(Uint8Array.of(1, 2, 3), {
            status: 206,
            headers: { "content-length": "3", "x-binary": "yes" },
          }),
      ),
    });

    const response = await client.callRaw("GET", "/binary", { maxResponseBytes: 3 });
    expect(response.status).toBe(206);
    expect(response.body).toEqual(Uint8Array.of(1, 2, 3));
    expect(response.headers.get("x-binary")).toBe("yes");
  });

  it.each(["4", String(Number.MAX_SAFE_INTEGER + 1)])(
    "rejects declared Content-Length %s before opening a reader",
    async (contentLength) => {
      const upstream = new Response(Uint8Array.of(1, 2, 3, 4), {
        headers: { "content-length": contentLength },
      });
      const getReader = vi.spyOn(upstream.body as ReadableStream<Uint8Array>, "getReader");
      const cancel = vi.spyOn(upstream.body as ReadableStream<Uint8Array>, "cancel");
      const client = new MobileClient({
        tokenManager: tokens(),
        fetchImpl: vi.fn<typeof fetch>(async () => upstream),
      });

      await expect(client.callRaw("GET", "/binary", { maxResponseBytes: 3 })).rejects.toMatchObject({
        name: "WeReadApiError",
        path: "/binary",
        status: 200,
      });
      expect(getReader).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["absent", undefined],
    ["lying", "1"],
    ["non-digit", "4x"],
  ])("enforces the stream limit with %s Content-Length and cancels on multi-chunk overflow", async (_label, length) => {
    const { cancel, response } = streamedResponse([Uint8Array.of(1, 2), Uint8Array.of(3, 4), Uint8Array.of(5)], length);
    const client = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(async () => response),
    });

    await expect(client.callRaw("GET", "/binary", { maxResponseBytes: 3 })).rejects.toMatchObject({
      name: "WeReadApiError",
      path: "/binary",
      status: 200,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["401", "-2012"] as const)("keeps bounded raw %s refresh and replay", async (failure) => {
    const tokenManager = tokens();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        failure === "401" ? new Response(null, { status: 401 }) : Response.json({ errCode: -2012, errMsg: "expired" }),
      )
      .mockResolvedValueOnce(new Response(Uint8Array.of(9)));

    await expect(
      new MobileClient({ tokenManager, fetchImpl }).callRaw("GET", "/binary", { maxResponseBytes: 64 }),
    ).resolves.toMatchObject({ body: Uint8Array.of(9) });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(tokenManager.get.mock.calls.filter(([force]) => force === true)).toHaveLength(1);
  });

  it("preserves caller cancellation while reading a bounded body", async () => {
    const caller = new AbortController();
    let requestStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      if (!init?.signal) throw new Error("missing request signal");
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
        },
      });
      requestStarted();
      return new Response(body);
    });
    const request = new MobileClient({ tokenManager: tokens(), fetchImpl }).callRaw("GET", "/binary", {
      maxResponseBytes: 3,
      signal: caller.signal,
    });

    await started;
    caller.abort(new DOMException("client disconnected", "AbortError"));
    await expect(request).rejects.toBeInstanceOf(TransportError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("preserves the internal timeout while reading a bounded body", async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    let requestStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      if (!init?.signal) throw new Error("missing request signal");
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
        },
      });
      requestStarted();
      return new Response(body);
    });

    try {
      const request = new MobileClient({ tokenManager: tokens(), fetchImpl }).callRaw("GET", "/binary", {
        maxResponseBytes: 3,
      });
      await started;
      timeout.abort(new DOMException("deadline", "TimeoutError"));
      await expect(request).rejects.toMatchObject({
        name: "TransportError",
        message: expect.stringContaining("timed out"),
      });
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("keeps uncapped callRaw on the existing arrayBuffer path", async () => {
    const upstream = new Response(null, { headers: { "x-binary": "yes" } });
    const arrayBuffer = vi.fn(async () => Uint8Array.of(7, 8).buffer);
    Object.defineProperty(upstream, "arrayBuffer", { value: arrayBuffer });
    const client = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(async () => upstream),
    });

    const response = await client.callRaw("GET", "/binary");
    expect([...response.body]).toEqual([7, 8]);
    expect(response.headers.get("x-binary")).toBe("yes");
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });
});

describe("MobileClient bounded JSON responses", () => {
  it("accepts and parses a JSON object of exactly 16 MiB", async () => {
    const framingBytes = new TextEncoder().encode('{"value":""}').byteLength;
    const payload = `{"value":"${"a".repeat(MAX_JSON_RESPONSE_BYTES - framingBytes)}"}`;
    const bytes = new TextEncoder().encode(payload);
    expect(bytes.byteLength).toBe(MAX_JSON_RESPONSE_BYTES);
    const client = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(bytes)),
    });

    const response = await client.call<{ value: string }>("GET", "/items");
    expect(response.body.value).toHaveLength(MAX_JSON_RESPONSE_BYTES - framingBytes);
  });

  it.each([
    ["absent", undefined],
    ["underreported", "1"],
  ])("rejects and cancels a streamed JSON response with %s Content-Length", async (_label, contentLength) => {
    const { cancel, response } = repeatingResponse(new Uint8Array(1024 * 1024), 17, contentLength);
    const fetchImpl = vi.fn<typeof fetch>(async () => response);
    const client = new MobileClient({ tokenManager: tokens(), fetchImpl });

    await expect(client.call("GET", "/items")).rejects.toMatchObject({
      name: WeReadApiError.name,
      message: `mobile /items: response exceeds ${MAX_JSON_RESPONSE_BYTES} bytes (HTTP 200)`,
      path: "/items",
      status: 200,
      ambiguous: false,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("counts multibyte UTF-8 bytes rather than JavaScript characters", async () => {
    const charactersPerChunk = 1024;
    const chunk = new TextEncoder().encode("界".repeat(charactersPerChunk));
    const chunks = Math.floor(MAX_JSON_RESPONSE_BYTES / chunk.byteLength) + 1;
    expect(charactersPerChunk * chunks).toBeLessThan(MAX_JSON_RESPONSE_BYTES);
    expect(chunk.byteLength * chunks).toBeGreaterThan(MAX_JSON_RESPONSE_BYTES);
    const { response } = repeatingResponse(chunk, chunks);
    const client = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(async () => response),
    });

    await expect(client.call("GET", "/items")).rejects.toThrow(`response exceeds ${MAX_JSON_RESPONSE_BYTES} bytes`);
  });

  it("keeps overflow primary when stream cancellation fails", async () => {
    const cleanupFailure = new Error("cancel failed");
    const { cancel, response } = repeatingResponse(new Uint8Array(1024 * 1024), 17, "1", async () => {
      throw cleanupFailure;
    });
    const client = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(async () => response),
    });

    const error = await client.call("GET", "/items").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WeReadApiError);
    expect(error).toMatchObject({
      message: `mobile /items: response exceeds ${MAX_JSON_RESPONSE_BYTES} bytes (HTTP 200)`,
    });
    expect(error).not.toBe(cleanupFailure);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not wait for declared-overflow cancellation cleanup", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { "content-length": String(MAX_JSON_RESPONSE_BYTES + 1) },
    });
    const client = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(async () => response),
    });

    await expect(settleWithoutWaitingForCleanup(client.call("GET", "/items"))).rejects.toThrow(
      `response exceeds ${MAX_JSON_RESPONSE_BYTES} bytes`,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not wait for streamed-overflow cancellation cleanup", async () => {
    const cancelNeverSettles = () => new Promise<void>(() => undefined);
    const { cancel, response } = repeatingResponse(new Uint8Array(1024 * 1024), 17, "1", cancelNeverSettles);
    const client = new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(async () => response),
    });

    await expect(settleWithoutWaitingForCleanup(client.call("GET", "/items"))).rejects.toThrow(
      `response exceeds ${MAX_JSON_RESPONSE_BYTES} bytes`,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("MobileClient replay safety", () => {
  // A write that reaches the application tier and is committed can still come back 401
  // (stale session, gateway check, concurrent-session eviction). Replaying it duplicates
  // the write. The token changing proves nothing about whether the write landed.
  function committingServer(status: number, errCode?: number) {
    let effects = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      effects += 1;
      if (effects === 1) {
        return errCode === undefined
          ? new Response("{}", { status })
          : Response.json({ errCode, errmsg: "session expired" }, { status: 200 });
      }
      return Response.json({ ok: true });
    });
    return { fetchImpl, effects: () => effects };
  }

  it("refuses to replay a non-idempotent POST after a 401, even when the token changed", async () => {
    const warn = vi.fn();
    const error = vi.fn();
    const tokenManager = tokens();
    const { fetchImpl, effects } = committingServer(401);
    const client = new MobileClient({ tokenManager, fetchImpl, logger: { warn, error } });
    await expect(client.call("POST", "/review/add", { body: { content: "x" } })).rejects.toThrow(
      /outcome of this request is unknown/,
    );
    expect(effects()).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("request not replayed"));
    expect(error).toHaveBeenCalledWith('mobile POST "/review/add": failed');
  });

  it("refuses to replay a non-idempotent POST after errCode -2012 on HTTP 200", async () => {
    const tokenManager = tokens();
    const { fetchImpl, effects } = committingServer(200, -2012);
    const client = new MobileClient({ tokenManager, fetchImpl });
    await expect(client.call("POST", "/shelf/add", { body: { bookId: "b" } })).rejects.toThrow(
      /outcome of this request is unknown/,
    );
    expect(effects()).toBe(1);
  });

  it("marks the refused outcome as ambiguous so a caller can branch on it", async () => {
    const tokenManager = tokens();
    const { fetchImpl } = committingServer(401);
    const client = new MobileClient({ tokenManager, fetchImpl });
    const error = await client.call("POST", "/notes/addBookmark", { body: {} }).catch((caught) => caught);
    expect(error).toBeInstanceOf(WeReadApiError);
    expect((error as WeReadApiError).ambiguous).toBe(true);
  });

  it("still replays a GET after a 401", async () => {
    const tokenManager = tokens();
    const { fetchImpl, effects } = committingServer(401);
    const client = new MobileClient({ tokenManager, fetchImpl });
    await expect(client.call("GET", "/book/info")).resolves.toMatchObject({ body: { ok: true } });
    expect(effects()).toBe(2);
  });

  it("still replays a POST that opts in as idempotent", async () => {
    const tokenManager = tokens();
    const { fetchImpl, effects } = committingServer(401);
    const client = new MobileClient({ tokenManager, fetchImpl });
    await expect(
      client.call("POST", "/book/readreviews", { body: { reviews: [] }, idempotent: true }),
    ).resolves.toMatchObject({ body: { ok: true } });
    expect(effects()).toBe(2);
  });

  it("reuses a token another caller already refreshed instead of minting again", async () => {
    // I4: a late stale 401 must not start a fresh mint wave when the cache already moved on.
    let minted = 0;
    let issued = 0;
    const tokenManager = {
      get: vi.fn(async (force?: boolean) => {
        if (force) minted += 1;
        // The cache moves on between the first hand-out and the stale 401, as it would if a
        // concurrent caller had already refreshed.
        issued += 1;
        return { vid: "123", accessToken: issued === 1 ? "access-a" : "access-b", refreshToken: "refresh" };
      }),
    };
    const { fetchImpl } = committingServer(401);
    const client = new MobileClient({ tokenManager, fetchImpl });
    await expect(client.call("GET", "/book/info")).resolves.toMatchObject({ body: { ok: true } });
    expect(minted).toBe(0);
  });
});

describe("MobileClient response shape", () => {
  const client = (body: BodyInit | null, status = 200) =>
    new MobileClient({
      tokenManager: tokens(),
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(body, { status })),
    });

  it.each([
    ["null", "null"],
    ["a string", '"text"'],
    ["a number", "42"],
    ["a boolean", "true"],
  ])("rejects a 200 body that is %s", async (_label, payload) => {
    await expect(client(payload).call("GET", "/items")).rejects.toThrow(/malformed response body/);
  });

  it("rejects a 200 body that is an array, which typeof reports as an object", async () => {
    // Every curated operation is typed as an object envelope. An array satisfied
    // `typeof body === "object"`, and at the two seams whose fields are all optional
    // (`readData.detail`, `ai.suggest`) it then passed every downstream guard: the caller received
    // an array typed as the response interface, with every field `undefined` and no signal at all.
    await expect(client("[1,2]").call("GET", "/items")).rejects.toThrow(/malformed response body/);
    await expect(client("[]").call("GET", "/items")).rejects.toMatchObject({
      name: "WeReadApiError",
      status: 200,
      path: "/items",
    });
  });

  it("still accepts an object body, including one whose fields are arrays", async () => {
    // The rejection is of an array *envelope*, not of arrays. Widening it to any body containing
    // one would break most of the API.
    await expect(client("{}").call("GET", "/items")).resolves.toMatchObject({ body: {} });
    await expect(client('{"items":[1,2]}').call("GET", "/items")).resolves.toMatchObject({
      body: { items: [1, 2] },
    });
  });

  it("does not reject an array body on the byte path, which has no envelope contract", async () => {
    // `callRaw` returns bytes; a JSON array there is just an asset that happens to parse.
    const response = await client("[1,2]").callRaw("GET", "/items");
    expect(new TextDecoder().decode(response.body)).toBe("[1,2]");
  });

  it("does not let the shape check pre-empt the auth refresh", async () => {
    // The check must sit below the replay branches: a 401 whose body is JSON null still has to
    // refresh the token, not fail as a malformed body.
    const tokenManager = tokens();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("null", { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(new MobileClient({ tokenManager, fetchImpl }).call("GET", "/items")).resolves.toMatchObject({
      body: { ok: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("MobileClient refresh economy", () => {
  it("does not force a mint when refusing a write if the cache already moved on", async () => {
    // Several late write rejections arriving after another caller refreshed would otherwise each
    // force a fresh mint, and every mint can rotate and persist credentials.
    let minted = 0;
    let issued = 0;
    const tokenManager = {
      get: vi.fn(async (force?: boolean) => {
        if (force) minted += 1;
        issued += 1;
        return { vid: "1", accessToken: issued === 1 ? "access-a" : "access-b", refreshToken: "r" };
      }),
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 401 }));
    const client = new MobileClient({ tokenManager, fetchImpl });
    await expect(client.call("POST", "/review/add", { body: {} })).rejects.toThrow(/outcome of this request/);
    expect(minted).toBe(0);
  });
});

/**
 * The token lookup runs *before* the request's own signal has anything to act on, so unless it
 * is threaded explicitly a caller that aborts during a mint still waits the mint out.
 */
describe("MobileClient cancellation scope", () => {
  it("threads the caller's signal into the token lookup, not only into the fetch", async () => {
    const tokenManager = tokens();
    const caller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    await new MobileClient({ tokenManager, fetchImpl }).call("GET", "/items", { signal: caller.signal });
    expect(tokenManager.get).toHaveBeenCalledWith(false, caller.signal);
  });

  it("keeps the post-401 refresh inside the same cancellation scope", async () => {
    const tokenManager = tokens();
    const caller = new AbortController();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    await new MobileClient({ tokenManager, fetchImpl }).call("GET", "/items", { signal: caller.signal });
    expect(tokenManager.get).toHaveBeenCalledWith(true, caller.signal);
  });

  it("threads a signal through the identity read", async () => {
    const tokenManager = tokens();
    const caller = new AbortController();
    await expect(new MobileClient({ tokenManager, fetchImpl: vi.fn<typeof fetch>() }).vid(caller.signal)).resolves.toBe(
      "123",
    );
    expect(tokenManager.get).toHaveBeenCalledWith(false, caller.signal);
  });

  it("fails a request that is still waiting on a token mint, before the API is ever called", async () => {
    // The whole point of C2: with the mint outside the cancellation scope this test hangs for
    // the mint's duration and only then reports the abort.
    let releaseMint: () => void = () => undefined;
    const mintGate = new Promise<void>((resolve) => {
      releaseMint = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/login")) {
        await mintGate;
        return Response.json({ vid: "123", accessToken: "access", refreshToken: "refresh" });
      }
      return Response.json({ ok: true });
    });
    const tokenManager = new TokenManager({ vid: "123", refreshToken: "refresh", deviceId: "device" }, { fetchImpl });
    const caller = new AbortController();

    const call = new MobileClient({ tokenManager, fetchImpl }).call("GET", "/items", { signal: caller.signal });
    const rejection = expect(call).rejects.toBeInstanceOf(TransportError);
    caller.abort(new DOMException("client disconnected", "AbortError"));
    await rejection;

    // Only the mint was ever attempted — the operation itself never went out.
    expect(fetchImpl.mock.calls.filter(([input]) => !String(input).endsWith("/login"))).toHaveLength(0);
    releaseMint();
    // …and the mint that the aborted caller was sharing still completes for everybody else.
    await expect(tokenManager.get()).resolves.toMatchObject({ accessToken: "access" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
