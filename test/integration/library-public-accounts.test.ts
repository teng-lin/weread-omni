import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WeReadClient } from "../../src/api/client.js";
import type { PublicAccountArticlesPage, ReviewSingleResponse } from "../../src/api/types.js";
import { ContentLibrary } from "../../src/library/store.js";
import { buildPublicAccountFeed, exportPublicAccountArchive } from "../../src/public-accounts.js";

const LONG_TEXT = "article body ".repeat(30);

vi.mock("@teng-lin/agent-fetch", () => ({
  extractFromHtml: vi.fn(() => ({
    content: `<article>${LONG_TEXT}</article>`,
    textContent: LONG_TEXT,
    markdown: `# ${LONG_TEXT}`,
    isAccessibleForFree: true,
  })),
  htmlToMarkdown: vi.fn((html: string) => html.replace(/<[^>]+>/g, "")),
}));

const directories: string[] = [];
const opened: ContentLibrary[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const library of opened.splice(0)) {
    try {
      library.close();
    } catch {
      // Closed by the test.
    }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function library(): Promise<ContentLibrary> {
  const store = await ContentLibrary.open({ vid: "vid-1", root: temporaryDirectory("weread-mp-lib-"), env: {} });
  opened.push(store);
  return store;
}

const ACCOUNT = "MP_WXS_1";

const detail = (reviewId: string): ReviewSingleResponse => ({
  review: {
    reviewId,
    createTime: 1_700_000_000,
    mpInfo: {
      originalId: `original-${reviewId}`,
      doc_url: `https://mp.weixin.qq.com/s?id=${reviewId}`,
      title: `Title ${reviewId}`,
      mp_name: "Some Account",
      time: 1_700_000_000,
    },
  },
});

function fixtureClient(reviewIds: string[]) {
  const articles = vi.fn(
    async (accountId: string, request: { offset?: number } = {}): Promise<PublicAccountArticlesPage> => ({
      accountId,
      articles: (request.offset ?? 0) === 0 ? reviewIds.map((reviewId) => ({ reviewId })) : [],
      returnedCount: (request.offset ?? 0) === 0 ? reviewIds.length : 0,
      requestedOffset: request.offset ?? 0,
      hasMore: 0,
    }),
  );
  const single = vi.fn(async (reviewId: string) => detail(reviewId));
  return {
    value: { publicAccounts: { articles }, review: { single } } as unknown as WeReadClient,
    articles,
    single,
  };
}

/** Count fetches of the article body from mp.weixin.qq.com. */
function stubSource(): { calls: () => number } {
  let calls = 0;
  vi.stubGlobal("fetch", async () => {
    calls += 1;
    return new Response(`<html>${LONG_TEXT}</html>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  });
  return { calls: () => calls };
}

describe("public-account artifacts backed by the content library", () => {
  it("fetches an article once across two exports", async () => {
    // The expensive half is not the WeRead API but mp.weixin.qq.com, which rate-limits and serves
    // CAPTCHAs. Every article it does not have to serve twice is the point of the store.
    const store = await library();
    const client = fixtureClient(["r-1", "r-2"]);
    const source = stubSource();

    const first = await exportPublicAccountArchive(client.value, ACCOUNT, {
      directory: join(temporaryDirectory("weread-mp-out-"), "first"),
      library: store,
    });
    const second = await exportPublicAccountArchive(client.value, ACCOUNT, {
      directory: join(temporaryDirectory("weread-mp-out-"), "second"),
      library: store,
    });

    expect(first.manifest.items).toHaveLength(2);
    expect(second.manifest.items).toHaveLength(2);
    expect(source.calls()).toBe(2);
    // The review detail is skipped too: a stored article carries the whole response.
    expect(client.single).toHaveBeenCalledTimes(2);
  });

  it("produces a byte-identical archive the second time", async () => {
    const store = await library();
    const client = fixtureClient(["r-1"]);
    stubSource();
    const parent = temporaryDirectory("weread-mp-tree-");

    await exportPublicAccountArchive(client.value, ACCOUNT, { directory: join(parent, "a"), library: store });
    await exportPublicAccountArchive(client.value, ACCOUNT, { directory: join(parent, "b"), library: store });

    const listing = (path: string) => readdirSync(path, { recursive: true }).sort();
    expect(listing(join(parent, "b"))).toEqual(listing(join(parent, "a")));

    for (const name of ["article.md", "source.html", "mp-info.json"]) {
      const a = readFileSync(join(parent, "a", "review-r-1", name));
      const b = readFileSync(join(parent, "b", "review-r-1", name));
      expect(b).toEqual(a);
    }
  });

  it("keeps the manifest shape a stored article reproduces", async () => {
    const store = await library();
    const client = fixtureClient(["r-1"]);
    stubSource();
    const parent = temporaryDirectory("weread-mp-manifest-");

    const first = await exportPublicAccountArchive(client.value, ACCOUNT, {
      directory: join(parent, "a"),
      library: store,
    });
    const second = await exportPublicAccountArchive(client.value, ACCOUNT, {
      directory: join(parent, "b"),
      library: store,
    });

    const [firstItem] = first.manifest.items;
    const [secondItem] = second.manifest.items;
    expect(secondItem?.sourceSha256).toBe(firstItem?.sourceSha256);
    expect(secondItem?.sourceByteLength).toBe(firstItem?.sourceByteLength);
    expect(secondItem?.sourceUrl).toBe(firstItem?.sourceUrl);
    expect(secondItem?.state).toBe(firstItem?.state);
  });

  it("serves a feed from stored articles", async () => {
    const store = await library();
    const client = fixtureClient(["r-1", "r-2"]);
    const source = stubSource();

    const first = await buildPublicAccountFeed(
      client.value,
      { kind: "account", accountId: ACCOUNT },
      { format: "json", library: store },
    );
    const second = await buildPublicAccountFeed(
      client.value,
      { kind: "account", accountId: ACCOUNT },
      { format: "json", library: store },
    );

    expect(second.itemCount).toBe(first.itemCount);
    expect(source.calls()).toBe(2);
    // The rendered feed is the same document, not merely the same length.
    expect(JSON.parse(second.content).items).toEqual(JSON.parse(first.content).items);
  });

  it("replays the diagnostics that explain a partial article", async () => {
    // A paywalled article stores as "partial". Without its diagnostics the second artifact reports
    // partialCount with no machine-readable account of why -- and manifest.diagnostics is the only
    // explanation the archive offers.
    const store = await library();
    const client = fixtureClient(["r-1"]);
    const extraction = await import("@teng-lin/agent-fetch");
    vi.mocked(extraction.extractFromHtml).mockReturnValue({
      content: `<article>${LONG_TEXT}</article>`,
      textContent: LONG_TEXT,
      markdown: `# ${LONG_TEXT}`,
      isAccessibleForFree: false,
    } as never);
    stubSource();
    const parent = temporaryDirectory("weread-mp-diag-");

    const first = await exportPublicAccountArchive(client.value, ACCOUNT, {
      directory: join(parent, "a"),
      library: store,
    });
    const second = await exportPublicAccountArchive(client.value, ACCOUNT, {
      directory: join(parent, "b"),
      library: store,
    });

    expect(first.manifest.partialCount).toBe(1);
    expect(second.manifest.partialCount).toBe(first.manifest.partialCount);
    expect(second.manifest.diagnostics).toEqual(first.manifest.diagnostics);
    expect(second.manifest.diagnostics.length).toBeGreaterThan(0);
  });

  it("refetches when no library is supplied", async () => {
    const client = fixtureClient(["r-1"]);
    const source = stubSource();
    const parent = temporaryDirectory("weread-mp-nolib-");

    await exportPublicAccountArchive(client.value, ACCOUNT, { directory: join(parent, "a") });
    await exportPublicAccountArchive(client.value, ACCOUNT, { directory: join(parent, "b") });

    expect(source.calls()).toBe(2);
    expect(client.single).toHaveBeenCalledTimes(2);
  });

  it("refetches and repairs a stored article in refresh mode", async () => {
    // The flag is documented without qualification, and this path used to ignore it entirely: the
    // stored body was served no matter what, so a truncated or wrong article could not be fixed
    // short of deleting the library.
    const store = await library();
    const client = fixtureClient(["r-1"]);
    let body = "<html>the first body</html>";
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    });

    await exportPublicAccountArchive(client.value, ACCOUNT, {
      directory: join(temporaryDirectory("weread-mp-r1-"), "a"),
      library: store,
    });
    body = `<html>${LONG_TEXT} the corrected body</html>`;
    await exportPublicAccountArchive(client.value, ACCOUNT, {
      directory: join(temporaryDirectory("weread-mp-r2-"), "b"),
      library: store,
      libraryMode: "refresh",
    });

    expect(calls).toBe(2);
    // Refresh writes as well as refetches, so the repair persists rather than lasting one run.
    const stored = await store.getArticle("r-1");
    expect(Buffer.from(stored?.sourceBytes ?? new Uint8Array()).toString("utf8")).toContain("the corrected body");
    expect(store.stats().supersededVersions).toBeGreaterThan(0);
  });

  it("does not store an article whose body could not be retrieved", async () => {
    // A challenge page or a dead link is transient. Storing it would make the failure permanent,
    // because nothing on the read path would ever try again.
    const store = await library();
    const client = fixtureClient(["r-1"]);
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response("<html>访问过于频繁</html>", { status: 200, headers: { "content-type": "text/html" } });
    });

    await exportPublicAccountArchive(client.value, ACCOUNT, {
      directory: join(temporaryDirectory("weread-mp-fail-"), "a"),
      library: store,
    });

    expect(await store.getArticle("r-1")).toBeUndefined();
    expect(store.stats().articles).toBe(0);
    expect(calls).toBe(1);
  });
});
