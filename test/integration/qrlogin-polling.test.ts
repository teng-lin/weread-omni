import { describe, expect, it, vi } from "vitest";
import { exchange, pollForCode } from "../../src/auth/qrlogin.js";
import { AuthError, TransportError } from "../../src/errors.js";

// The QR poll is a long-lived loop the user is waiting on. Its cancellation and deadline
// behaviour is what decides whether `weread-omni login` can be interrupted, and whether a login that
// will never complete says so instead of spinning — neither is visible from the happy path.

const wx = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("QR poll waiting", () => {
  it("waits between polls while WeChat reports nothing yet", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(wx({ wx_errcode: 408 }))
      .mockResolvedValueOnce(wx({ wx_errcode: 405, wx_code: "wx-code" }));

    await expect(pollForCode("uuid", fetchImpl, { pollDelayMs: 1 })).resolves.toBe("wx-code");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // The second request carries the previous status so WeChat can long-poll from it.
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("last=408");
  });

  it("reports the scan before the confirmation, in order", async () => {
    const statuses: string[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(wx({ wx_errcode: 404 }))
      .mockResolvedValueOnce(wx({ wx_errcode: 405, wx_code: "wx-code" }));

    await pollForCode("uuid", fetchImpl, { pollDelayMs: 1, onStatus: (status) => void statuses.push(status) });
    expect(statuses).toEqual(["scanned", "confirmed"]);
  });

  it("stops waiting as soon as the caller cancels, without another request", async () => {
    const controller = new AbortController();
    const reason = new Error("user pressed ctrl-c");
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      // Cancel while the loop is between polls, which is where it spends nearly all its time.
      queueMicrotask(() => controller.abort(reason));
      return wx({ wx_errcode: 408 });
    });

    const rejection = pollForCode("uuid", fetchImpl, { pollDelayMs: 60_000, signal: controller.signal });
    await expect(rejection).rejects.toBeInstanceOf(TransportError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuses to start a poll on an already-cancelled signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled before starting"));
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(pollForCode("uuid", fetchImpl, { signal: controller.signal })).rejects.toBeInstanceOf(TransportError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("QR poll failure reporting", () => {
  it("calls an exhausted deadline a login timeout rather than a network fault", async () => {
    // The per-request timeout fires because the overall deadline is what ran out. Reporting that
    // as a transport error sends the user chasing their network instead of rerunning login.
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      // Outlive the deadline, then fail the way an aborted request does.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    });

    await expect(pollForCode("uuid", fetchImpl, { deadlineMs: 10, pollDelayMs: 1 })).rejects.toThrow(
      /QR login timed out/,
    );
  });

  it("stops once the deadline passes even if WeChat keeps answering", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => wx({ wx_errcode: 408 }));
    await expect(pollForCode("uuid", fetchImpl, { deadlineMs: 5, pollDelayMs: 1 })).rejects.toThrow(
      /QR login timed out/,
    );
  });

  it("reports an HTTP failure from the poll endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => wx({}, 502));
    await expect(pollForCode("uuid", fetchImpl)).rejects.toThrow(/QR poll failed: HTTP 502/);
  });

  it.each([
    ["expired", 402, /QR expired/],
    ["declined", 403, /declined in WeChat/],
    ["unrecognized", 499, /unknown status/],
  ])("classifies a %s poll result", async (_label, code, message) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => wx({ wx_errcode: code }));
    await expect(pollForCode("uuid", fetchImpl)).rejects.toThrow(message);
  });

  it("rejects a confirmation that carries no code", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => wx({ wx_errcode: 405, wx_code: "" }));
    await expect(pollForCode("uuid", fetchImpl)).rejects.toThrow(/omitted wx_code/);
  });
});

describe("QR credential exchange validation", () => {
  const exchangeWith = (body: unknown): Promise<unknown> =>
    exchange(
      "wx-code",
      "0123456789abcdef0123456789abcdef",
      vi.fn<typeof fetch>(async () => wx(body)),
    );

  it("rejects an identity field that is present but empty", async () => {
    await expect(exchangeWith({ vid: "", accessToken: "access", refreshToken: "refresh" })).rejects.toThrow(
      /empty vid/,
    );
  });

  it("rejects an identity field that is not a scalar", async () => {
    await expect(exchangeWith({ vid: { id: 1 }, accessToken: "access", refreshToken: "refresh" })).rejects.toThrow(
      /non-scalar vid/,
    );
  });

  it("accepts a numeric vid and normalizes it to a string", async () => {
    await expect(exchangeWith({ vid: 4242, accessToken: "access", refreshToken: "refresh" })).resolves.toMatchObject({
      vid: "4242",
      accessToken: "access",
    });
  });

  it.each([null, [], 1])("rejects an unusable response body %#", async (body) => {
    await expect(exchangeWith(body)).rejects.toBeInstanceOf(AuthError);
  });

  it.each([undefined, "", 1])("rejects an unusable access token %#", async (accessToken) => {
    await expect(exchangeWith({ vid: "1", accessToken, refreshToken: "refresh" })).rejects.toBeInstanceOf(AuthError);
  });

  it("reports a non-JSON response as an auth failure", async () => {
    await expect(
      exchange(
        "wx-code",
        "0123456789abcdef0123456789abcdef",
        vi.fn<typeof fetch>(async () => new Response("<html>maintenance</html>")),
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
