import { describe, expect, it, vi } from "vitest";

import { type MobileCallOptions, MobileClient, type MobileResponse } from "../../src/api/mobile.js";
import { publicAccountsModule } from "../../src/api/resources/public-accounts.js";
import type { MobileTransport } from "../../src/api/types.js";
import { TransportError, WeReadApiError } from "../../src/errors.js";

class RecordingTransport implements MobileTransport {
  readonly calls: Array<{ method: string; path: string; options: MobileCallOptions }> = [];
  readonly responses: unknown[] = [];
  failure?: unknown;

  async call<T = unknown>(method: string, path: string, options: MobileCallOptions = {}): Promise<MobileResponse<T>> {
    this.calls.push({ method, path, options });
    if (this.failure !== undefined) throw this.failure;
    return {
      status: 200,
      headers: new Headers(),
      body: (this.responses.shift() ?? {}) as T,
    };
  }
}

const tokenProvider = () => ({
  get: vi.fn(async () => ({ vid: "1", accessToken: "access", refreshToken: "refresh" })),
});

describe("public-account resources", () => {
  it("takes one shelf snapshot, filters exact account IDs before paging, and preserves shelf fields", async () => {
    const transport = new RecordingTransport();
    transport.responses.push({
      books: [
        { bookId: "MP_WXS_1", title: "One", fixtureUnknown: "kept" },
        { bookId: "book" },
        { bookId: "MP_WXS_bad", title: "Invalid" },
        { bookId: "MP_WXS_2", title: "Two" },
      ],
    });

    const page = await publicAccountsModule(transport).subscriptions({ count: 1, offset: 1 });

    expect(page).toEqual({
      accounts: [{ bookId: "MP_WXS_2", accountId: "MP_WXS_2", title: "Two" }],
      returnedCount: 1,
      requestedOffset: 1,
      totalCount: 2,
    });
    expect(transport.calls).toEqual([{ method: "GET", path: "/shelf/sync", options: { signal: undefined } }]);

    transport.responses.push({ books: [{ bookId: "MP_WXS_3", fixtureUnknown: "kept" }] });
    const preserved = await publicAccountsModule(transport).subscriptions();
    expect((preserved.accounts[0] as unknown as Record<string, unknown>).fixtureUnknown).toBe("kept");
  });

  it("rejects unsafe paging before the shelf request", async () => {
    const transport = new RecordingTransport();

    await expect(
      publicAccountsModule(transport).subscriptions({ offset: Number.MAX_SAFE_INTEGER, count: 1 }),
    ).rejects.toThrow("offset + count");
    expect(transport.calls).toHaveLength(0);
  });

  it("maps article listing fields, preserves the envelope, and normalizes cursors", async () => {
    const transport = new RecordingTransport();
    const signal = new AbortController().signal;
    // A full page: three requested, three returned, so paging continues from offset 10.
    transport.responses.push({
      data: [{ reviewId: "review-1", fixtureUnknown: "kept" }, { reviewId: "review-2" }, { reviewId: "review-3" }],
      synckey: 9,
      hasMore: 1,
      fixtureEnvelope: "kept",
      nextSynckey: 999,
    });

    const page = await publicAccountsModule(transport).articles("MP_WXS_123", {
      count: 3,
      offset: 7,
      signal,
    });

    expect(page).toMatchObject({
      accountId: "MP_WXS_123",
      returnedCount: 3,
      requestedOffset: 7,
      nextOffset: 10,
      // The upstream delta-sync token is surfaced unchanged; it is not a page cursor.
      synckey: 9,
      hasMore: 1,
      articles: [{ reviewId: "review-1", fixtureUnknown: "kept" }, { reviewId: "review-2" }, { reviewId: "review-3" }],
      fixtureEnvelope: "kept",
    });
    // The raw upstream cursor never reaches the public shape.
    expect("nextSynckey" in page).toBe(false);
    expect(transport.calls).toEqual([
      {
        method: "GET",
        path: "/mp/chapters",
        options: {
          query: { bookId: "MP_WXS_123", count: 3, offset: 7 },
          signal,
        },
      },
    ]);

    transport.responses.push({ data: [], synckey: Number.MAX_SAFE_INTEGER + 1, hasMore: true });
    const invalidCursor = await publicAccountsModule(transport).articles("MP_WXS_123");
    expect(invalidCursor).not.toHaveProperty("nextSynckey");
    expect(invalidCursor).not.toHaveProperty("hasMore");
  });

  it.each([{ body: {} }, { body: { data: null } }, { body: { data: "bad" } }])(
    "rejects a malformed article envelope: $body",
    async ({ body }) => {
      const transport = new RecordingTransport();
      transport.responses.push(body);

      await expect(publicAccountsModule(transport).articles("MP_WXS_1")).rejects.toMatchObject({
        path: "/mp/chapters",
        status: 200,
      });
    },
  );

  const invalidIds: Array<[string, (transport: RecordingTransport) => Promise<unknown>]> = [
    ["articles", (transport: RecordingTransport) => publicAccountsModule(transport).articles("bad")],
    ["subscribe", (transport: RecordingTransport) => publicAccountsModule(transport).subscribe("MP_WXS_bad")],
    ["unsubscribe", (transport: RecordingTransport) => publicAccountsModule(transport).unsubscribe("MP_WXS_1x")],
  ];

  it.each(invalidIds)("validates %s IDs before transport", async (_name, invoke) => {
    const transport = new RecordingTransport();

    await expect(Promise.resolve().then(() => invoke(transport))).rejects.toBeInstanceOf(TypeError);
    expect(transport.calls).toHaveLength(0);
  });

  it("delegates subscribe and unsubscribe once to the existing shelf resources", async () => {
    const transport = new RecordingTransport();
    const signal = new AbortController().signal;
    transport.responses.push({ success: 1 }, { success: 1 });

    await expect(publicAccountsModule(transport).subscribe("MP_WXS_7", { signal })).resolves.toEqual({
      success: 1,
    });
    await expect(publicAccountsModule(transport).unsubscribe("MP_WXS_7", { signal })).resolves.toEqual({
      success: 1,
    });
    expect(transport.calls).toEqual([
      {
        method: "POST",
        path: "/shelf/add",
        options: { body: { albumIds: [], archiveIds: [], bookIds: ["MP_WXS_7"] }, signal },
      },
      {
        method: "POST",
        path: "/shelf/delete",
        options: { body: { albumIds: [], archiveIds: [], bookIds: ["MP_WXS_7"] }, signal },
      },
    ]);
  });

  it("preserves an ambiguous shelf write failure without retrying", async () => {
    const transport = new RecordingTransport();
    const failure = new TransportError("write outcome unknown", { ambiguous: true });
    transport.failure = failure;

    await expect(publicAccountsModule(transport).subscribe("MP_WXS_7")).rejects.toBe(failure);
    expect(transport.calls).toHaveLength(1);
  });

  it("resolves one public article URL through the mobile review index", async () => {
    const transport = new RecordingTransport();
    const signal = new AbortController().signal;
    const url = "https://mp.weixin.qq.com/s/article";
    transport.responses.push({ reviewIds: [{ url, reviewId: "review-1" }] });

    await expect(publicAccountsModule(transport).resolveArticle(url, { signal })).resolves.toEqual({
      url,
      reviewId: "review-1",
    });
    expect(transport.calls).toEqual([
      {
        method: "POST",
        path: "/mp/getreviewid",
        options: { body: { urls: [url] }, idempotent: true, signal },
      },
    ]);
  });

  it.each([{}, { reviewIds: [] }, { reviewIds: [{}] }])("rejects an unresolved public article: %j", async (body) => {
    const transport = new RecordingTransport();
    transport.responses.push(body);

    await expect(
      publicAccountsModule(transport).resolveArticle("https://mp.weixin.qq.com/s/article"),
    ).rejects.toMatchObject({ path: "/mp/getreviewid", status: 200 });
  });

  it("asks the entitlement endpoint for one URL and returns the entries verbatim", async () => {
    const transport = new RecordingTransport();
    transport.responses.push({
      data: [{ url: "https://mp.weixin.qq.com/s?__biz=a&mid=1", content: "<p>body</p>", ispaid: true, fee: 300 }],
    });

    const paid = await publicAccountsModule(transport).paidContent("https://mp.weixin.qq.com/s?__biz=a&mid=1");

    expect(paid.entries).toEqual([
      { url: "https://mp.weixin.qq.com/s?__biz=a&mid=1", content: "<p>body</p>", ispaid: true, fee: 300 },
    ]);
    expect(transport.calls).toEqual([
      {
        method: "POST",
        path: "/mp/getpaidinfo",
        options: {
          body: { urls: ["https://mp.weixin.qq.com/s?__biz=a&mid=1"], need_content: true },
          idempotent: true,
          acceptArrayResponse: true,
          treatExpiredSessionAsBusinessError: true,
        },
      },
    ]);
  });

  it("accepts a bare array through the real parsed transport", async () => {
    const mobile = new MobileClient({
      tokenManager: tokenProvider(),
      fetchImpl: vi.fn(async () => Response.json([{ url: "https://mp.weixin.qq.com/s?id=1", ispaid: false }])),
    });

    const paid = await publicAccountsModule(mobile).paidContent("https://mp.weixin.qq.com/s?id=1");

    expect(paid.entries).toEqual([{ url: "https://mp.weixin.qq.com/s?id=1", ispaid: false }]);
  });

  it("surfaces this endpoint's -2012 without refreshing a valid session", async () => {
    const tokens = tokenProvider();
    const fetchImpl = vi.fn(async () => Response.json({ errCode: -2012, errMsg: "route-specific rejection" }));
    const mobile = new MobileClient({ tokenManager: tokens, fetchImpl });

    const error = await publicAccountsModule(mobile)
      .paidContent("https://mp.weixin.qq.com/s?id=1")
      .catch((cause) => cause);

    expect(error).toBeInstanceOf(WeReadApiError);
    expect(error).toMatchObject({ path: "/mp/getpaidinfo", status: 200, errCode: -2012 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(tokens.get).toHaveBeenCalledTimes(1);
  });

  it("treats an empty entitlement result as a failure rather than an empty article", async () => {
    const transport = new RecordingTransport();
    transport.responses.push({ data: [] });

    const error = await publicAccountsModule(transport)
      .paidContent("https://mp.weixin.qq.com/s?id=1")
      .catch((cause) => cause);

    expect(error).toBeInstanceOf(WeReadApiError);
    expect(error).toMatchObject({ path: "/mp/getpaidinfo" });
  });

  it("rejects a missing document URL before calling", async () => {
    const transport = new RecordingTransport();

    await expect(publicAccountsModule(transport).paidContent("")).rejects.toThrow();
    expect(transport.calls).toHaveLength(0);
  });

  it("attributes malformed article envelopes to the public-account endpoint", async () => {
    const transport = new RecordingTransport();
    transport.responses.push({});

    const error = await publicAccountsModule(transport)
      .articles("MP_WXS_1")
      .catch((cause) => cause);
    expect(error).toBeInstanceOf(WeReadApiError);
    expect(error).toMatchObject({ path: "/mp/chapters" });
  });
});
