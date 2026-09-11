import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewSingleResponse } from "../../src/api/types.js";
import { createProgram, runCli } from "../../src/cli.js";
import { AuthError } from "../../src/errors.js";
import { ContentLibrary } from "../../src/library/store.js";
import { readPublicAccountArticle } from "../../src/public-accounts.js";

const URL = "https://mp.weixin.qq.com/s/example";
const ID = "MP_WXS_7_example";
const FULL_URL = "https://mp.weixin.qq.com/s?__biz=example&mid=1&sn=example";
const body = "A useful article about reusable workflows, with evidence and examples. ".repeat(12);
const html = `<html><head><title>Example title</title></head><body><h1 id="activity-name">Example title</h1><div id="js_content"><p>BEGIN ${body} END</p></div></body></html>`;
const directories: string[] = [];
const libraries: ContentLibrary[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const library of libraries.splice(0)) library.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function client(payType = 0) {
  return {
    publicAccounts: {
      resolveArticle: vi.fn(async () => ({ url: URL, reviewId: ID })),
      paidContent: vi.fn(async () => ({ entries: [{ ispaid: false, url: FULL_URL }] })),
    },
    review: {
      single: vi.fn(
        async (): Promise<ReviewSingleResponse> => ({
          review: {
            reviewId: ID,
            mpInfo: {
              title: "Example title",
              mp_name: "Example account",
              doc_url: `${FULL_URL}#rd`,
              payType,
              time: 1700000000,
            },
          },
        }),
      ),
    },
  };
}

function source(value = html) {
  const fetch = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(value, { headers: { "content-type": "text/html" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function library() {
  const root = mkdtempSync(join(tmpdir(), "weread-single-"));
  directories.push(root);
  const store = await ContentLibrary.open({ root, vid: "42" });
  libraries.push(store);
  return store;
}

function sink() {
  const chunks: string[] = [];
  return { write: (chunk: string) => chunks.push(chunk), read: () => chunks.join("") };
}

describe("single public article", () => {
  it("reads the resolved URL with the real extractor, without a subscription or history listing", async () => {
    const api = client();
    const fetch = source();
    const result = await readPublicAccountArticle(api, `${URL}#rd`);
    expect(api.publicAccounts.resolveArticle).toHaveBeenCalledWith(URL, { signal: undefined });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(FULL_URL);
    expect(result).toMatchObject({
      title: "Example title",
      accountName: "Example account",
      status: "readable",
      completeness: "unverified",
      fromCache: false,
      sourceUrl: FULL_URL,
      publishedAt: "2023-11-14T22:13:20.000Z",
    });
    expect(result.markdown).toContain("BEGIN");
    expect(result.markdown).toContain("END");
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.fetchedAt).toMatch(/^\d{4}-/);
    expect(api.publicAccounts.paidContent).not.toHaveBeenCalled();
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(Object.keys(init.headers ?? {})).toEqual(["accept", "user-agent"]);
  });

  it.each([
    "http://mp.weixin.qq.com/s/example",
    "https://example.com/s/article",
    "https://user:pass@mp.weixin.qq.com/s/example",
  ])("rejects unsafe input before requesting an upstream: %s", async (url) => {
    const api = client();
    const fetch = source();
    await expect(readPublicAccountArticle(api, url)).rejects.toThrow("article source");
    expect(api.publicAccounts.resolveArticle).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts opaque review IDs and caches the account from review metadata", async () => {
    const api = client();
    const store = await library();
    source();
    api.publicAccounts.resolveArticle.mockResolvedValue({ url: URL, reviewId: "review-1" });
    const response = await api.review.single();
    response.review = { ...response.review, reviewId: "review-1", bookId: "MP_WXS_7" };
    api.review.single.mockResolvedValue(response);
    const result = await readPublicAccountArticle(api, URL, { library: store });
    expect(result).toMatchObject({ reviewId: "review-1", status: "readable" });
    expect(await store.getArticle("review-1")).toMatchObject({ accountId: "MP_WXS_7" });
    expect(await readPublicAccountArticle(api, URL, { library: store })).toMatchObject({ fromCache: true });
  });

  it.each([1700000000, 1700000000000])("normalizes publication time %s on fresh and cached reads", async (time) => {
    const api = client();
    const store = await library();
    source();
    const response = await api.review.single();
    response.review = { ...response.review, mpInfo: { ...response.review?.mpInfo, time } };
    api.review.single.mockResolvedValue(response);
    for (let i = 0; i < 2; i++) {
      expect(await readPublicAccountArticle(api, URL, { library: store })).toMatchObject({
        publishedAt: "2023-11-14T22:13:20.000Z",
        fromCache: i === 1,
      });
    }
  });

  it("redacts nested diagnostic errors throughout CLI stderr", async () => {
    const api = client();
    api.review.single.mockRejectedValue(new Error("request failed: access_token=FAKE_REVIEW_SECRET"));
    const stdout = sink();
    const stderr = sink();
    const code = await runCli(["node", "weread-omni", "--json", "public-accounts", "read-article", URL], {
      stores: [{ name: "default", backend: "eink", client: api }],
      store: "default",
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).not.toContain("FAKE_REVIEW_SECRET");
    expect(JSON.parse(stderr.read()).article.diagnostics[0].message).toContain("access_token=[REDACTED]");
  });

  it("redacts cached diagnostics without changing article text", async () => {
    const api = client();
    const store = await library();
    const response = await api.review.single();
    const markdown = "Article example: access_token=DOCUMENTED_EXAMPLE";
    await store.putArticle({
      reviewId: ID,
      review: response,
      state: "partial",
      markdown,
      diagnostics: [
        {
          code: "SOURCE_PAYWALL_PREVIEW",
          accountId: "MP_WXS_7",
          message: "preview lookup: access_token=FAKE_CACHED_SECRET",
        },
      ],
    });
    const result = await readPublicAccountArticle(api, URL, { library: store });
    expect(result).toMatchObject({ fromCache: true, status: "partial", markdown });
    expect(result.diagnostics[0]?.message).toBe("preview lookup: access_token=[REDACTED]");
    expect((await store.getArticle(ID))?.diagnostics?.[0]?.message).toContain("FAKE_CACHED_SECRET");
  });

  it("replays cached content with its storage time, refreshes, and permits a no-library read", async () => {
    const api = client();
    const fetch = source();
    const store = await library();
    const first = await readPublicAccountArticle(api, URL, { library: store });
    const second = await readPublicAccountArticle(api, URL, { library: store });
    expect(second).toMatchObject({ fromCache: true, fetchedAt: null, markdown: first.markdown });
    expect(second.cachedAt).toMatch(/^\d{4}-/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(api.review.single).toHaveBeenCalledTimes(1);
    const fresh = await readPublicAccountArticle(api, URL, { library: store, libraryMode: "refresh" });
    expect(fresh.fromCache).toBe(false);
    await readPublicAccountArticle(api, URL);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not follow a CAPTCHA redirect or cache its error page", async () => {
    const api = client();
    const store = await library();
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?test=1" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await readPublicAccountArticle(api, URL, { library: store });
    expect(result).toMatchObject({ status: "unavailable", markdown: null, fetchedAt: null });
    expect(result.diagnostics[0]?.code).toBe("SOURCE_WECHAT_CHALLENGE");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await store.getArticle(ID)).toBeUndefined();
  });

  it("reports an ordinary HTTP 200 challenge page as unavailable", async () => {
    source(`<html><body>环境异常，需要验证 ${body}</body></html>`);
    expect(await readPublicAccountArticle(client(), URL)).toMatchObject({ status: "unavailable", markdown: null });
  });

  it("does not turn a paid preview into a complete article", async () => {
    source(html);
    const api = client(2);
    const result = await readPublicAccountArticle(api, URL);
    expect(api.publicAccounts.paidContent).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "partial", completeness: "partial" });
    expect(result.diagnostics[0]?.code).toBe("SOURCE_PAYWALL_PREVIEW");
  });

  it("propagates authentication failure without calling the article host", async () => {
    const api = client();
    const fetch = source();
    api.review.single.mockRejectedValue(new AuthError("invalid session"));
    await expect(readPublicAccountArticle(api, URL)).rejects.toThrow("invalid session");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("exposes the CLI on a store with only the three required read operations", async () => {
    source();
    const stdout = sink();
    const stderr = sink();
    const code = await runCli(["node", "weread-omni", "--json", "public-accounts", "read-article", URL], {
      stores: [{ name: "default", backend: "eink", client: client() }],
      store: "default",
      stdout,
      stderr,
      env: { WEREAD_READONLY: "1" },
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout.read()).markdown).toContain("END");
    expect(stderr.read()).toBe("");
  });

  it("returns a nonzero exit and structured stderr when the body cannot be read", async () => {
    source("<html>环境异常</html>");
    const stdout = sink();
    const stderr = sink();
    const code = await runCli(["node", "weread-omni", "--json", "public-accounts", "read-article", URL], {
      stores: [{ name: "default", backend: "eink", client: client() }],
      store: "default",
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(stdout.read()).toBe("");
    expect(JSON.parse(stderr.read())).toMatchObject({
      code: "SOURCE_CONTENT_INSUFFICIENT",
      article: { status: "unavailable" },
    });
  });

  it("prints the body and preview warning for a human-readable paid article", async () => {
    source();
    const stdout = sink();
    const stderr = sink();
    const code = await runCli(["node", "weread-omni", "public-accounts", "read-article", URL], {
      stores: [{ name: "default", backend: "eink", client: client(2) }],
      store: "default",
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(stderr.read()).toBe("");
    expect(stdout.read()).toContain("Example title");
    expect(stdout.read()).toContain(FULL_URL);
    expect(stdout.read()).toContain("Partial content (preview).");
    expect(stdout.read()).toContain("BEGIN");
    expect(stdout.read()).toContain("END");
  });

  it("labels cached content in human output without claiming a fresh fetch", async () => {
    const api = client();
    const store = await library();
    source();
    await readPublicAccountArticle(api, URL, { library: store });
    const stdout = sink();
    const code = await runCli(["node", "weread-omni", "public-accounts", "read-article", URL], {
      stores: [{ name: "default", backend: "eink", client: api }],
      store: "default",
      library: store,
      stdout,
      stderr: sink(),
    });
    expect(code).toBe(0);
    expect(stdout.read()).toContain("Cached:");
    expect(stdout.read()).not.toContain("Fetched:");
    expect(stdout.read()).toContain("full-text completeness is unverified");
    expect(stdout.read()).toContain("END");
  });

  it("hides the command when a required operation is missing", () => {
    const program = createProgram({
      stores: [{ name: "default", backend: "eink", client: { review: client().review } }],
    });
    expect(
      program.commands
        .find((command) => command.name() === "public-accounts")
        ?.commands.some((command) => command.name() === "read-article"),
    ).not.toBe(true);
  });
});
