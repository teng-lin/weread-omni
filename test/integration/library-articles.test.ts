import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PutArticleInput, ReviewSingleResponse } from "../../src/api/types.js";
import { ContentLibrary } from "../../src/library/store.js";

const roots: string[] = [];
const opened: ContentLibrary[] = [];

afterEach(() => {
  for (const library of opened.splice(0)) {
    try {
      library.close();
    } catch {
      // Closed by the test.
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function library(): Promise<{ store: ContentLibrary; root: string }> {
  const root = mkdtempSync(join(tmpdir(), "weread-articles-"));
  roots.push(root);
  const store = await ContentLibrary.open({ vid: "vid-1", root, env: {} });
  opened.push(store);
  return { store, root };
}

const review: ReviewSingleResponse = {
  review: {
    reviewId: "r-1",
    title: "A public account article",
    createTime: 1_700_000_000,
    mpInfo: { title: "A public account article", mp_name: "Some Account", time: 1_700_000_000 },
  },
};

const article = (overrides: Partial<PutArticleInput> = {}): PutArticleInput => ({
  reviewId: "r-1",
  state: "complete",
  review,
  accountId: "MP_WXS_123",
  title: "A public account article",
  publicationTime: 1_700_000_000,
  sourceUrl: "https://mp.weixin.qq.com/s/abc",
  mpInfo: review.review?.mpInfo,
  sourceBytes: Buffer.from("<html>raw source</html>", "utf8"),
  markdown: "# heading\n\nbody",
  contentHtml: "<h1>heading</h1><p>body</p>",
  ...overrides,
});

describe("ContentLibrary articles", () => {
  it("round-trips every payload the feed and the archive consume", async () => {
    const { store } = await library();
    const input = article();

    await store.putArticle(input);
    const stored = await store.getArticle("r-1");

    expect(stored).toMatchObject({
      reviewId: "r-1",
      state: "complete",
      accountId: "MP_WXS_123",
      title: "A public account article",
      publicationTime: 1_700_000_000,
      sourceUrl: "https://mp.weixin.qq.com/s/abc",
      markdown: "# heading\n\nbody",
      contentHtml: "<h1>heading</h1><p>body</p>",
    });
    expect(stored?.review).toEqual(review);
    expect(stored?.mpInfo).toEqual(review.review?.mpInfo);
    expect(Buffer.from(stored?.sourceBytes ?? new Uint8Array()).toString("utf8")).toBe("<html>raw source</html>");
  });

  it("reports the digest and length of the raw source it stored", async () => {
    // The archive manifest records both, so a stored article has to reproduce them exactly rather
    // than leave the fields absent on the second export.
    const { store } = await library();
    const bytes = Buffer.from("<html>raw source</html>", "utf8");

    await store.putArticle(article({ sourceBytes: bytes, sourceByteLength: bytes.byteLength }));
    const stored = await store.getArticle("r-1");

    expect(stored?.sourceByteLength).toBe(bytes.byteLength);
    expect(stored?.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps a fallback body distinct from a raw one", async () => {
    // They are written to different files by the archive, so collapsing them would change what a
    // second export produces.
    const { store } = await library();

    await store.putArticle(
      article({ sourceBytes: undefined, sourceByteLength: undefined, fallbackHtml: "<p>fallback</p>" }),
    );
    const stored = await store.getArticle("r-1");

    expect(stored?.fallbackHtml).toBe("<p>fallback</p>");
    expect(stored?.sourceBytes).toBeUndefined();
  });

  it("declines an article with no payload at all", async () => {
    // It would report as present and then produce nothing, which is worse than a miss.
    const { store } = await library();

    await store.putArticle(
      article({ sourceBytes: undefined, markdown: undefined, contentHtml: undefined, fallbackHtml: undefined }),
    );

    expect(await store.getArticle("r-1")).toBeUndefined();
    expect(store.stats().articles).toBe(0);
  });

  it("replaces an article when it is stored again", async () => {
    const { store } = await library();

    await store.putArticle(article({ markdown: "first" }));
    await store.putArticle(article({ markdown: "second" }));

    expect((await store.getArticle("r-1"))?.markdown).toBe("second");
    expect(store.stats().articles).toBe(1);
  });

  it("scopes articles to the account that stored them", async () => {
    const { store, root } = await library();
    const other = await ContentLibrary.open({ vid: "vid-2", root, env: {} });
    opened.push(other);

    await store.putArticle(article());

    expect(await other.getArticle("r-1")).toBeUndefined();
  });

  it("reports a miss when a payload has gone missing", async () => {
    const { store, root } = await library();
    await store.putArticle(article());
    rmSync(join(root, "blobs"), { recursive: true, force: true });

    expect(await store.getArticle("r-1")).toBeUndefined();
  });

  it("reports only the account's own holdings", async () => {
    // The blob aggregate had no account predicate, so a fresh account reported zero content and a
    // nonzero byte total -- another account's. `verify` had the same gap and additionally read and
    // re-hashed those payloads.
    const { store, root } = await library();
    const other = await ContentLibrary.open({ vid: "vid-2", root, env: {} });
    opened.push(other);

    await store.putArticle(article());

    expect(other.stats()).toMatchObject({ articles: 0, blobs: 0, blobBytes: 0 });
    expect(store.stats().blobs).toBeGreaterThan(0);
    expect((await other.verify()).ok).toBe(true);
  });

  it("counts stored articles", async () => {
    const { store } = await library();

    await store.putArticle(article({ reviewId: "r-1" }));
    await store.putArticle(article({ reviewId: "r-2" }));

    expect(store.stats().articles).toBe(2);
  });

  it("shares identical payloads between two articles", async () => {
    const { store } = await library();
    const shared = article({ reviewId: "r-1" });

    await store.putArticle(shared);
    await store.putArticle({ ...shared, reviewId: "r-2" });

    expect(store.stats().articles).toBe(2);
    // Three distinct payloads between the two articles, stored once each.
    expect(store.stats().blobs).toBe(3);
  });
});
