import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WeReadClient } from "../../src/api/client.js";
import type { PublicAccountArticlesPage, ReviewSingleResponse } from "../../src/api/types.js";
import { ContentLibrary } from "../../src/library/store.js";
import { buildPublicAccountFeed, exportPublicAccountArchive } from "../../src/public-accounts.js";

/**
 * The article path with nothing mocked but the two network hops.
 *
 * The neighbouring suite stubs `@teng-lin/agent-fetch`, which means it never proves that what the
 * real extractor produces survives a round trip through the store. This file deliberately does not
 * mock it: the HTML below goes through real extraction, real markdown conversion, a real SQLite
 * database and real blob files. Only the WeRead client and the fetch of the article body are
 * replaced, because those are the two things a test cannot reach.
 */

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
  const store = await ContentLibrary.open({ vid: "vid-1", root: temporaryDirectory("weread-real-lib-"), env: {} });
  opened.push(store);
  return store;
}

const ACCOUNT = "MP_WXS_9";
const REVIEW = "r-real";

/** Shaped like a WeChat article page: the real extractor has to find the body inside it. */
const ARTICLE_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>一篇很长的公众号文章</title>
<script>var biz = "MzA5";</script>
<style>.rich_media { color: #333 }</style>
</head>
<body>
<div id="page-content">
  <div class="rich_media_inner">
    <h1 class="rich_media_title">一篇很长的公众号文章</h1>
    <div class="rich_media_meta_list"><span class="rich_media_meta">2024-01-01</span></div>
    <div class="rich_media_content" id="js_content">
      <p>${"这是正文的第一段，讲的是一件很具体的事情。".repeat(12)}</p>
      <p>${"第二段继续展开，补充了更多细节和背景。".repeat(12)}</p>
      <blockquote>引用了一段别处的话。</blockquote>
      <p>最后一段收尾。</p>
    </div>
  </div>
</div>
<script>window.__second_open__ = 1;</script>
</body></html>`;

const detail = (): ReviewSingleResponse => ({
  review: {
    reviewId: REVIEW,
    createTime: 1_700_000_000,
    mpInfo: {
      originalId: "original-r-real",
      doc_url: `https://mp.weixin.qq.com/s?id=${REVIEW}`,
      title: "一篇很长的公众号文章",
      mp_name: "某个公众号",
      time: 1_700_000_000,
    },
  },
});

function client() {
  const articles = vi.fn(
    async (accountId: string, request: { offset?: number } = {}): Promise<PublicAccountArticlesPage> => ({
      accountId,
      articles: (request.offset ?? 0) === 0 ? [{ reviewId: REVIEW }] : [],
      returnedCount: (request.offset ?? 0) === 0 ? 1 : 0,
      requestedOffset: request.offset ?? 0,
      hasMore: 0,
    }),
  );
  const single = vi.fn(async () => detail());
  return {
    value: { publicAccounts: { articles }, review: { single } } as unknown as WeReadClient,
    single,
  };
}

function stubSource(): () => number {
  let calls = 0;
  vi.stubGlobal("fetch", async () => {
    calls += 1;
    return new Response(ARTICLE_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  });
  return () => calls;
}

describe("public-account articles with real extraction", () => {
  it("stores what the real extractor produced and replays it exactly", async () => {
    const store = await library();
    const api = client();
    const calls = stubSource();
    const parent = temporaryDirectory("weread-real-out-");

    const first = await exportPublicAccountArchive(api.value, ACCOUNT, {
      directory: join(parent, "a"),
      library: store,
    });
    const second = await exportPublicAccountArchive(api.value, ACCOUNT, {
      directory: join(parent, "b"),
      library: store,
    });

    // The body was fetched from mp.weixin.qq.com once, and the review detail read once.
    expect(calls()).toBe(1);
    expect(api.single).toHaveBeenCalledTimes(1);
    expect(first.manifest.items).toHaveLength(1);
    expect(second.manifest.items).toHaveLength(1);

    const [item] = second.manifest.items;
    expect(item?.state).toBe("complete");

    const names = (root: string) => readdirSync(join(root, `review-${REVIEW}`)).sort();
    expect(names(join(parent, "b"))).toEqual(names(join(parent, "a")));

    for (const name of names(join(parent, "a"))) {
      const a = readFileSync(join(parent, "a", `review-${REVIEW}`, name));
      const b = readFileSync(join(parent, "b", `review-${REVIEW}`, name));
      expect(b, `${name} differed between exports`).toEqual(a);
    }
  });

  it("keeps the extracted markdown and the raw bytes distinct", async () => {
    // article.md holds converted markdown and source.html holds exactly what the server sent.
    // Storing one and regenerating the other would quietly change the archive.
    const store = await library();
    const api = client();
    stubSource();
    const parent = temporaryDirectory("weread-real-shape-");

    await exportPublicAccountArchive(api.value, ACCOUNT, { directory: join(parent, "a"), library: store });

    const stored = await store.getArticle(REVIEW);
    expect(Buffer.from(stored?.sourceBytes ?? new Uint8Array()).toString("utf8")).toBe(ARTICLE_HTML);
    expect(stored?.markdown).toBeDefined();
    expect(stored?.markdown).not.toContain("<p>");
    expect(stored?.markdown).toContain("正文的第一段");
    // The extracted body is the article, not the surrounding page furniture.
    expect(stored?.contentHtml).toContain("正文的第一段");
    expect(stored?.contentHtml).not.toContain("__second_open__");

    const raw = readFileSync(join(parent, "a", `review-${REVIEW}`, "source.html"), "utf8");
    expect(raw).toBe(ARTICLE_HTML);
  });

  it("renders the same feed from the store as from the network", async () => {
    const store = await library();
    const api = client();
    const calls = stubSource();

    const live = await buildPublicAccountFeed(
      api.value,
      { kind: "account", accountId: ACCOUNT },
      { format: "json", library: store },
    );
    const replayed = await buildPublicAccountFeed(
      api.value,
      { kind: "account", accountId: ACCOUNT },
      { format: "json", library: store },
    );

    expect(calls()).toBe(1);
    expect(JSON.parse(replayed.content).items).toEqual(JSON.parse(live.content).items);
    expect(JSON.parse(replayed.content).items[0].content_html).toContain("正文的第一段");
  });
});
