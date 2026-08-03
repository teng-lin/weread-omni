import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { type AuthRequestOptions, exchange, login, pollForCode, requestQr } from "../../src/auth/qrlogin.js";
import { AuthError, TransportError } from "../../src/errors.js";
import type { ClientProfile } from "../../src/profile.js";

const MAX_JSON_RESPONSE_BYTES = 16_777_216;

function nextResponse(responses: Response[]): Response {
  const response = responses.shift();
  if (!response) throw new Error("test response queue exhausted");
  return response;
}

const interruptedResponse = (cause: Error): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(cause);
      },
    }),
  );

const declaredOversizedResponse = (): Response =>
  new Response(new ReadableStream<Uint8Array>(), {
    headers: { "content-length": String(MAX_JSON_RESPONSE_BYTES + 1) },
  });

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

describe("WeChat QR login", () => {
  it("orchestrates ticket, confirmation, and e-ink exchange coherently", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const responses = [
      Response.json({ signature: "ticket-signature", timeStamp: "ticket-time" }),
      Response.json({ errcode: 0, uuid: "uuid-1" }),
      Response.json({ wx_errcode: 405, wx_code: "wx-code" }),
      Response.json({ vid: 123, accessToken: "access-token", refreshToken: "refresh-token" }),
    ];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      seen.push({ url: String(input), init: init ?? {} });
      return nextResponse(responses);
    });
    const onQr = vi.fn();
    const onStatus = vi.fn();

    const credentials = await login({ fetchImpl, onQr, onStatus });
    expect(credentials).toMatchObject({ vid: "123", accessToken: "access-token", refreshToken: "refresh-token" });
    expect(credentials.deviceId).toMatch(/^eink33\d{26}$/);
    expect(onQr).toHaveBeenCalledWith("https://open.weixin.qq.com/connect/confirm?uuid=uuid-1");
    expect(onStatus).toHaveBeenCalledWith("confirmed");

    expect(seen[0]?.url).toBe("https://i.weread.qq.com/wxticket?nonceStr=weread");
    expect(seen[1]?.url).toContain("open.weixin.qq.com/connect/sdk/qrconnect");
    const exchangeBody = JSON.parse(seen[3]?.init.body as string) as Record<string, unknown>;
    expect(exchangeBody).toMatchObject({
      code: "wx-code",
      deviceId: credentials.deviceId,
      deviceName: "BOOX",
      deviceType: 3,
    });
    expect(exchangeBody.installId).toMatch(/^eink31\d{26}$/);
    expect(exchangeBody).not.toHaveProperty("virtualChannelId");
    expect(exchangeBody).not.toHaveProperty("wxToken");
    expect(exchangeBody.signature).toBe(
      createHash("sha256")
        .update(`${exchangeBody.timestamp as number}${credentials.deviceId}${exchangeBody.random as number}`)
        .digest("hex"),
    );
    for (const index of [0, 1, 3]) {
      expect(new Headers(seen[index]?.init.headers).get("User-Agent")).toContain("WRBrand/Onyx wr_eink");
    }
  });

  it("resolves one supplied profile and uses it through ticket and exchange", async () => {
    let deviceIds = 0;
    let installIds = 0;
    const profile: ClientProfile = {
      versionHeaders: { "User-Agent": "private-profile", appver: "1" },
      deviceName: "private-device",
      deviceType: 7,
      authHeaders: ({ vid, accessToken }) => ({ vid, accessToken }),
      refreshSignature: () => "refresh-proof",
      loginBodyExtras: () => ({ privateField: "yes" }),
      newDeviceId: () => {
        deviceIds += 1;
        return "private-id";
      },
      newInstallId: () => {
        installIds += 1;
        return "private-install";
      },
    };
    const seen: RequestInit[] = [];
    const responses = [
      Response.json({ signature: "signature", timeStamp: 1 }),
      Response.json({ errcode: 0, uuid: "uuid" }),
      Response.json({ wx_errcode: 405, wx_code: "code" }),
      Response.json({ vid: "1", accessToken: "access", refreshToken: "refresh" }),
    ];
    await login({
      profile,
      fetchImpl: vi.fn<typeof fetch>(async (_input, init) => {
        seen.push(init ?? {});
        return nextResponse(responses);
      }),
    });
    expect(deviceIds).toBe(1);
    expect(installIds).toBe(1);
    expect(new Headers(seen[0]?.headers).get("User-Agent")).toBe("private-profile");
    const body = JSON.parse(seen[3]?.body as string);
    expect(body).toMatchObject({
      deviceId: "private-id",
      installId: "private-install",
      deviceName: "private-device",
      deviceType: 7,
      privateField: "yes",
    });
  });

  it("continues waiting statuses and reports scanning", async () => {
    const onStatus = vi.fn();
    const responses = [
      Response.json({ wx_errcode: 404 }),
      Response.json({ wx_errcode: 408 }),
      Response.json({ wx_errcode: 405, wx_code: "code" }),
    ];
    await expect(
      pollForCode(
        "uuid",
        vi.fn<typeof fetch>(async () => nextResponse(responses)),
        {
          pollDelayMs: 0,
          onStatus,
        },
      ),
    ).resolves.toBe("code");
    expect(onStatus).toHaveBeenNthCalledWith(1, "scanned");
    expect(onStatus).toHaveBeenNthCalledWith(2, "confirmed");
  });

  it.each([
    [402, /expired/],
    [403, /declined/],
    [499, /unknown status/],
  ])("rejects terminal poll status %s", async (status, message) => {
    await expect(
      pollForCode(
        "uuid",
        vi.fn<typeof fetch>(async () => Response.json({ wx_errcode: status })),
      ),
    ).rejects.toThrow(message);
  });

  it("bounds repeated waiting responses with the overall deadline", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 40));
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ wx_errcode: 408 }));
    await expect(pollForCode("uuid", fetchImpl, { deadlineMs: 100, pollDelayMs: 0 })).rejects.toBeInstanceOf(AuthError);
    expect(fetchImpl.mock.calls.length).toBeLessThan(5);
  });

  it("propagates caller cancellation as a transport failure", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );
    const pending = requestQr(fetchImpl, { signal: controller.signal });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(TransportError);
  });

  it.each([
    ["ticket socket reset", "WeRead QR ticket", [], new TypeError("terminated"), "network error"],
    [
      "qrconnect socket reset",
      "WeChat qrconnect",
      [Response.json({ signature: "s", timeStamp: 1 })],
      new TypeError("terminated"),
      "network error",
    ],
    ["ticket abort", "WeRead QR ticket", [], new DOMException("cancelled", "AbortError"), "request aborted"],
    [
      "qrconnect timeout",
      "WeChat qrconnect",
      [Response.json({ signature: "s", timeStamp: 1 })],
      new DOMException("deadline", "TimeoutError"),
      "request timed out",
    ],
  ])("classifies an interrupted %s body as a transport failure", async (_stage, label, prefix, cause, detail) => {
    const responses = [...prefix, interruptedResponse(cause)];
    await expect(requestQr(vi.fn<typeof fetch>(async () => nextResponse(responses)))).rejects.toMatchObject({
      name: TransportError.name,
      message: `${label}: ${detail}`,
      cause,
    });
  });

  it.each([
    ["ticket", "WeRead QR ticket", []],
    ["qrconnect", "WeChat qrconnect", [Response.json({ signature: "s", timeStamp: 1 })]],
  ])("keeps a fully received non-JSON %s body as an auth failure", async (_stage, label, prefix) => {
    const responses = [...prefix, new Response("<html>maintenance</html>")];
    await expect(requestQr(vi.fn<typeof fetch>(async () => nextResponse(responses)))).rejects.toMatchObject({
      name: AuthError.name,
      message: `${label} returned a non-JSON response`,
      cause: expect.any(SyntaxError),
    });
  });

  it.each([
    {
      label: "WeRead QR ticket",
      run: (response: Response) => requestQr(vi.fn<typeof fetch>(async () => response)),
    },
    {
      label: "WeChat qrconnect",
      run: (response: Response) => {
        const responses = [Response.json({ signature: "s", timeStamp: 1 }), response];
        return requestQr(vi.fn<typeof fetch>(async () => nextResponse(responses)));
      },
    },
    {
      label: "WeChat QR poll",
      run: (response: Response) =>
        pollForCode(
          "uuid",
          vi.fn<typeof fetch>(async () => response),
        ),
    },
    {
      label: "WeRead QR login",
      run: (response: Response) =>
        exchange(
          "code",
          "device",
          vi.fn<typeof fetch>(async () => response),
        ),
    },
  ])("rejects a declared oversized $label response with the operation label", async ({ label, run }) => {
    const error = await run(declaredOversizedResponse()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ message: `${label}: response exceeds ${MAX_JSON_RESPONSE_BYTES} bytes` });
    expect(error).not.toHaveProperty("cause");
  });

  it("keeps streamed QR overflow primary when cancellation cleanup fails", async () => {
    const cleanupFailure = new Error("cancel failed");
    const { cancel, response } = repeatingResponse(new Uint8Array(1024 * 1024), 17, cleanupFailure);
    const error = await requestQr(vi.fn<typeof fetch>(async () => response)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      message: `WeRead QR ticket: response exceeds ${MAX_JSON_RESPONSE_BYTES} bytes`,
    });
    expect(error).not.toHaveProperty("cause");
    expect(error).not.toBe(cleanupFailure);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects malformed ticket, connection, poll, and exchange responses", async () => {
    await expect(requestQr(vi.fn<typeof fetch>(async () => Response.json({})))).rejects.toThrow("ticket request");
    const connect = [Response.json({ signature: "s", timeStamp: 1 }), Response.json({ errcode: 7 })];
    await expect(requestQr(vi.fn<typeof fetch>(async () => nextResponse(connect)))).rejects.toThrow("qrconnect failed");
    await expect(
      pollForCode(
        "uuid",
        vi.fn<typeof fetch>(async () => Response.json({ wx_errcode: 405 })),
      ),
    ).rejects.toThrow("omitted wx_code");
    await expect(
      exchange(
        "code",
        "device",
        vi.fn<typeof fetch>(async () => Response.json({ errCode: -2 })),
      ),
    ).rejects.toThrow("failed");
  });

  it("classifies network failures at every stage", async () => {
    const offline = vi.fn<typeof fetch>(async () => {
      throw new Error("offline");
    });
    await expect(requestQr(offline)).rejects.toBeInstanceOf(TransportError);
    await expect(pollForCode("uuid", offline)).rejects.toBeInstanceOf(TransportError);
    await expect(exchange("code", "device", offline)).rejects.toBeInstanceOf(TransportError);
  });

  it("does not accept a device override", () => {
    // @ts-expect-error Identity overrides must use ClientProfile.
    const invalid: AuthRequestOptions = { device: {} };
    expect(invalid).toHaveProperty("device");
  });
});
