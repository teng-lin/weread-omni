import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ChapterContent, ChapterInfoResponse } from "../../src/api/types.js";
import { LibraryVersionError } from "../../src/library/errors.js";
import { blobPath, databasePath } from "../../src/library/paths.js";
import { ContentLibrary, isPaywallPreview } from "../../src/library/store.js";
import { expectPosixMode } from "../support/posix.js";

const roots: string[] = [];
const open: ContentLibrary[] = [];

afterEach(() => {
  for (const library of open.splice(0)) {
    try {
      library.close();
    } catch {
      // Already closed by the test.
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "weread-library-"));
  roots.push(root);
  return root;
}

async function library(root: string, vid = "vid-1"): Promise<ContentLibrary> {
  const instance = await ContentLibrary.open({ vid, root, env: {} });
  open.push(instance);
  return instance;
}

const epub = (overrides: Partial<ChapterContent> = {}): ChapterContent =>
  ({ bookId: "3300060341", chapterUid: 4, format: "epub", html: "<p>body</p>", ...overrides }) as ChapterContent;

/** Read the retained-version ledger directly: the store exposes no accessor for it. */
function retainedDigests(root: string, kind: string, entityKey: string): string[] {
  const database = new DatabaseSync(databasePath(root), { readOnly: true });
  try {
    return (
      database
        .prepare("SELECT sha256 FROM content_version WHERE kind = ? AND entity_key = ? ORDER BY id")
        .all(kind, entityKey) as unknown as { sha256: string }[]
    ).map((row) => row.sha256);
  } finally {
    database.close();
  }
}

/** The digests a stored chapter currently points at. */
function digestsFor(root: string, _store: ContentLibrary, bookId: string, chapterUid: number): { html: string } {
  const database = new DatabaseSync(databasePath(root), { readOnly: true });
  try {
    const row = database
      .prepare("SELECT html_sha256 FROM chapter WHERE book_id = ? AND chapter_uid = ?")
      .get(bookId, chapterUid) as { html_sha256: string };
    return { html: row.html_sha256 };
  } finally {
    database.close();
  }
}

/**
 * Real WeRead previews, captured live from three paid books.
 *
 * Length is not the signal and these show why: they run 154-442 characters depending on the book,
 * overlapping a legitimate copyright page. What separates them is that none carries markup.
 */
const LIVE_PREVIEWS = [
  "八万五千三体时（约8.6个地球年）后。\n元首下令召开三体世界全体执政官紧急会议，这很不寻常。...",
  "runner注册完成后，需要为它选择一个执行器。执行器决定了作业在什么环境中运行。...",
  "The Road Through the Forest. After a few hours the road began to be rough...",
];

describe("paywall previews", () => {
  it("recognizes a live preview and spares every real chapter shape", () => {
    for (const html of LIVE_PREVIEWS) {
      expect(isPaywallPreview({ bookId: "b", chapterUid: 1, format: "epub", html } as ChapterContent)).toBe(true);
    }
    // A copyright page is ~120 characters of real content -- the same size as a preview, which is
    // why the test is structural. The cover carries markup and no text at all.
    const real = [
      '<?xml version="1.0"?><html><body><p class="contentCR">书名：三体1</p></body></html>',
      "<p>body</p>",
      '<div><img src="cover.jpg"/></div>',
    ];
    for (const html of real) {
      expect(isPaywallPreview({ bookId: "b", chapterUid: 1, format: "epub", html } as ChapterContent)).toBe(false);
    }
  });

  it("leaves txt chapters alone, where plain text is the correct shape", () => {
    const content = { bookId: "b", chapterUid: 1, format: "txt", text: "plain", html: "plain" } as ChapterContent;
    expect(isPaywallPreview(content)).toBe(false);
  });

  it("declines to store a preview, and writes no blob for it", async () => {
    const root = temporaryRoot();
    const store = await library(root);

    await store.putChapterContent(epub({ html: LIVE_PREVIEWS[0] as string }));

    // Storing it would be permanent: content is never re-fetched once stored, and `verify` would
    // report the preview clean because its bytes match their digest.
    expect(store.has("3300060341", 4)).toBe(false);
    expect(await store.getChapterContent("3300060341", 4)).toBeUndefined();
    // Refused before any blob is written, so a refusal cannot leak an orphan.
    expect(JSON.stringify(await store.stats())).toContain('"blobs":0');
  });

  it("still stores the real chapter that replaces a refused preview", async () => {
    const root = temporaryRoot();
    const store = await library(root);

    await store.putChapterContent(epub({ html: LIVE_PREVIEWS[0] as string }));
    await store.putChapterContent(epub({ html: "<p>the whole chapter</p>" }));

    expect(await store.getChapterContent("3300060341", 4)).toEqual(epub({ html: "<p>the whole chapter</p>" }));
  });

  it("treats a preview already in the library as a miss so it can self-heal", async () => {
    const root = temporaryRoot();
    const store = await library(root);
    // Written the way a build before this guard would have written it.
    await store.putChapterContent(epub({ html: "<p>real</p>" }));
    const database = new DatabaseSync(databasePath(root), { readOnly: false });
    const preview = LIVE_PREVIEWS[0] as string;
    const digest = createHash("sha256").update(Buffer.from(preview, "utf8")).digest("hex");
    mkdirSync(join(root, "blobs", "sha256", digest.slice(0, 2)), { recursive: true });
    writeFileSync(blobPath(root, digest), preview);
    database
      .prepare("INSERT INTO blob (sha256, byte_length, media_type, stored_at) VALUES (?, ?, ?, ?)")
      .run(digest, Buffer.byteLength(preview, "utf8"), "application/xhtml+xml", new Date().toISOString());
    database.prepare("UPDATE chapter SET html_sha256 = ?").run(digest);
    database.close();

    const reopened = await library(root);
    // Every availability check reports a miss, so preflight callers also refetch it.
    expect(reopened.has("3300060341", 4)).toBe(false);
    expect(reopened.missing("3300060341", [4])).toEqual([4]);
    expect(await reopened.getChapterContent("3300060341", 4)).toBeUndefined();
  });
});

describe("ContentLibrary", () => {
  it("round-trips an epub chapter across a reopen", async () => {
    const root = temporaryRoot();
    const first = await library(root);
    const content = epub({ css: "p { margin: 0 }" });

    await first.putChapterContent(content);
    first.close();

    const second = await library(root);
    expect(second.has("3300060341", 4)).toBe(true);
    expect(await second.getChapterContent("3300060341", 4)).toEqual(content);
  });

  it("keeps an absent stylesheet absent rather than storing an empty one", async () => {
    // `content()` omits the key entirely when there is no stylesheet, and a round trip that
    // reintroduced it as "" would change the shape callers match on.
    const store = await library(temporaryRoot());
    await store.putChapterContent(epub());

    const restored = await store.getChapterContent("3300060341", 4);

    expect(restored).toEqual(epub());
    expect(restored && "css" in restored).toBe(false);
  });

  it("round-trips a txt chapter with both of its bodies", async () => {
    const store = await library(temporaryRoot());
    const content: ChapterContent = {
      bookId: "book-txt",
      chapterUid: 9,
      format: "txt",
      text: "plain body",
      html: "<p>plain body</p>",
    };

    await store.putChapterContent(content);

    expect(await store.getChapterContent("book-txt", 9)).toEqual(content);
  });

  it("scopes content to the account that stored it while sharing the bytes", async () => {
    const root = temporaryRoot();
    const first = await library(root, "vid-1");
    const second = await library(root, "vid-2");
    const content = epub();

    await first.putChapterContent(content);
    await second.putChapterContent(content);

    expect(first.stats().chapters).toBe(1);
    expect(second.stats().chapters).toBe(1);
    // One payload on disk: the digest is the name, so identical content cannot be stored twice.
    expect(second.stats().blobs).toBe(1);
  });

  it("does not report another account's content", async () => {
    const root = temporaryRoot();
    const first = await library(root, "vid-1");
    const second = await library(root, "vid-2");

    await first.putChapterContent(epub());

    expect(second.has("3300060341", 4)).toBe(false);
    expect(await second.getChapterContent("3300060341", 4)).toBeUndefined();
  });

  it("reports a chapter as absent when its payload is gone", async () => {
    // The row and the bytes live in different stores, so a restored backup or an unmounted volume
    // can leave one without the other. Answering from the row alone would tell a caller it has
    // content that cannot be produced, and it would emit nothing instead of fetching.
    const root = temporaryRoot();
    const store = await library(root);
    await store.putChapterContent(epub());
    const stored = await store.getChapterContent("3300060341", 4);
    expect(stored).toBeDefined();

    rmSync(join(root, "blobs"), { recursive: true, force: true });

    expect(store.has("3300060341", 4)).toBe(false);
    expect(await store.getChapterContent("3300060341", 4)).toBeUndefined();
    expect(store.missing("3300060341", [4])).toEqual([]);
  });

  it("counts stored listings separately from stored bodies", async () => {
    // A book can have an index and no bodies. Reporting only bodies made a populated library look
    // empty, which is exactly when someone runs status to find out what is there.
    const store = await library(temporaryRoot());
    store.putChapterIndex({ bookId: "b-idx", synckey: 5, chapters: [{ chapterUid: 1, chapterIdx: 1 }] }, "official");

    expect(store.stats()).toMatchObject({ chapters: 0, chapterIndexes: 1 });
  });

  it("lists the chapters it does not hold", async () => {
    const store = await library(temporaryRoot());
    await store.putChapterContent(epub({ chapterUid: 1 }));
    await store.putChapterContent(epub({ chapterUid: 3 }));

    expect(store.missing("3300060341", [1, 2, 3, 4])).toEqual([2, 4]);
  });

  it("keeps the higher synckey regardless of the order listings arrive", async () => {
    const store = await library(temporaryRoot());
    const listing = (synckey: number, count: number): ChapterInfoResponse => ({
      bookId: "3300060341",
      synckey,
      chapters: Array.from({ length: count }, (_unused, index) => ({ chapterUid: index, chapterIdx: index })),
    });

    store.putChapterIndex(listing(5, 2), "official");
    store.putChapterIndex(listing(3, 1), "official");
    expect(store.getChapterIndex("3300060341", "official")?.synckey).toBe(5);

    store.putChapterIndex(listing(9, 4), "official");
    expect(store.getChapterIndex("3300060341", "official")?.synckey).toBe(9);
  });

  it("returns a stored listing in the same shape the network returned", async () => {
    // Found in live use: the stored copy dropped chapterUpdateTime, so a caller saw a different
    // object depending on whether the library happened to hold the book.
    const store = await library(temporaryRoot());
    const response: ChapterInfoResponse = {
      bookId: "b-shape",
      synckey: 1768079585,
      chapterUpdateTime: 1777024396,
      chapters: [{ chapterUid: 1, chapterIdx: 1, title: "封面" }],
    };

    store.putChapterIndex(response, "official");

    expect(store.getChapterIndex("b-shape", "official")).toEqual(response);
  });

  it("does not invent a chapterUpdateTime upstream never sent", async () => {
    const store = await library(temporaryRoot());
    const response: ChapterInfoResponse = {
      bookId: "b-plain",
      synckey: 4,
      chapters: [{ chapterUid: 1, chapterIdx: 1 }],
    };

    store.putChapterIndex(response, "official");

    const restored = store.getChapterIndex("b-plain", "official");
    expect(restored).toEqual(response);
    expect(restored && "chapterUpdateTime" in restored).toBe(false);
  });

  it("never compares synckeys across backends", async () => {
    // The official and e-ink endpoints number their synckeys independently, so a higher value from
    // one says nothing about the other.
    const store = await library(temporaryRoot());
    const listing = (synckey: number): ChapterInfoResponse => ({
      bookId: "b",
      synckey,
      chapters: [{ chapterUid: 1, chapterIdx: 1 }],
    });

    store.putChapterIndex(listing(100), "official");
    store.putChapterIndex(listing(2), "eink");

    expect(store.getChapterIndex("b", "official")?.synckey).toBe(100);
    expect(store.getChapterIndex("b", "eink")?.synckey).toBe(2);
  });

  it.each([
    ["an empty listing", { bookId: "b", synckey: 7, chapters: [] }],
    ["a zero synckey", { bookId: "b", synckey: 0, chapters: [{ chapterUid: 1, chapterIdx: 1 }] }],
  ])("declines to store %s", async (_label, response) => {
    // Upstream returns both shapes as well-formed responses when it is degraded. Storing one would
    // serve an empty book from then on, and nothing on the read path would ever refetch it.
    const store = await library(temporaryRoot());
    store.putChapterIndex(response as ChapterInfoResponse, "official");
    expect(store.getChapterIndex("b", "official")).toBeUndefined();
  });

  it("stores a chapter listing far larger than a configuration file", async () => {
    // The credential store caps state at 1 MiB. A long serial's listing exceeds that, and it is
    // exactly the book where not refetching matters most.
    const store = await library(temporaryRoot());
    const chapters = Array.from({ length: 5000 }, (_unused, index) => ({
      chapterUid: index,
      chapterIdx: index,
      title: `Chapter ${index} ${"padding".repeat(30)}`,
    }));

    store.putChapterIndex({ bookId: "serial", synckey: 1, chapters }, "official");

    const restored = store.getChapterIndex("serial", "official");
    expect(restored?.chapters).toHaveLength(5000);
    expect(JSON.stringify(chapters).length).toBeGreaterThan(1024 * 1024);
  });

  it("declines book metadata with neither title nor author", async () => {
    const store = await library(temporaryRoot());
    store.putBookInfo("b", {});
    expect(store.getBookInfo("b")).toBeUndefined();

    store.putBookInfo("b", { title: "Real" });
    expect(store.getBookInfo("b")?.title).toBe("Real");
  });

  it("retains the digests a refresh displaces, and keeps retaining them", async () => {
    // A refetch can return a challenge page or a truncated body. Superseded digests are appended,
    // never overwritten, so a second bad refresh cannot destroy what the first one displaced.
    // Asserted by reading the retained digests back: a count alone stayed green when the whole
    // retention step was deleted.
    const root = temporaryRoot();
    const store = await library(root);
    const good = epub({ html: "<p>good</p>" });
    await store.putChapterContent(good);
    const originalDigest = digestsFor(root, store, "3300060341", 4).html;

    await store.putChapterContent(epub({ html: "<p>challenge page</p>" }));
    await store.putChapterContent(epub({ html: "<p>truncated</p>" }));

    // Two refreshes, two retained versions -- the first is not overwritten by the second.
    expect(store.stats().supersededVersions).toBe(2);
    const retained = retainedDigests(root, "chapter", "3300060341/4");
    expect(retained).toContain(originalDigest);
    expect(retained).toHaveLength(2);
    // The retained payload is still on disk and still verifies, so it is genuinely recoverable.
    expect((await store.verify()).ok).toBe(true);
  });

  it("retains displaced article payloads too", async () => {
    // The schema declares the article kind; the store used not to record it, so a refetch that
    // returned a challenge page erased the good body outright.
    const root = temporaryRoot();
    const store = await library(root);
    const base = {
      reviewId: "r-1",
      state: "complete" as const,
      review: { review: { reviewId: "r-1" } },
      markdown: "the genuine body",
    };

    await store.putArticle(base);
    await store.putArticle({ ...base, markdown: "a challenge page" });

    expect(store.stats().supersededVersions).toBe(1);
    expect(retainedDigests(root, "article", "r-1")).toHaveLength(1);
  });

  it("refuses a library written by a newer release without touching it", async () => {
    const root = temporaryRoot();
    const store = await library(root);
    store.close();

    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(databasePath(root));
    raw.exec("PRAGMA user_version = 99");
    const before = raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get() as { n: number };
    raw.close();

    await expect(ContentLibrary.open({ vid: "vid-1", root, env: {} })).rejects.toThrow(LibraryVersionError);

    const after = new DatabaseSync(databasePath(root));
    expect(after.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get()).toEqual(before);
    expect((after.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(99);
    after.close();
  });

  it("reports the damage a bare integrity check would miss", async () => {
    const root = temporaryRoot();
    const store = await library(root);
    await store.putChapterContent(epub());

    expect(store.stats().blobs).toBe(1);
    expect((await store.verify()).ok).toBe(true);

    // Remove the payload but leave the row: the database is structurally perfect and useless.
    rmSync(join(root, "blobs"), { recursive: true, force: true });
    const report = await store.verify();

    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toContain("missing or unreadable");
  });

  it("reports a database copied without its write-ahead log", async () => {
    // The backup a user actually attempts. `open` rebuilds an empty schema first, so the library
    // looks structurally perfect and empty -- stats reports zeros and integrity_check says ok.
    const source = temporaryRoot();
    const store = await library(source);
    await store.putChapterContent(epub());

    const restored = temporaryRoot();
    mkdirSync(join(restored, "blobs"), { recursive: true });
    cpSync(join(source, "blobs"), join(restored, "blobs"), { recursive: true });
    copyFileSync(databasePath(source), databasePath(restored));

    const reopened = await library(restored);
    expect(reopened.stats().chapters).toBe(0);
    const report = await reopened.verify();

    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toContain("copied without its -wal");
  });

  it("does not mistake a genuinely empty library for a lost one", async () => {
    const store = await library(temporaryRoot());
    expect(await store.verify()).toEqual({ ok: true, problems: [] });
  });

  it("keeps its files private", async () => {
    const root = temporaryRoot();
    const store = await library(root);
    await store.putChapterContent(epub());

    expectPosixMode(root, 0o700);
    for (const suffix of ["", "-wal", "-shm"]) {
      const path = `${databasePath(root)}${suffix}`;
      if (!existsSync(path)) continue;
      // SQLite creates these with the process umask, which normally leaves them world-readable.
      expectPosixMode(path, 0, 0o077);
    }
  });

  it("survives a blob that was replaced with a directory", async () => {
    const root = temporaryRoot();
    const store = await library(root);
    await store.putChapterContent(epub());
    const content = await store.getChapterContent("3300060341", 4);
    expect(content).toBeDefined();

    const html = Buffer.from("<p>body</p>", "utf8");
    const { createHash } = await import("node:crypto");
    const path = blobPath(root, createHash("sha256").update(html).digest("hex"));
    rmSync(path);
    writeFileSync(path, "");

    expect(await store.getChapterContent("3300060341", 4)).toBeUndefined();
  });
});
