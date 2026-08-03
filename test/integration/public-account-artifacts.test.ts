import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { open as openFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WeReadClient } from "../../src/api/client.js";
import type {
  PublicAccountArticlesPage,
  PublicAccountCursorTerminal,
  ReviewSingleResponse,
} from "../../src/api/types.js";
import { AuthError, WeReadApiError } from "../../src/errors.js";
import {
  buildPublicAccountFeed,
  exportPublicAccountArchive,
  PublicAccountArtifactError,
  publishPublicAccountFeed,
} from "../../src/public-accounts.js";
import { expectPosixMode } from "../support/posix.js";

const LONG_TEXT = "article body ".repeat(30);

vi.mock("@teng-lin/agent-fetch", () => ({
  extractFromHtml: vi.fn((html: string) => {
    const text = html.includes("SHORT") ? "short" : LONG_TEXT;
    return {
      content: `<article>&lt;clean&gt; ${text}</article>`,
      textContent: text,
      markdown: `# ${text}`,
      isAccessibleForFree: !html.includes("PAYWALL"),
    };
  }),
  htmlToMarkdown: vi.fn((html: string) => html.replace(/<[^>]+>/g, "")),
}));

const directories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function page(
  accountId: string,
  articles: PublicAccountArticlesPage["articles"],
  extra: Partial<PublicAccountArticlesPage> = {},
): PublicAccountArticlesPage {
  return {
    accountId,
    articles,
    returnedCount: articles.length,
    requestedOffset: 0,
    ...extra,
  };
}

function fakeClient(options: {
  pages: Record<string, PublicAccountArticlesPage>;
  details?: Record<string, ReviewSingleResponse | Error>;
  accounts?: Array<{ accountId: string; bookId: string; title?: string }>;
  /** Keyed by the doc URL the entitlement endpoint is asked about. */
  paid?: Record<string, { entries: Array<Record<string, unknown>> } | Error>;
}) {
  let active = 0;
  let maxActive = 0;
  const subscriptions = vi.fn(async () => ({
    accounts: options.accounts ?? [],
    returnedCount: options.accounts?.length ?? 0,
    requestedOffset: 0,
    totalCount: options.accounts?.length ?? 0,
  }));
  const articles = vi.fn(async (accountId: string, request: { offset?: number } = {}) => {
    const cursor = request.offset ?? 0;
    const result = options.pages[`${accountId}:${cursor}`];
    if (!result) throw new Error(`missing fixture page ${accountId}:${cursor}`);
    return { ...result, requestedOffset: cursor };
  });
  const single = vi.fn(async (reviewId: string) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    const result = options.details?.[reviewId] ?? { review: {} };
    if (result instanceof Error) throw result;
    return result;
  });
  const paidContent = vi.fn(async (docUrl: string) => {
    const result = options.paid?.[docUrl];
    if (result === undefined)
      throw new WeReadApiError("mobile /mp/getpaidinfo: no entry for the requested article", {
        status: 200,
        path: "/mp/getpaidinfo",
      });
    if (result instanceof Error) throw result;
    return result;
  });
  return {
    value: {
      publicAccounts: { subscriptions, articles, paidContent },
      review: { single },
    } as unknown as WeReadClient,
    subscriptions,
    articles,
    single,
    paidContent,
    maxActive: () => maxActive,
  };
}

const detail = (reviewId: string, account: string, time: number, suffix = reviewId): ReviewSingleResponse => ({
  review: {
    reviewId,
    createTime: time,
    mpInfo: {
      originalId: `original-${reviewId}`,
      doc_url: `https://mp.weixin.qq.com/s?id=${suffix}`,
      title: `Title ${reviewId}`,
      mp_name: account,
      time,
    },
  },
});

/** A listing detail whose `payType` marks the article as protected. */
const paidDetail = (reviewId: string, account: string, time: number): ReviewSingleResponse => {
  const base = detail(reviewId, account, time);
  return { review: { ...base.review, mpInfo: { ...base.review?.mpInfo, payType: 2 } } };
};

describe("public-account feed collection", () => {
  it("snapshots subscriptions once, deduplicates globally, resolves two at a time, and sorts deterministically", async () => {
    const sdk = fakeClient({
      accounts: [
        { accountId: "MP_WXS_1", bookId: "MP_WXS_1", title: "One" },
        { accountId: "MP_WXS_2", bookId: "MP_WXS_2", title: "Two" },
      ],
      pages: {
        "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "review-r2" }, { reviewId: "review-shared" }], {
          nextOffset: 2,
          hasMore: 1,
        }),
        "MP_WXS_1:2": page("MP_WXS_1", [{ reviewId: "review-r1" }], { hasMore: 0 }),
        "MP_WXS_2:0": page("MP_WXS_2", [{ reviewId: "review-shared" }, { reviewId: "review-r3" }], { hasMore: 0 }),
      },
      details: {
        "review-r1": detail("review-r1", "One", 100),
        "review-r2": detail("review-r2", "One", 200),
        "review-r3": {
          review: {
            ...detail("review-r3", "Two", 300).review,
            mpInfo: {
              ...detail("review-r3", "Two", 300).review?.mpInfo,
              title: "Title </title><evil>&",
            },
          },
        },
        "review-shared": detail("review-shared", "One", 200),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`<html>${LONG_TEXT}</html>`)),
    );

    const result = await buildPublicAccountFeed(sdk.value, { kind: "subscriptions" }, { format: "json", limit: 10 });
    const feed = JSON.parse(result.content) as {
      version: string;
      items: Array<{
        id: string;
        title: string;
        content_html: string;
        _weread_account: { id: string; name: string };
      }>;
    };

    expect(sdk.subscriptions).toHaveBeenCalledOnce();
    expect(sdk.articles).toHaveBeenCalledTimes(3);
    expect(sdk.articles.mock.calls).toEqual([
      ["MP_WXS_1", { count: 10, signal: undefined }],
      ["MP_WXS_1", { count: 8, offset: 2, signal: undefined }],
      ["MP_WXS_2", { count: 10, signal: undefined }],
    ]);
    expect(sdk.single).toHaveBeenCalledTimes(4);
    expect(sdk.maxActive()).toBe(2);
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed.items.map(({ id }) => id)).toEqual(["review-r3", "review-r2", "review-shared", "review-r1"]);
    expect(feed.items[0]).toMatchObject({
      title: "Title </title><evil>&",
      content_html: expect.stringContaining("&lt;clean&gt;"),
      _weread_account: { id: "MP_WXS_2", name: "Two" },
    });
    expect(result.cursors).toEqual([
      { accountId: "MP_WXS_1", requestedOffset: 2, terminal: "explicit" },
      { accountId: "MP_WXS_2", requestedOffset: 0, terminal: "explicit" },
    ]);

    for (const format of ["rss", "atom"] as const) {
      const xml = await buildPublicAccountFeed(sdk.value, { kind: "subscriptions" }, { format, limit: 10 });
      expect(xml.content).toMatch(/^<\?xml/);
      expect(xml.content).toContain("review-r3");
      expect(xml.content).toContain("MP_WXS_2");
      expect(xml.content).toContain("<![CDATA[Title </title><evil>&]]>");
      expect(xml.itemCount).toBe(4);
    }
  });

  it.each([
    {
      terminal: "empty",
      pages: { "MP_WXS_1:0": page("MP_WXS_1", []) },
      limit: 20,
    },
    {
      terminal: "explicit",
      pages: { "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "r1" }], { hasMore: 0 }) },
      limit: 20,
    },
    {
      terminal: "missing_cursor",
      pages: { "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "r1" }]) },
      limit: 20,
    },
    {
      // A full page keeps paging alive; the next page repeats ids already collected, so nothing is
      // added and the walk stops rather than requesting for ever.
      terminal: "duplicate_only",
      pages: {
        "MP_WXS_1:0": page(
          "MP_WXS_1",
          Array.from({ length: 20 }, (_unused, index) => ({ reviewId: `r${index}` })),
          { hasMore: 1, nextOffset: 20 },
        ),
        "MP_WXS_1:20": page("MP_WXS_1", [{ reviewId: "r0" }, { reviewId: "r1" }], { hasMore: 1 }),
      },
      limit: 25,
    },
    {
      terminal: "limit",
      pages: { "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "r1" }], { nextOffset: 1, hasMore: 1 }) },
      limit: 1,
    },
  ] as Array<{
    terminal: PublicAccountCursorTerminal;
    pages: Record<string, PublicAccountArticlesPage>;
    limit: number;
  }>)("terminates collection at $terminal", async ({ terminal, pages, limit }) => {
    const sdk = fakeClient({ pages });

    const result = await buildPublicAccountFeed(
      sdk.value,
      { kind: "account", accountId: "MP_WXS_1" },
      { format: "json", limit },
    );

    expect(result.cursors[0]?.terminal).toBe(terminal);
  });

  it("rejects malformed sources, invalid limits, aborts, and authentication failures", async () => {
    const sdk = fakeClient({
      pages: { "MP_WXS_1:0": page("MP_WXS_1", []) },
    });
    await expect(buildPublicAccountFeed(sdk.value, null as never, { format: "json" })).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(
      buildPublicAccountFeed(sdk.value, { kind: "account", accountId: "MP_WXS_1" }, { format: "json", limit: 101 }),
    ).rejects.toThrow("limit");
    expect(sdk.articles).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(
      buildPublicAccountFeed(
        sdk.value,
        { kind: "account", accountId: "MP_WXS_1" },
        { format: "json", signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    const denied = fakeClient({
      pages: {
        "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "r1" }], { hasMore: 0 }),
      },
      details: { r1: new AuthError("credentials expired") },
    });
    await expect(
      buildPublicAccountFeed(denied.value, { kind: "account", accountId: "MP_WXS_1" }, { format: "json" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("turns unavailable article details into diagnostics without failing the feed", async () => {
    const sdk = fakeClient({
      pages: {
        "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "r1" }], { hasMore: 0 }),
      },
      details: {
        r1: new WeReadApiError("gone", { status: 404, path: "/review/single" }),
      },
    });

    const result = await buildPublicAccountFeed(
      sdk.value,
      { kind: "account", accountId: "MP_WXS_1" },
      { format: "json" },
    );

    expect(result.itemCount).toBe(0);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ARTICLE_UNAVAILABLE",
        reviewId: "r1",
        status: 404,
        path: "/review/single",
      }),
    );
  });

  it("fetches MP content directly with only the exact E-Ink identity header", async () => {
    const sdk = fakeClient({
      pages: {
        "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "r1" }], { hasMore: 0 }),
      },
      details: { r1: detail("r1", "One", 1) },
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://mp.weixin.qq.com/s?id=r1");
      const headers = new Headers(init?.headers);
      expect(headers.get("accept")).toBe("text/html,application/xhtml+xml");
      expect(headers.get("user-agent")).toBe(
        "WeRead/2.1.2 WRBrand/Onyx wr_eink Dalvik/2.1.0 (Linux; U; Android 11; BOOX Build/onyx)",
      );
      for (const forbidden of ["vid", "accessToken", "baseapi", "appver", "basever", "osver", "channelId"]) {
        expect(headers.has(forbidden)).toBe(false);
      }
      return new Response(`<html>${LONG_TEXT}</html>`);
    });
    vi.stubGlobal("fetch", fetchImpl);

    const result = await buildPublicAccountFeed(
      sdk.value,
      { kind: "account", accountId: "MP_WXS_1" },
      { format: "json" },
    );

    expect(result.itemCount).toBe(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects an abort during source fetching without attempting fallback", async () => {
    const sdk = fakeClient({
      pages: {
        "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "r1" }], { hasMore: 0 }),
      },
      details: { r1: detail("r1", "One", 1) },
    });
    let entered = (): void => {};
    const fetching = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          entered();
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const controller = new AbortController();
    const result = buildPublicAccountFeed(
      sdk.value,
      { kind: "account", accountId: "MP_WXS_1" },
      { format: "json", signal: controller.signal },
    );
    await fetching;
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("protected public-account articles", () => {
  // `payType` 2 is the only marker distinguishing a protected article from an ordinary one, and the
  // entitlement endpoint is the only way to read its body. These cover the four outcomes.

  it("serves the entitled body from the entitlement endpoint without downloading the page", async () => {
    const sdk = fakeClient({
      pages: { "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "review-paid" }], { hasMore: 0 }) },
      details: { "review-paid": paidDetail("review-paid", "One", 100) },
      paid: {
        "https://mp.weixin.qq.com/s?id=review-paid": {
          entries: [
            { url: "https://mp.weixin.qq.com/s?id=review-paid", content: `<html>${LONG_TEXT}</html>`, ispaid: true },
          ],
        },
      },
    });
    const download = vi.fn(async () => new Response("<html>SHORT</html>"));
    vi.stubGlobal("fetch", download);

    const result = await buildPublicAccountFeed(
      sdk.value,
      { kind: "account", accountId: "MP_WXS_1" },
      { format: "json", limit: 1 },
    );

    expect(sdk.paidContent).toHaveBeenCalledWith("https://mp.weixin.qq.com/s?id=review-paid", expect.anything());
    // The authorized HTML is the content, so the public URL is never fetched at all.
    expect(download).not.toHaveBeenCalled();
    const feed = JSON.parse(result.content) as { items: Array<{ content_html: string }> };
    expect(feed.items[0]?.content_html).toContain("&lt;clean&gt;");
  });

  it("accepts a short entitled body without falling back to the public preview", async () => {
    const sdk = fakeClient({
      pages: { "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "review-paid" }], { hasMore: 0 }) },
      details: { "review-paid": paidDetail("review-paid", "One", 100) },
      paid: {
        "https://mp.weixin.qq.com/s?id=review-paid": {
          entries: [{ content: "<html>SHORT</html>", ispaid: true }],
        },
      },
    });
    const download = vi.fn(async () => new Response("<html>public preview</html>"));
    vi.stubGlobal("fetch", download);

    const result = await buildPublicAccountFeed(
      sdk.value,
      { kind: "account", accountId: "MP_WXS_1" },
      { format: "json", limit: 1 },
    );

    expect(download).not.toHaveBeenCalled();
    expect(JSON.parse(result.content).items[0].content_html).toContain("short");
  });

  it("downloads the substitute URL upstream offers when the account is not entitled", async () => {
    const sdk = fakeClient({
      pages: { "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "review-paid" }], { hasMore: 0 }) },
      details: { "review-paid": paidDetail("review-paid", "One", 100) },
      paid: {
        "https://mp.weixin.qq.com/s?id=review-paid": {
          entries: [{ url: "https://mp.weixin.qq.com/s?id=preview", ispaid: false, fee: 300 }],
        },
      },
    });
    const download = vi.fn(async () => new Response(`<html>${LONG_TEXT}</html>`));
    vi.stubGlobal("fetch", download);

    await buildPublicAccountFeed(sdk.value, { kind: "account", accountId: "MP_WXS_1" }, { format: "json", limit: 1 });

    expect(download).toHaveBeenCalledOnce();
    expect(String((download.mock.calls[0] as unknown[])[0])).toBe("https://mp.weixin.qq.com/s?id=preview");
  });

  it("falls back to the public URL and reports why when the entitlement lookup fails", async () => {
    const sdk = fakeClient({
      pages: { "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "review-paid" }], { hasMore: 0 }) },
      details: { "review-paid": paidDetail("review-paid", "One", 100) },
      paid: {
        "https://mp.weixin.qq.com/s?id=review-paid": new WeReadApiError("risk control (-2041)", {
          status: 200,
          path: "/mp/getpaidinfo",
          errCode: -2041,
        }),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`<html>${LONG_TEXT}</html>`)),
    );

    const putArticle = vi.fn(async () => undefined);
    const result = await buildPublicAccountFeed(
      sdk.value,
      { kind: "account", accountId: "MP_WXS_1" },
      {
        format: "json",
        limit: 1,
        library: { getArticle: vi.fn(async () => undefined), putArticle },
      },
    );

    // A swallowed lookup failure would make a preview indistinguishable from an entitled read.
    expect(result.diagnostics.map(({ message }) => message)).toContainEqual(
      expect.stringContaining("paid article lookup failed"),
    );
    expect(result.diagnostics.map(({ message }) => message)).toContainEqual(expect.stringContaining("paywall preview"));
    expect(putArticle).not.toHaveBeenCalled();
  });

  it("never asks the entitlement endpoint about an ordinary article", async () => {
    const sdk = fakeClient({
      pages: { "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "review-free" }], { hasMore: 0 }) },
      details: { "review-free": detail("review-free", "One", 100) },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`<html>${LONG_TEXT}</html>`)),
    );

    await buildPublicAccountFeed(sdk.value, { kind: "account", accountId: "MP_WXS_1" }, { format: "json", limit: 1 });

    expect(sdk.paidContent).not.toHaveBeenCalled();
  });
});

describe("public-account source and archive artifacts", () => {
  it("accepts the #rd suffix WeChat puts on every article link, and drops it from the request", async () => {
    // Rejecting any fragment turned away every real article: `doc_url` ends in "#rd". A fragment
    // is never sent to the server, so it cannot change where the request goes.
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      requested.push(String(input));
      return new Response(`<html>${LONG_TEXT}</html>`, { status: 200, headers: { "content-type": "text/html" } });
    });
    const sdk = fakeClient({
      pages: { "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "r0" }], { hasMore: 0 }) },
      details: {
        r0: {
          review: {
            reviewId: "r0",
            createTime: 1,
            mpInfo: { doc_url: "https://mp.weixin.qq.com/s?__biz=abc&mid=1&idx=1&sn=deadbeef#rd", title: "T" },
          },
        },
      },
    });

    const result = await exportPublicAccountArchive(sdk.value, "MP_WXS_1", {
      directory: join(temporaryDirectory("weread-frag-"), "a"),
      limit: 1,
    });

    expect(result.manifest.unsupportedCount).toBe(0);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("sn=deadbeef");
    expect(requested[0]).not.toContain("#");
  });

  it("rejects disallowed source URLs before fetch", async () => {
    const urls = [
      "http://mp.weixin.qq.com/s?id=1",
      "https://user:pass@mp.weixin.qq.com/s?id=2",
      "https://@mp.weixin.qq.com/s?id=empty-credentials",
      "https://mp.weixin.qq.com:444/s?id=3",
      "https://mp.weixin.qq.com/not-s?id=5",
    ];
    const pages = {
      "MP_WXS_1:0": page(
        "MP_WXS_1",
        urls.map((_, index) => ({ reviewId: `r${index}` })),
        { hasMore: 0 },
      ),
    };
    const details = Object.fromEntries(
      urls.map((url, index) => [
        `r${index}`,
        { review: { reviewId: `r${index}`, mpInfo: { doc_url: url, title: `r${index}` } } },
      ]),
    );
    const sdk = fakeClient({ pages, details });
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const result = await buildPublicAccountFeed(
      sdk.value,
      { kind: "account", accountId: "MP_WXS_1" },
      { format: "json" },
    );

    expect(result.itemCount).toBe(0);
    expect(result.diagnostics).toHaveLength(urls.length);
    expect(result.diagnostics.every(({ code }) => code === "SOURCE_URL_INVALID")).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates redirect targets and enforces redirect, byte, and timeout limits", async () => {
    const run = async (fetchImpl: typeof fetch) => {
      vi.stubGlobal("fetch", vi.fn(fetchImpl));
      const sdk = fakeClient({
        pages: {
          "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "r1" }], { hasMore: 0 }),
        },
        details: { r1: detail("r1", "One", 1) },
      });
      return buildPublicAccountFeed(sdk.value, { kind: "account", accountId: "MP_WXS_1" }, { format: "json" });
    };

    let allowedRedirects = 0;
    const allowed = await run(async () => {
      if (allowedRedirects < 3) {
        allowedRedirects += 1;
        return new Response(null, {
          status: 302,
          headers: { location: `/s?id=allowed-${allowedRedirects}` },
        });
      }
      return new Response(`<html>${LONG_TEXT}</html>`);
    });
    expect(allowed.itemCount).toBe(1);
    expect(allowedRedirects).toBe(3);

    let redirected = 0;
    const tooMany = await run(async () => {
      redirected += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://mp.weixin.qq.com/s?id=redirect-${redirected}` },
      });
    });
    expect(tooMany.diagnostics).toContainEqual(expect.objectContaining({ code: "SOURCE_REDIRECT_LIMIT" }));
    expect(redirected).toBe(4);

    for (const location of ["https://example.com/article", "https://@mp.weixin.qq.com/s?id=bad"]) {
      const invalid = await run(async () => new Response(null, { status: 302, headers: { location } }));
      expect(invalid.diagnostics).toContainEqual(expect.objectContaining({ code: "SOURCE_REDIRECT_INVALID" }));
    }

    const wechatChallenge = await run(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?target=masked" },
        }),
    );
    expect(wechatChallenge.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "SOURCE_WECHAT_CHALLENGE",
        message: expect.stringContaining("browser"),
      }),
    );

    const tooLarge = await run(
      async () => new Response("", { headers: { "content-length": String(10 * 1024 * 1024 + 1) } }),
    );
    expect(tooLarge.diagnostics).toContainEqual(expect.objectContaining({ code: "SOURCE_TOO_LARGE" }));
    const streamedTooLarge = await run(async () => new Response(new Uint8Array(10 * 1024 * 1024 + 1)));
    expect(streamedTooLarge.diagnostics).toContainEqual(expect.objectContaining({ code: "SOURCE_TOO_LARGE" }));

    let serverErrorCalls = 0;
    const serverError = await run(async () => {
      serverErrorCalls += 1;
      return new Response("failed", { status: 500 });
    });
    expect(serverError.diagnostics).toContainEqual(expect.objectContaining({ code: "SOURCE_HTTP_ERROR" }));
    expect(serverErrorCalls).toBe(1);

    const cloudflare = await run(
      async () => new Response("blocked", { status: 403, headers: { server: "cloudflare", "cf-ray": "test" } }),
    );
    expect(cloudflare.itemCount).toBe(0);
    expect(cloudflare.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "SOURCE_CLOUDFLARE_CHALLENGE",
        message: expect.stringContaining("browser"),
      }),
    );

    const challengedHtml = await run(
      async () =>
        new Response(
          "<html><title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/x'></script></html>",
        ),
    );
    expect(challengedHtml.diagnostics).toContainEqual(expect.objectContaining({ code: "SOURCE_CLOUDFLARE_CHALLENGE" }));

    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    const timedOut = await run(async (_input, init) => {
      throw init?.signal?.reason;
    });
    expect(timedOut.diagnostics[0]?.code).toBe("SOURCE_TIMEOUT");
  });

  it("writes private, lossless archives and marks complete, paywall, and unsupported states", async () => {
    const parent = temporaryDirectory("weread-public-archive-");
    const destination = join(parent, "archive");
    const completeBytes = Uint8Array.from([...new TextEncoder().encode(`<html>${LONG_TEXT}</html>`), 0xff]);
    const directHtml = `<html>DIRECT ${LONG_TEXT}</html>`;
    const directBytes = new TextEncoder().encode(directHtml);
    const sdk = fakeClient({
      pages: {
        "MP_WXS_1:0": page(
          "MP_WXS_1",
          [{ reviewId: "complete" }, { reviewId: "direct" }, { reviewId: "paywall" }, { reviewId: "unsupported" }],
          { hasMore: 0 },
        ),
      },
      details: {
        complete: detail("complete", "One", 4, "complete"),
        direct: detail("direct", "One", 3, "direct"),
        paywall: detail("paywall", "One", 2, "paywall"),
        unsupported: {
          review: {
            reviewId: "unsupported",
            mpInfo: { doc_url: "http://mp.weixin.qq.com/s?id=unsupported", title: "Unsupported" },
          },
        },
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const id = new URL(String(input)).searchParams.get("id");
      if (id === "complete") return new Response(completeBytes);
      if (id === "direct") return new Response(directBytes);
      if (id === "paywall") return new Response("<html>SHORT 付费后阅读</html>");
      throw new Error(`unexpected fetch ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchImpl);

    const result = await exportPublicAccountArchive(sdk.value, "MP_WXS_1", {
      directory: destination,
      limit: 4,
    });

    expect(result.manifest).toMatchObject({
      accountId: "MP_WXS_1",
      itemCount: 4,
      completeCount: 2,
      partialCount: 1,
      unsupportedCount: 1,
    });
    expectPosixMode(destination, 0o700);
    expectPosixMode(join(destination, "manifest.json"), 0o600);
    expect(existsSync(join(destination, ".manifest.json.tmp"))).toBe(false);
    for (const item of result.manifest.items) {
      expectPosixMode(join(destination, item.directory), 0o700);
      expectPosixMode(join(destination, item.directory, "metadata.json"), 0o600);
    }

    const complete = result.manifest.items.find(({ reviewId }) => reviewId === "complete");
    expect(complete).toMatchObject({
      state: "complete",
      source: "source.html",
      mpInfo: "mp-info.json",
      article: "article.md",
      sourceByteLength: completeBytes.byteLength,
      sourceSha256: createHash("sha256").update(completeBytes).digest("hex"),
    });
    expect(readFileSync(join(destination, complete?.directory ?? "", "source.html"))).toEqual(
      Buffer.from(completeBytes),
    );
    expect(readFileSync(join(destination, complete?.directory ?? "", "mp-info.json"), "utf8")).toContain(
      '"originalId": "original-complete"',
    );
    expect(readFileSync(join(destination, complete?.directory ?? "", "article.md"), "utf8")).toContain(
      "# article body",
    );
    expectPosixMode(join(destination, complete?.directory ?? "", "mp-info.json"), 0o600);
    expectPosixMode(join(destination, complete?.directory ?? "", "article.md"), 0o600);

    const direct = result.manifest.items.find(({ reviewId }) => reviewId === "direct");
    expect(direct).toMatchObject({
      state: "complete",
      source: "source.html",
      sourceByteLength: directBytes.byteLength,
      sourceSha256: createHash("sha256").update(directBytes).digest("hex"),
    });
    expect(readFileSync(join(destination, direct?.directory ?? "", "source.html"), "utf8")).toBe(directHtml);

    const paywall = result.manifest.items.find(({ reviewId }) => reviewId === "paywall");
    expect(paywall).toMatchObject({ state: "partial", source: "source.html" });
    const unsupported = result.manifest.items.find(({ reviewId }) => reviewId === "unsupported");
    expect(unsupported).toMatchObject({ state: "unsupported" });
    expect(unsupported).not.toHaveProperty("source");
    expect(result.manifest.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["SOURCE_PAYWALL_PREVIEW", "SOURCE_URL_INVALID"]),
    );
    const directCalls = fetchImpl.mock.calls.filter(
      ([input]) => new URL(String(input)).searchParams.get("id") === "direct",
    );
    expect(directCalls).toHaveLength(1);

    await expect(exportPublicAccountArchive(sdk.value, "MP_WXS_1", { directory: destination })).rejects.toMatchObject({
      code: "ARTIFACT_EXISTS",
      path: destination,
      incomplete: false,
    });
    expect(readFileSync(join(destination, "manifest.json"), "utf8")).toContain('"itemCount": 4');
  });

  it("leaves a private incomplete directory without a manifest after a local write failure", async () => {
    const parent = temporaryDirectory("weread-public-incomplete-");
    const destination = join(parent, "archive");
    const reviewId = "x".repeat(300);
    const sdk = fakeClient({
      pages: {
        "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId }], { hasMore: 0 }),
      },
    });

    const failure = await exportPublicAccountArchive(sdk.value, "MP_WXS_1", {
      directory: destination,
    }).catch((cause) => cause);

    expect(failure).toBeInstanceOf(PublicAccountArtifactError);
    expect(failure).toMatchObject({ path: destination, incomplete: true, incompletePath: destination });
    expect(existsSync(destination)).toBe(true);
    expectPosixMode(destination, 0o700);
    expect(existsSync(join(destination, "manifest.json"))).toBe(false);
  });

  it("preserves byte-exact native HTML even when extraction remains unsupported", async () => {
    const parent = temporaryDirectory("weread-public-unsupported-source-");
    const destination = join(parent, "archive");
    const bytes = new TextEncoder().encode("SHORT");
    const sdk = fakeClient({
      pages: {
        "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "r1" }], { hasMore: 0 }),
      },
      details: { r1: detail("r1", "One", 1) },
    });
    const fetchImpl = vi.fn(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetchImpl);

    const result = await exportPublicAccountArchive(sdk.value, "MP_WXS_1", {
      directory: destination,
    });
    const item = result.manifest.items[0];

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(item).toMatchObject({
      state: "unsupported",
      source: "source.html",
      sourceByteLength: bytes.byteLength,
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(readFileSync(join(destination, item?.directory ?? "", "source.html"))).toEqual(Buffer.from(bytes));
    expect(result.manifest.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SOURCE_CONTENT_INSUFFICIENT", reviewId: "r1" }),
    );
  });

  it("does not expose a manifest completeness marker when the manifest write is interrupted", async () => {
    const parent = temporaryDirectory("weread-public-manifest-partial-");
    const destination = join(parent, "archive");
    const sdk = fakeClient({
      pages: { "MP_WXS_1:0": page("MP_WXS_1", []) },
    });
    const probe = await openFile(join(parent, "probe"), "w");
    const prototype = Object.getPrototypeOf(probe) as {
      writeFile: (value: string | Uint8Array) => Promise<void>;
    };
    await probe.close();
    vi.spyOn(prototype, "writeFile").mockImplementationOnce(async function (
      this: { write: (value: string) => Promise<unknown> },
      value,
    ) {
      await this.write(String(value).slice(0, 7));
      throw new Error("disk interrupted");
    });

    const failure = await exportPublicAccountArchive(sdk.value, "MP_WXS_1", {
      directory: destination,
    }).catch((cause) => cause);

    expect(failure).toMatchObject({
      code: "ARTIFACT_PUBLISH_FAILED",
      path: destination,
      incomplete: true,
    });
    expect(existsSync(join(destination, "manifest.json"))).toBe(false);
    expect(readFileSync(join(destination, ".manifest.json.tmp"), "utf8")).toBe('{\n  "ve');
  });

  it("preserves authentication, upstream, ambiguity, cause, and incomplete-path metadata", async () => {
    const parent = temporaryDirectory("weread-public-upstream-error-");
    const destination = join(parent, "archive");
    const upstream = new WeReadApiError("credentials rejected", {
      status: 401,
      path: "/review/single",
      errCode: -2012,
      ambiguous: true,
    });
    const sdk = fakeClient({
      pages: {
        "MP_WXS_1:0": page("MP_WXS_1", [{ reviewId: "r1" }], { hasMore: 0 }),
      },
      details: { r1: upstream },
    });

    const failure = await exportPublicAccountArchive(sdk.value, "MP_WXS_1", {
      directory: destination,
    }).catch((cause) => cause);

    expect(failure).toBeInstanceOf(PublicAccountArtifactError);
    expect(failure).toMatchObject({
      code: "ARTIFACT_INCOMPLETE",
      path: destination,
      incomplete: true,
      incompletePath: destination,
      authenticationHint: "Re-authenticate the selected account and retry.",
      status: 401,
      upstreamPath: "/review/single",
      errCode: -2012,
      ambiguous: true,
      cause: upstream,
    });
    expect(existsSync(join(destination, "manifest.json"))).toBe(false);
  });

  it("publishes feed files exclusively with private permissions", async () => {
    const parent = temporaryDirectory("weread-public-feed-");
    const destination = join(parent, "feed.json");

    await publishPublicAccountFeed(destination, '{"version":"https://jsonfeed.org/version/1.1"}');
    expectPosixMode(destination, 0o600);
    expect(readFileSync(destination, "utf8")).toContain("jsonfeed.org");

    await expect(publishPublicAccountFeed(destination, "replacement")).rejects.toMatchObject({
      code: "ARTIFACT_EXISTS",
      path: destination,
      incomplete: false,
    });
    expect(readFileSync(destination, "utf8")).not.toContain("replacement");
  });

  it("reports a private partial feed file when a local write is interrupted", async () => {
    const parent = temporaryDirectory("weread-public-feed-partial-");
    const destination = join(parent, "feed.json");
    const probe = await openFile(join(parent, "probe"), "w");
    const prototype = Object.getPrototypeOf(probe) as {
      writeFile: (value: string | Uint8Array) => Promise<void>;
    };
    await probe.close();
    vi.spyOn(prototype, "writeFile").mockImplementationOnce(async function (
      this: { write: (value: string) => Promise<unknown> },
      value,
    ) {
      await this.write(String(value).slice(0, 7));
      throw new Error("disk interrupted");
    });

    const failure = await publishPublicAccountFeed(destination, '{"complete":true}').catch((cause) => cause);

    expect(failure).toBeInstanceOf(PublicAccountArtifactError);
    expect(failure).toMatchObject({
      code: "ARTIFACT_PUBLISH_FAILED",
      path: destination,
      incomplete: true,
      incompletePath: destination,
    });
    expectPosixMode(destination, 0o600);
    expect(readFileSync(destination, "utf8")).toBe('{"compl');
  });
});
