import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MobileCallOptions, MobileResponse } from "../../src/api/mobile.js";
import { PUBLIC_OPERATIONS } from "../../src/api/operations.js";
import { aiModule } from "../../src/api/resources/ai.js";
import { bookModule } from "../../src/api/resources/book.js";
import { discoverModule } from "../../src/api/resources/discover.js";
import { ImportPhaseError, importModule } from "../../src/api/resources/import.js";
import { notesModule } from "../../src/api/resources/notes.js";
import { publicAccountsModule } from "../../src/api/resources/public-accounts.js";
import { readDataModule } from "../../src/api/resources/read-data.js";
import { reviewModule } from "../../src/api/resources/review.js";
import { searchModule } from "../../src/api/resources/search.js";
import { shelfModule } from "../../src/api/resources/shelf.js";
import type { CosUploader, MobileTransport } from "../../src/api/types.js";
import { AuthError, TransportError, WeReadApiError } from "../../src/errors.js";

const defaultCosUpload = vi.hoisted(() => vi.fn<CosUploader>());
vi.mock("../../src/api/cos-upload.js", () => ({ cosUpload: defaultCosUpload }));

/**
 * Satisfies every wire-to-public seam assertion at once, so a test about something other than
 * response shape (cancellation, request mapping) does not have to restate one per operation.
 * Tests that care about the body push their own.
 */
const ANY_ACCEPTED_BODY = {
  books: [],
  albums: [],
  data: [],
  updated: [],
  reviews: [],
  items: [],
  list: [],
  records: [],
  parts: [],
  underlines: [],
  booksimilar: { books: [] },
  skuImages: { urls: [] },
  authorOpus: { books: [] },
  copyRightOpus: {},
};

class RecordingTransport implements MobileTransport {
  readonly calls: Array<{ method: string; path: string; options: MobileCallOptions }> = [];
  readonly responses: unknown[] = [];

  async call<T = unknown>(method: string, path: string, options: MobileCallOptions = {}): Promise<MobileResponse<T>> {
    this.calls.push({ method, path, options });
    return { status: 200, headers: new Headers(), body: (this.responses.shift() ?? { ...ANY_ACCEPTED_BODY }) as T };
  }
}

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  defaultCosUpload.mockReset();
});

describe("public book resources", () => {
  it("exposes exactly info, detail, chapters, and progress", async () => {
    const transport = new RecordingTransport();
    transport.responses.push(
      { bookId: "book", title: "Title" },
      {
        skuImages: { urls: ["https://example.test/sku.jpg"] },
        authorOpus: { books: [{ bookInfo: { bookId: "author-book" } }] },
        copyRightOpus: { books: [{ bookInfo: { bookId: "rights-book" } }] },
      },
      {
        data: [
          {
            bookId: "book",
            synckey: 7,
            chapterUpdateTime: 9,
            updated: [{ chapterUid: 1, chapterIdx: 1, title: "One" }],
          },
        ],
      },
      { bookId: "book", book: { progress: 42 } },
    );
    const book = bookModule(transport);

    expect(Object.keys(book).sort()).toEqual(["chapters", "detail", "info", "progress"]);
    await expect(book.info("book")).resolves.toMatchObject({ title: "Title" });
    await expect(book.detail("book", { count: 3 })).resolves.toEqual({
      skuImages: { urls: ["https://example.test/sku.jpg"] },
      authorOpus: { books: [{ bookInfo: { bookId: "author-book" } }] },
      copyRightOpus: { books: [{ bookInfo: { bookId: "rights-book" } }] },
    });
    await expect(book.chapters("book")).resolves.toEqual({
      bookId: "book",
      synckey: 7,
      chapterUpdateTime: 9,
      chapters: [{ chapterUid: 1, chapterIdx: 1, title: "One" }],
    });
    await expect(book.progress("book")).resolves.toMatchObject({ book: { progress: 42 } });

    expect(transport.calls).toEqual([
      { method: "GET", path: "/book/info", options: { query: { bookId: "book" } } },
      {
        method: "GET",
        path: "/book/detailinfo",
        options: {
          query: {
            bookId: "book",
            listtypes: "5,7,9",
            synckey: "0,0,0",
            maxIdx: "0,0,0",
            count: "3,3,3",
          },
        },
      },
      {
        method: "POST",
        path: "/book/chapterInfos",
        options: { idempotent: true, body: { bookIds: ["book"], synckeys: [0], updateTimes: [0], maxfreeIdx: [0] } },
      },
      { method: "GET", path: "/book/getProgress", options: { query: { bookId: "book" } } },
    ]);
  });

  it.each([0, 13, 1.5])("rejects an out-of-budget detail count before transport: %s", (count) => {
    const transport = new RecordingTransport();
    expect(() => bookModule(transport).detail("book", { count })).toThrow("count");
    expect(transport.calls).toHaveLength(0);
  });
});

describe("public resource request mappings", () => {
  const cases: Array<{
    name: string;
    invoke: (transport: RecordingTransport) => Promise<unknown>;
    expected: { method: string; path: string; options?: MobileCallOptions };
  }> = [
    {
      name: "search.books",
      invoke: (transport) => searchModule(transport).books("dune"),
      expected: {
        method: "GET",
        path: "/store/search",
        options: { query: { keyword: "dune", scope: 10, count: undefined, maxIdx: 0 }, signal: undefined },
      },
    },
    {
      name: "search.suggest",
      invoke: (transport) => searchModule(transport).suggest("dun"),
      expected: {
        method: "GET",
        path: "/store/suggest",
        options: { query: { keyword: "dun", count: 10 }, signal: undefined },
      },
    },
    {
      name: "shelf.sync",
      invoke: (transport) => shelfModule(transport).sync(),
      expected: { method: "GET", path: "/shelf/sync" },
    },
    {
      name: "shelf.add",
      invoke: (transport) => shelfModule(transport).add("book"),
      expected: {
        method: "POST",
        path: "/shelf/add",
        options: { body: { albumIds: [], archiveIds: [], bookIds: ["book"] } },
      },
    },
    {
      name: "shelf.delete",
      invoke: (transport) => shelfModule(transport).delete("book"),
      expected: {
        method: "POST",
        path: "/shelf/delete",
        options: { body: { albumIds: [], archiveIds: [], bookIds: ["book"] } },
      },
    },
    {
      name: "shelf.pin",
      invoke: (transport) => shelfModule(transport).pin("book", false),
      expected: {
        method: "POST",
        path: "/shelf/top",
        options: { body: { albumIds: [], archiveIds: [], bookIds: ["book"], isDel: 1 } },
      },
    },
    {
      name: "shelf.setPrivate",
      invoke: (transport) => shelfModule(transport).setPrivate("book", false),
      expected: {
        method: "POST",
        path: "/book/secret",
        options: { body: { albumIds: [], bookIds: ["book"], private: 0 } },
      },
    },
    {
      name: "shelf.markFinished",
      invoke: (transport) => shelfModule(transport).markFinished("book", false),
      expected: {
        method: "POST",
        path: "/book/markstatus",
        options: { body: { auto: 0, bookId: "book", finishInfo: 0, isCancel: 1, status: 4 } },
      },
    },
    {
      name: "shelf.markReading",
      invoke: (transport) => shelfModule(transport).markReading("book"),
      expected: {
        method: "POST",
        path: "/book/markstatus",
        options: { body: { auto: 0, bookId: "book", finishInfo: 0, isCancel: 0, status: 2 } },
      },
    },
    {
      name: "notes.notebooks",
      invoke: (transport) => notesModule(transport).notebooks({ count: 8, lastSort: 12 }),
      expected: { method: "GET", path: "/user/notebooks", options: { query: { count: 8, lastSort: 12 } } },
    },
    {
      name: "notes.recent",
      invoke: (transport) => notesModule(transport).recent({ count: 8 }),
      expected: {
        method: "GET",
        path: "/user/allNotes",
        options: { query: { maxid: 0, count: 8 }, signal: undefined },
      },
    },
    {
      name: "notes.bookmarks",
      invoke: (transport) => notesModule(transport).bookmarks("book", { synckey: 9 }),
      expected: {
        method: "GET",
        path: "/book/bookmarklist",
        options: { query: { bookId: "book", synckey: 9 } },
      },
    },
    {
      name: "notes.mine",
      invoke: (transport) => notesModule(transport).mine("book", { synckey: 9, count: 8 }),
      expected: {
        method: "GET",
        path: "/review/list",
        options: { query: { bookId: "book", listType: 1, listMode: 0, mine: 1, synckey: 9, count: 8 } },
      },
    },
    {
      name: "notes.best",
      invoke: (transport) => notesModule(transport).best("book", { count: 8, maxIdx: 2, synckey: 9 }),
      expected: {
        method: "GET",
        path: "/book/bestbookmarks",
        options: { query: { bookId: "book", chapterUid: 0, count: 8, maxIdx: 2, synckey: 9 }, signal: undefined },
      },
    },
    {
      name: "notes.readReviews",
      invoke: (transport) =>
        notesModule(transport).readReviews("book", 7, [{ range: "1-2", count: 5, maxIdx: 2, synckey: 9 }]),
      expected: {
        method: "POST",
        path: "/book/readreviews",
        options: {
          body: {
            bookId: "book",
            chapterUid: 7,
            cht2sMode: "",
            reviews: [{ range: "1-2", count: 5, maxIdx: 2, synckey: 9 }],
          },
          idempotent: true,
          signal: undefined,
        },
      },
    },
    {
      name: "notes.underlines",
      invoke: (transport) => notesModule(transport).underlines("book", 7, { synckey: 9 }),
      expected: {
        method: "GET",
        path: "/book/underlines",
        options: { query: { bookId: "book", chapterUid: 7, synckey: 9 } },
      },
    },
    {
      name: "notes.addBookmark",
      invoke: (transport) =>
        notesModule(transport).addBookmark({
          bookId: "book",
          chapterUid: 2,
          range: "1-2",
          markText: "text",
          colorStyle: 5,
          bookVersion: 12,
          chapterName: "Chapter",
          contextAbstract: "Context",
        }),
      expected: {
        method: "POST",
        path: "/book/addBookmark",
        options: {
          body: {
            bookId: "book",
            chapterUid: 2,
            range: "1-2",
            markText: "text",
            type: 1,
            style: 1,
            colorStyle: 5,
            bookVersion: 12,
            chapterName: "Chapter",
            contextAbstract: "Context",
          },
        },
      },
    },
    {
      name: "notes.updateBookmark",
      invoke: (transport) => notesModule(transport).updateBookmark({ bookmarkId: "bookmark", style: 2, colorStyle: 5 }),
      expected: {
        method: "POST",
        path: "/book/updateBookmark",
        options: { body: { bookmarkId: "bookmark", style: 2, colorStyle: 5 }, signal: undefined },
      },
    },
    {
      name: "notes.removeBookmark",
      invoke: (transport) => notesModule(transport).removeBookmark("bookmark"),
      expected: {
        method: "POST",
        path: "/book/removeBookmark",
        options: { body: { bookmarkIds: ["bookmark"] }, signal: undefined },
      },
    },
    {
      name: "review.list",
      invoke: (transport) => reviewModule(transport).list("book"),
      expected: {
        method: "GET",
        path: "/review/list",
        options: {
          query: { bookId: "book", listType: 1, listMode: 0, mine: 0, synckey: 0, count: 21, maxIdx: 0 },
        },
      },
    },
    {
      name: "review.single",
      invoke: (transport) => reviewModule(transport).single("review"),
      expected: {
        method: "GET",
        path: "/review/single",
        options: {
          query: {
            reviewId: "review",
            commentsCount: 10,
            commentsDirection: 0,
            likesCount: 10,
            likesDirection: 0,
            synckey: 0,
          },
        },
      },
    },
    {
      name: "review.add",
      invoke: (transport) =>
        reviewModule(transport).add({
          bookId: "book",
          content: "note",
          type: 4,
          star: 80,
          range: "1-2",
          abstract: "quote",
          chapterUid: 7,
        }),
      expected: {
        method: "POST",
        path: "/review/add",
        options: {
          body: {
            bookId: "book",
            content: "note",
            type: 4,
            star: 80,
            range: "1-2",
            abstract: "quote",
            chapterUid: 7,
          },
        },
      },
    },
    {
      name: "review.edit",
      invoke: (transport) => reviewModule(transport).edit("review", "replacement"),
      expected: {
        method: "POST",
        path: "/review/useredit",
        options: { body: { reviewId: "review", content: "replacement" }, signal: undefined },
      },
    },
    {
      name: "review.delete",
      invoke: (transport) => reviewModule(transport).delete("review"),
      expected: { method: "POST", path: "/review/delete", options: { body: { reviewId: "review" } } },
    },
    {
      name: "readData.detail",
      invoke: (transport) => readDataModule(transport).detail({ mode: "annually", baseTime: 12 }),
      expected: {
        method: "GET",
        path: "/readdata/detail",
        options: { query: { mode: "annually", baseTime: 12 } },
      },
    },
    {
      name: "discover.recommend",
      invoke: (transport) => discoverModule(transport).recommend({ count: 8, maxIdx: 2 }),
      expected: {
        method: "GET",
        path: "/book/recommend",
        options: { query: { count: 8, maxIdx: 2 } },
      },
    },
    {
      name: "discover.similar",
      invoke: (transport) => discoverModule(transport).similar("book", { count: 8, maxIdx: 2, sessionId: "s" }),
      expected: {
        method: "GET",
        path: "/book/detailinfo",
        options: {
          query: { bookId: "book", listtypes: 2, synckey: 0, maxIdx: 2, count: 8, sessionId: "s" },
        },
      },
    },
    {
      name: "ai.suggest",
      invoke: (transport) =>
        aiModule(transport).suggest({ bookId: "book", chapterUid: 7, range: "1-2", mpReviewId: "review" }),
      expected: {
        method: "POST",
        path: "/ai/chat/suggest",
        options: { body: { bookId: "book", chapterUid: 7, mpReviewId: "review", range: "1-2" }, idempotent: true },
      },
    },
  ];

  /**
   * The smallest body each guarded operation's seam accepts. An operation absent from this map has
   * no seam assertion at all, so any object reaches the caller unchanged — which is what the
   * default `{ path }` body below exercises.
   */
  const seamMinimumBody: Record<string, unknown> = {
    "search.books": { books: [] },
    "search.suggest": { list: [], records: [], parts: [] },
    "shelf.sync": { books: [] },
    "notes.notebooks": { books: [], hasMore: 0 },
    "notes.recent": { books: [], items: [] },
    "notes.bookmarks": { updated: [] },
    "notes.mine": { reviews: [] },
    // Every list this seam looks at is optional, so the empty object really is the minimum.
    "notes.best": { items: [], hasMore: 0 },
    "notes.readReviews": { reviews: [] },
    "notes.underlines": { underlines: [] },
    "review.list": { reviews: [], hasMore: 0 },
    "discover.recommend": { books: [] },
    "discover.similar": { booksimilar: { books: [] } },
  };

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const transport = new RecordingTransport();
      const body = seamMinimumBody[testCase.name] ?? { path: testCase.expected.path };
      transport.responses.push(body);
      await expect(testCase.invoke(transport)).resolves.toEqual(body);
      expect(transport.calls).toEqual([
        {
          method: testCase.expected.method,
          path: testCase.expected.path,
          options: testCase.expected.options ?? {},
        },
      ]);
    });
  }

  it("review.add rejects a non-enum star rating at compile time and runtime", () => {
    // @ts-expect-error Star ratings are one of the public literal values.
    expect(() => reviewModule(new RecordingTransport()).add({ bookId: "book", content: "note", star: 37 })).toThrow(
      "star",
    );
  });

  it.each([
    ["search count", (transport: RecordingTransport) => searchModule(transport).books("q", { count: 0 })],
    ["suggest count", (transport: RecordingTransport) => searchModule(transport).suggest("q", { count: 0 })],
    ["notebook count", (transport: RecordingTransport) => notesModule(transport).notebooks({ count: -1 })],
    ["bookmark cursor", (transport: RecordingTransport) => notesModule(transport).bookmarks("book", { synckey: -1 })],
    [
      "review write fields",
      (transport: RecordingTransport) =>
        reviewModule(transport).add({ bookId: "book", content: "note", type: -1, chapterUid: -1 }),
    ],
    [
      "bookmark write fields",
      (transport: RecordingTransport) =>
        notesModule(transport).addBookmark({
          bookId: "book",
          chapterUid: -1,
          range: "1-2",
          markText: "text",
          style: -1,
        }),
    ],
    [
      "blank review content",
      (transport: RecordingTransport) => reviewModule(transport).add({ bookId: "book", content: " " }),
    ],
    [
      "similar-book session",
      (transport: RecordingTransport) => discoverModule(transport).similar("book", { sessionId: 1 as never }),
    ],
  ])("rejects invalid %s before transport", (_name, invoke) => {
    const transport = new RecordingTransport();
    expect(() => invoke(transport)).toThrow();
    expect(transport.calls).toHaveLength(0);
  });

  it("ai.askBook validates poll bounds before transport", async () => {
    const transport = new RecordingTransport();
    const sleep = vi.fn(async () => undefined);
    await expect(aiModule(transport, sleep).askBook({ bookId: "book", query: "q", maxPolls: 0 })).rejects.toThrow(
      "maxPolls",
    );
    expect(transport.calls).toHaveLength(0);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("bounded snapshot pagination", () => {
  it("pages the full notebook snapshot by count and last sort", async () => {
    const transport = new RecordingTransport();
    const snapshot = {
      totalBookCount: 3,
      hasMore: 1,
      books: [
        { bookId: "one", sort: 30 },
        { bookId: "two", sort: 20 },
        { bookId: "three", sort: 10 },
      ],
    };
    transport.responses.push(snapshot, snapshot);
    const notes = notesModule(transport);

    await expect(notes.notebooks({ count: 2 })).resolves.toMatchObject({
      books: [{ bookId: "one" }, { bookId: "two" }],
      hasMore: 1,
    });
    await expect(notes.notebooks({ count: 2, lastSort: 20 })).resolves.toMatchObject({
      books: [{ bookId: "three" }],
      hasMore: 0,
    });
  });

  it("preserves hasMore when the notebook endpoint already returns a bounded page", async () => {
    const transport = new RecordingTransport();
    transport.responses.push({
      books: [
        { bookId: "one", sort: 30 },
        { bookId: "two", sort: 20 },
      ],
      hasMore: 1,
    });

    await expect(notesModule(transport).notebooks({ count: 2 })).resolves.toMatchObject({
      books: [{ bookId: "one" }, { bookId: "two" }],
      hasMore: 1,
    });
  });

  it("turns cumulative popular highlights into disjoint pages with lookahead", async () => {
    const transport = new RecordingTransport();
    const items = ["zero", "one", "two", "three"].map((bookmarkId) => ({ bookmarkId }));
    transport.responses.push({ totalCount: 4, items }, { totalCount: 4, items });
    const notes = notesModule(transport);

    await expect(notes.best("book", { count: 2 })).resolves.toMatchObject({
      items: [{ bookmarkId: "zero" }, { bookmarkId: "one" }],
      hasMore: 1,
    });
    await expect(notes.best("book", { count: 2, maxIdx: 2 })).resolves.toMatchObject({
      items: [{ bookmarkId: "two" }, { bookmarkId: "three" }],
      hasMore: 0,
    });
    expect(transport.calls.map(({ options }) => options.query)).toEqual([
      { bookId: "book", chapterUid: 0, count: 3, maxIdx: 0, synckey: 0 },
      { bookId: "book", chapterUid: 0, count: 3, maxIdx: 2, synckey: 0 },
    ]);
  });

  it("widens review snapshots once and returns conventional disjoint pages", async () => {
    const transport = new RecordingTransport();
    const reviews = ["zero", "one", "two", "three"].map((reviewId) => ({ reviewId }));
    transport.responses.push({ reviews }, { reviews });
    const review = reviewModule(transport);

    await expect(review.list("book", { count: 2 })).resolves.toMatchObject({
      reviews: [{ reviewId: "zero" }, { reviewId: "one" }],
      hasMore: 1,
    });
    await expect(review.list("book", { count: 2, maxIdx: 2 })).resolves.toMatchObject({
      reviews: [{ reviewId: "two" }, { reviewId: "three" }],
      hasMore: 0,
    });
    expect(transport.calls.map(({ options }) => options.query)).toEqual([
      { bookId: "book", listType: 1, listMode: 0, mine: 0, synckey: 0, count: 3, maxIdx: 0 },
      { bookId: "book", listType: 1, listMode: 0, mine: 0, synckey: 0, count: 5, maxIdx: 0 },
    ]);
  });

  it("leaves nonzero synckey delta responses and wire arguments untouched", async () => {
    const transport = new RecordingTransport();
    transport.responses.push(
      { items: [{ bookmarkId: "delta" }], synckey: 10 },
      { reviews: [{ reviewId: "delta" }], synckey: 10, hasMore: 0 },
    );

    await expect(notesModule(transport).best("book", { count: 2, maxIdx: 4, synckey: 9 })).resolves.toEqual({
      items: [{ bookmarkId: "delta" }],
      synckey: 10,
    });
    await expect(reviewModule(transport).list("book", { count: 2, maxIdx: 4, synckey: 9 })).resolves.toEqual({
      reviews: [{ reviewId: "delta" }],
      synckey: 10,
      hasMore: 0,
    });
    expect(transport.calls.map(({ options }) => options.query)).toEqual([
      { bookId: "book", chapterUid: 0, count: 2, maxIdx: 4, synckey: 9 },
      { bookId: "book", listType: 1, listMode: 0, mine: 0, synckey: 9, count: 2, maxIdx: 4 },
    ]);
  });

  it("rejects snapshot windows that cannot include a safe lookahead", () => {
    const transport = new RecordingTransport();
    expect(() => notesModule(transport).best("book", { count: 1, maxIdx: Number.MAX_SAFE_INTEGER })).toThrow(
      "lookahead",
    );
    expect(() => reviewModule(transport).list("book", { count: 1, maxIdx: Number.MAX_SAFE_INTEGER })).toThrow(
      "lookahead",
    );
    expect(transport.calls).toHaveLength(0);
  });
});

describe("personal book import", () => {
  it("accepts an EPUB, uploads it, and notifies the shelf", async () => {
    const transport = new RecordingTransport();
    transport.responses.push(
      {
        bucket: "bucket",
        ObjectName: "/object",
        Response: {
          Credentials: { TmpSecretId: "id", TmpSecretKey: "key", Token: "token" },
          ExpiredTime: 123,
        },
      },
      { status: 1, bookId: "imported" },
    );
    const upload = vi.fn<CosUploader>(async () => undefined);
    const bytes = Buffer.from("personal book");

    await expect(importModule(transport, upload).book({ name: "novel.epub", bytes })).resolves.toEqual({
      bookId: "imported",
      deepLink: "https://weread.qq.com/web/reader/imported",
    });
    expect(upload.mock.calls[0]?.[0].bytes).toBe(bytes);
    expect(upload).toHaveBeenCalledWith({
      bucket: "bucket",
      key: "object",
      credentials: { TmpSecretId: "id", TmpSecretKey: "key", Token: "token" },
      expiredTime: 123,
      bytes: Buffer.from("personal book"),
    });
    expect(transport.calls).toEqual([
      {
        method: "GET",
        path: "/cos/getcredential",
        options: { query: { name: "novel", from: "" } },
      },
      {
        method: "POST",
        path: "/cos/notify",
        options: { query: { name: "novel.epub", path: "/object", cancel: "0" }, body: {} },
      },
    ]);
  });

  it("defensively copies non-Buffer byte inputs", async () => {
    const transport = new RecordingTransport();
    transport.responses.push(
      {
        bucket: "bucket",
        ObjectName: "/object",
        Response: {
          Credentials: { TmpSecretId: "id", TmpSecretKey: "key", Token: "token" },
          ExpiredTime: 123,
        },
      },
      { status: 1, bookId: "imported" },
    );
    const upload = vi.fn<CosUploader>(async () => undefined);
    const source = Uint8Array.from(Buffer.from("book"));

    const pending = importModule(transport, upload).book({ name: "novel.epub", bytes: source });
    source.fill(0);
    await pending;

    expect(upload.mock.calls[0]?.[0].bytes).not.toBe(source);
    expect(upload.mock.calls[0]?.[0].bytes).toEqual(Buffer.from("book"));
  });

  it("rejects an unsupported format before transport or upload", async () => {
    const transport = new RecordingTransport();
    const upload = vi.fn<CosUploader>(async () => undefined);
    await expect(
      importModule(transport, upload).book({ name: "novel.zip", bytes: Buffer.from("book") }),
    ).rejects.toThrow("unsupported format");
    expect(transport.calls).toHaveLength(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects an invalid path type before transport or upload", async () => {
    const transport = new RecordingTransport();
    const upload = vi.fn<CosUploader>(async () => undefined);
    await expect(importModule(transport, upload).book({ name: "novel.epub", path: 1 as never })).rejects.toThrow(
      "path must be a string",
    );
    expect(transport.calls).toHaveLength(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it("marks an unconfirmed shelf notification as ambiguous", async () => {
    const transport = new RecordingTransport();
    transport.responses.push({
      bucket: "bucket",
      ObjectName: "object",
      Response: {
        Credentials: { TmpSecretId: "id", TmpSecretKey: "key", Token: "token" },
        ExpiredTime: 123,
      },
    });
    const originalCall = transport.call.bind(transport);
    transport.call = async <T>(method: string, path: string, options: MobileCallOptions = {}) => {
      if (path === "/cos/notify") throw new Error("response lost");
      return originalCall<T>(method, path, options);
    };
    const rejection = importModule(
      transport,
      vi.fn<CosUploader>(async () => undefined),
    ).book({
      name: "novel.epub",
      bytes: Buffer.from("book"),
    });
    await expect(rejection).rejects.toBeInstanceOf(ImportPhaseError);
    await expect(rejection).rejects.toMatchObject({ phase: "post-notify", ambiguous: true });
  });

  it.each([
    [new WeReadApiError("business rejection", { path: "/cos/notify", status: 400 }), false],
    [new TransportError("request cancelled"), false],
    [new AuthError("authentication rejected"), false],
    [
      new WeReadApiError("authentication response lost", {
        path: "/cos/notify",
        status: 401,
        ambiguous: true,
      }),
      true,
    ],
    [new TransportError("response lost", { ambiguous: true }), true],
  ])("preserves typed notification ambiguity from %s", async (failure, ambiguous) => {
    const transport = new RecordingTransport();
    transport.responses.push({
      bucket: "bucket",
      ObjectName: "object",
      Response: {
        Credentials: { TmpSecretId: "id", TmpSecretKey: "key", Token: "token" },
        ExpiredTime: 123,
      },
    });
    const originalCall = transport.call.bind(transport);
    transport.call = async <T>(method: string, path: string, options: MobileCallOptions = {}) => {
      if (path === "/cos/notify") throw failure;
      return originalCall<T>(method, path, options);
    };

    await expect(
      importModule(
        transport,
        vi.fn<CosUploader>(async () => undefined),
      ).book({ name: "novel.epub", bytes: Buffer.from("book") }),
    ).rejects.toMatchObject({ phase: "post-notify", ambiguous, cause: failure });
  });

  it("reads a supported personal file path before upload", async () => {
    const root = mkdtempSync(join(tmpdir(), "weread-import-"));
    temporaryRoots.push(root);
    const path = join(root, "personal.epub");
    writeFileSync(path, "from disk");
    const transport = new RecordingTransport();
    transport.responses.push(
      {
        bucket: "bucket",
        ObjectName: "object",
        Response: {
          Credentials: { TmpSecretId: "id", TmpSecretKey: "key", Token: "token" },
          ExpiredTime: 123,
        },
      },
      { status: 1, bookId: "imported" },
    );
    const upload = vi.fn<CosUploader>(async () => undefined);
    await importModule(transport, upload).book({ name: "personal.epub", path });
    expect(upload.mock.calls[0]?.[0].bytes).toEqual(Buffer.from("from disk"));
  });

  it("rejects incomplete temporary credentials before upload", async () => {
    const transport = new RecordingTransport();
    transport.responses.push({
      bucket: "bucket",
      ObjectName: "object",
      Response: {
        Credentials: { TmpSecretId: "", TmpSecretKey: "key", Token: "token" },
        ExpiredTime: 123,
      },
    });
    const upload = vi.fn<CosUploader>(async () => undefined);
    await expect(
      importModule(transport, upload).book({ name: "personal.epub", bytes: Buffer.from("book") }),
    ).rejects.toMatchObject({ name: "WeReadApiError", path: "/cos/getcredential", status: 200 });
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 1 }, true],
    [{ status: 0 }, false],
  ])("classifies a known notification failure %#", async (notification, ambiguous) => {
    const transport = new RecordingTransport();
    transport.responses.push(
      {
        bucket: "bucket",
        ObjectName: "object",
        Response: {
          Credentials: { TmpSecretId: "id", TmpSecretKey: "key", Token: "token" },
          ExpiredTime: 123,
        },
      },
      notification,
    );
    const rejection = importModule(
      transport,
      vi.fn<CosUploader>(async () => undefined),
    ).book({
      name: "personal.epub",
      bytes: Buffer.from("book"),
    });
    await expect(rejection).rejects.toMatchObject({
      name: "ImportPhaseError",
      phase: "post-notify",
      ambiguous,
    });
  });

  it("rejects empty and ambiguous inputs before transport", async () => {
    const transport = new RecordingTransport();
    const resource = importModule(
      transport,
      vi.fn<CosUploader>(async () => undefined),
    );
    await expect(resource.book({ name: "", bytes: Buffer.from("book") })).rejects.toThrow("filename");
    await expect(resource.book({ name: "personal.epub", bytes: Buffer.alloc(0) })).rejects.toThrow("bytes");
    expect(transport.calls).toHaveLength(0);
  });
});

describe("AI polling", () => {
  it("carries session identity through partial frames and stops on a completion signal", async () => {
    const transport = new RecordingTransport();
    transport.responses.push(
      {
        chatid: "chat",
        session_id: "session",
        request_interval: 9,
        result: { text: "partial", has_more: 1 },
      },
      {
        result: { text: "answer", has_more: 1 },
        thinking_result: { text: "reasoning" },
        extra_sections: { has_more: false },
      },
    );
    const sleep = vi.fn(async () => undefined);
    await expect(
      aiModule(transport, sleep).askBook({ bookId: "book", query: "question", delayCapMs: 5 }),
    ).resolves.toEqual({
      text: "answer",
      thinking: "reasoning",
      chatid: "chat",
      sessionId: "session",
      complete: true,
    });
    expect(sleep).toHaveBeenCalledWith(5, undefined);
    expect(transport.calls[1]?.options.body).toMatchObject({
      bookId: "book",
      query: "question",
      chatid: "chat",
      session_id: "session",
    });
  });

  it("does not stop on a textless sections-done frame", async () => {
    const transport = new RecordingTransport();
    transport.responses.push(
      { result: { text: "", has_more: 1 }, extra_sections: { has_more: false } },
      { result: { text: "answer", has_more: 0 } },
    );
    const sleep = vi.fn(async () => undefined);
    const result = await aiModule(transport, sleep).askBook({ bookId: "book", query: "question" });
    expect(transport.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ text: "answer", complete: true });
  });

  it("keeps the streamed answer when the terminal frame omits the text", async () => {
    // WeRead's terminal frame (has_more: 0) need not repeat the body text. Overwriting
    // `text` per frame discarded the whole answer and still reported complete: true.
    const transport = new RecordingTransport();
    transport.responses.push(
      { chatid: "c1", session_id: "s1", result: { text: "the answer", has_more: 1 } },
      { result: { has_more: 0 } },
    );
    const result = await aiModule(
      transport,
      vi.fn(async () => undefined),
    ).askBook({ bookId: "book", query: "question" });
    expect(result).toMatchObject({ text: "the answer", complete: true });
  });

  it("does not stop early on a textless sections-done frame after text has arrived", async () => {
    // Guards the termination predicate: it must test THIS frame's text, not whether any
    // text has ever been seen, or keeping the last good value terminates a frame early.
    const transport = new RecordingTransport();
    transport.responses.push(
      { result: { text: "partial", has_more: 1 } },
      { result: { text: "", has_more: 1 }, extra_sections: { has_more: false } },
      { result: { text: "final", has_more: 0 } },
    );
    const result = await aiModule(
      transport,
      vi.fn(async () => undefined),
    ).askBook({ bookId: "book", query: "question" });
    expect(transport.calls).toHaveLength(3);
    expect(result).toMatchObject({ text: "final", complete: true });
  });

  it("keeps mid-stream thinking when the terminal frame omits it", async () => {
    const transport = new RecordingTransport();
    transport.responses.push(
      { thinking_result: { text: "reasoning" }, result: { text: "partial", has_more: 1 } },
      { result: { text: "answer", has_more: 0 } },
    );
    const result = await aiModule(
      transport,
      vi.fn(async () => undefined),
    ).askBook({ bookId: "book", query: "question" });
    expect(result).toMatchObject({ text: "answer", thinking: "reasoning", complete: true });
  });

  it("does not claim completion when no text ever arrived", async () => {
    const transport = new RecordingTransport();
    transport.responses.push({ result: { has_more: 0 } });
    const result = await aiModule(
      transport,
      vi.fn(async () => undefined),
    ).askBook({ bookId: "book", query: "question" });
    expect(result).toMatchObject({ text: "", complete: false });
  });

  it("reports an exhausted poll bound without claiming completion", async () => {
    const transport = new RecordingTransport();
    transport.responses.push({ result: { text: "partial", has_more: 1 } });
    const result = await aiModule(
      transport,
      vi.fn(async () => undefined),
    ).askBook({
      bookId: "book",
      query: "question",
      maxPolls: 1,
    });
    expect(result).toMatchObject({ text: "partial", complete: false });
  });
});

describe("book.chapters response handling", () => {
  const chapters = (body: unknown) => {
    const transport = new RecordingTransport();
    transport.responses.push(body);
    return bookModule(transport).chapters("book");
  };

  it("fails instead of fabricating a result when data is missing", async () => {
    // {} previously became {bookId, synckey: 0, chapters: []} — indistinguishable from a book
    // that genuinely has no table of contents.
    await expect(chapters({})).rejects.toThrow(/chapter data/);
  });

  it("returns an empty listing when data is present but empty", async () => {
    // A book with no chapters is a valid answer and must not throw.
    await expect(chapters({ data: [] })).resolves.toMatchObject({ bookId: "book", chapters: [] });
  });

  it("does not return a non-array as chapters", async () => {
    // `chapters` is typed ChapterInfo[]; a consumer calling .map() must not get a TypeError.
    const result = await chapters({ data: [{ bookId: "book", synckey: 7, updated: "not-an-array" }] });
    expect(Array.isArray(result.chapters)).toBe(true);
    expect(result.chapters).toEqual([]);
  });
});

/**
 * The wire-to-public seam.
 *
 * `MobileClient.call` casts the parsed JSON to the declared type and checks only that it is an
 * object, so before this every declared array was a promise nothing kept: `books: null` surfaced
 * as a TypeError inside the consumer's own `.map()` with nothing naming the SDK. Each operation
 * that declares a list now asserts it, and the failure is a `WeReadApiError` carrying the path.
 *
 * Every guarded field gets a rejection case here — a guard with no negative test is a guard that
 * can be deleted without anything going red.
 */
describe("response shape at each resource seam", () => {
  const seams = {
    "search.books": { path: "/store/search", call: (t: RecordingTransport) => searchModule(t).books("dune") },
    "search.suggest": { path: "/store/suggest", call: (t: RecordingTransport) => searchModule(t).suggest("dun") },
    "book.detail": { path: "/book/detailinfo", call: (t: RecordingTransport) => bookModule(t).detail("b") },
    "shelf.sync": { path: "/shelf/sync", call: (t: RecordingTransport) => shelfModule(t).sync() },
    "notes.notebooks": { path: "/user/notebooks", call: (t: RecordingTransport) => notesModule(t).notebooks() },
    "notes.bookmarks": { path: "/book/bookmarklist", call: (t: RecordingTransport) => notesModule(t).bookmarks("b") },
    "notes.mine": { path: "/review/list", call: (t: RecordingTransport) => notesModule(t).mine("b") },
    "notes.best": { path: "/book/bestbookmarks", call: (t: RecordingTransport) => notesModule(t).best("b") },
    "notes.readReviews": {
      path: "/book/readreviews",
      call: (t: RecordingTransport) => notesModule(t).readReviews("b", 1, [{ range: "1-2" }]),
    },
    "notes.underlines": {
      path: "/book/underlines",
      call: (t: RecordingTransport) => notesModule(t).underlines("b", 1),
    },
    "review.list": { path: "/review/list", call: (t: RecordingTransport) => reviewModule(t).list("b") },
    "readData.detail": { path: "/readdata/detail", call: (t: RecordingTransport) => readDataModule(t).detail() },
    "discover.recommend": { path: "/book/recommend", call: (t: RecordingTransport) => discoverModule(t).recommend() },
    "discover.similar": { path: "/book/detailinfo", call: (t: RecordingTransport) => discoverModule(t).similar("b") },
    "ai.suggest": {
      path: "/ai/chat/suggest",
      call: (t: RecordingTransport) =>
        aiModule(
          t,
          vi.fn(async () => undefined),
        ).suggest({ bookId: "b" }),
    },
  } as const;

  const run = (operation: keyof typeof seams, body: unknown) => {
    const transport = new RecordingTransport();
    transport.responses.push(body);
    return seams[operation].call(transport);
  };

  const rejections: Array<{ operation: keyof typeof seams; body: unknown; detail: string }> = [
    { operation: "search.books", body: { books: null }, detail: "books is null, not an array" },
    { operation: "search.books", body: { books: [], parts: "x" }, detail: "parts is a string, not an array" },
    {
      operation: "search.suggest",
      body: { list: [], records: null, parts: [] },
      detail: "records is null, not an array",
    },
    {
      operation: "book.detail",
      body: { skuImages: { urls: [] }, authorOpus: { books: [] }, copyRightOpus: { books: 1 } },
      detail: "copyRightOpus.books is a number, not an array",
    },
    { operation: "shelf.sync", body: { albums: [] }, detail: "books is missing, not an array" },
    { operation: "shelf.sync", body: { books: [], albums: "none" }, detail: "albums is a string, not an array" },
    {
      operation: "shelf.sync",
      body: { books: [], albums: [], archive: { name: "x" } },
      detail: "archive is an object, not an array",
    },
    { operation: "notes.notebooks", body: { books: 0 }, detail: "books is a number, not an array" },
    { operation: "notes.bookmarks", body: {}, detail: "updated is missing, not an array" },
    {
      operation: "notes.bookmarks",
      body: { updated: [], chapters: "one" },
      detail: "chapters is a string, not an array",
    },
    { operation: "notes.mine", body: { reviews: {} }, detail: "reviews is an object, not an array" },
    { operation: "notes.best", body: { items: "one" }, detail: "items is a string, not an array" },
    { operation: "notes.best", body: { items: [], chapters: 3 }, detail: "chapters is a number, not an array" },
    { operation: "notes.readReviews", body: { reviews: null }, detail: "reviews is null, not an array" },
    { operation: "notes.underlines", body: { underlines: "" }, detail: "underlines is a string, not an array" },
    { operation: "review.list", body: { reviews: null }, detail: "reviews is null, not an array" },
    {
      operation: "review.list",
      body: { reviews: [], friendCommentUsers: {} },
      detail: "friendCommentUsers is an object, not an array",
    },
    { operation: "readData.detail", body: { readStat: "s" }, detail: "readStat is a string, not an array" },
    { operation: "readData.detail", body: { readLongest: 1 }, detail: "readLongest is a number, not an array" },
    { operation: "readData.detail", body: { preferCategory: {} }, detail: "preferCategory is an object, not an array" },
    { operation: "readData.detail", body: { preferTime: 5 }, detail: "preferTime is a number, not an array" },
    { operation: "readData.detail", body: { preferAuthor: "a" }, detail: "preferAuthor is a string, not an array" },
    { operation: "readData.detail", body: { preferPublisher: true }, detail: "preferPublisher is a boolean" },
    { operation: "readData.detail", body: { preferCp: {} }, detail: "preferCp is an object, not an array" },
    { operation: "readData.detail", body: { medals: 1 }, detail: "medals is a number, not an array" },
    { operation: "readData.detail", body: { preferBooks: "b" }, detail: "preferBooks is a string, not an array" },
    { operation: "readData.detail", body: { yearReport: false }, detail: "yearReport is a boolean, not an array" },
    { operation: "readData.detail", body: { readTimeGears: {} }, detail: "readTimeGears is an object, not an array" },
    { operation: "discover.recommend", body: { books: null }, detail: "books is null, not an array" },
    { operation: "discover.similar", body: {}, detail: "booksimilar is missing, not an object" },
    { operation: "discover.similar", body: { booksimilar: [] }, detail: "booksimilar is an array, not an object" },
    {
      operation: "discover.similar",
      body: { booksimilar: { books: null } },
      detail: "booksimilar.books is null, not an array",
    },
    { operation: "ai.suggest", body: { questions: "q" }, detail: "questions is a string, not an array" },
    { operation: "ai.suggest", body: { questionHints: 2 }, detail: "questionHints is a number, not an array" },
    { operation: "ai.suggest", body: { prompts: {} }, detail: "prompts is an object, not an array" },
  ];

  it.each(rejections)("$operation rejects $detail", async ({ operation, body, detail }) => {
    const rejection = run(operation, body);
    await expect(rejection).rejects.toThrow(detail);
    await expect(rejection).rejects.toMatchObject({ name: "WeReadApiError", path: seams[operation].path, status: 200 });
  });

  const acceptances: Array<{ operation: keyof typeof seams; body: unknown; expected?: unknown; because: string }> = [
    { operation: "search.books", body: { books: [] }, because: "an empty result is a real answer" },
    {
      operation: "search.suggest",
      body: { list: [], records: [], parts: [] },
      because: "no completion is a real answer",
    },
    {
      operation: "book.detail",
      body: { skuImages: { urls: [] }, authorOpus: { books: [] }, copyRightOpus: {} },
      because: "a book may have no rightsholder catalog",
    },
    { operation: "shelf.sync", body: { books: [], albums: [] }, because: "archive is optional" },
    // Regression: the live `/shelf/sync` omits `albums` entirely for an account with no album
    // collections. Every fixture here hand-wrote `albums: []`, so nothing caught the seam rejecting
    // a healthy HTTP 200 that simply had no albums.
    { operation: "shelf.sync", body: { books: [] }, because: "the endpoint omits albums for an account with none" },
    { operation: "notes.bookmarks", body: { updated: [], chapters: [] }, because: "both lists present" },
    // Regression: the live `/book/bestbookmarks` answers exactly this — HTTP 200, `{"synckey":0}`
    // — for a book with no community highlights, which is every user-imported (`CB_…`) book. The
    // seam required `items`, so `notes.best` threw on all of them.
    {
      operation: "notes.best",
      body: { synckey: 0 },
      expected: { synckey: 0, items: [], hasMore: 0 },
      because: "a book with no highlights sends only a synckey",
    },
    { operation: "readData.detail", body: { totalReadTime: 1 }, because: "every list here is optional" },
    { operation: "ai.suggest", body: {}, because: "a suggestion response may carry no lists at all" },
  ];

  it.each(acceptances)("$operation accepts a body where $because", async ({ operation, body, expected }) => {
    await expect(run(operation, body)).resolves.toEqual(expected ?? body);
  });

  it("normalises an explicit null on an optional list away instead of contradicting the type", async () => {
    // The declared type is `X[] | undefined`. Leaving a JSON null in place would hand the caller a
    // value its own declaration says cannot be there, which is the failure mode this seam exists
    // to remove — and `chapters !== undefined` would then still reach `.map()` on null.
    await expect(run("notes.bookmarks", { updated: [], chapters: null })).resolves.toEqual({ updated: [] });
    // `albums` reaches the same branch now that it is optional rather than required. It used to be
    // rejected outright ("albums is null, not an array"); pinning the new answer here keeps that
    // change deliberate rather than a side effect of moving the field across the seam's two lists.
    await expect(run("shelf.sync", { books: [], albums: null })).resolves.toEqual({ books: [] });
    // Same move for `items`, for the same reason.
    await expect(run("notes.best", { synckey: 0, items: null })).resolves.toEqual({
      synckey: 0,
      items: [],
      hasMore: 0,
    });
    await expect(
      run("book.detail", {
        skuImages: { urls: [] },
        authorOpus: { books: [] },
        copyRightOpus: { books: null },
      }),
    ).resolves.toEqual({ skuImages: { urls: [] }, authorOpus: { books: [] }, copyRightOpus: {} });
  });

  it.each([
    [[], "non-empty array"],
    [[{ range: "" }], "range"],
    [[null], "range"],
    [[{ range: "1-2", count: 0 }], "count"],
    [[{ range: "1-2", count: 21 }], "count"],
    [[{ range: "1-2", count: "5" }], "count"],
    [[{ range: "1-2", maxIdx: -1 }], "maxIdx"],
    [[{ range: "1-2", synckey: 1.5 }], "synckey"],
  ])("rejects a malformed read-review query before transport: %j", (reviews, message) => {
    const transport = new RecordingTransport();
    expect(() => notesModule(transport).readReviews("book", 1, reviews as never)).toThrow(message);
    expect(transport.calls).toHaveLength(0);
  });
});

describe("askBook replay safety", () => {
  it("does not mark the opening poll replay-safe", async () => {
    // The first request carries no chatid/session_id, so an auto-replay would start a second
    // inference session rather than resume this one. Continuation polls are safe.
    const transport = new RecordingTransport();
    transport.responses.push(
      { chatid: "c1", session_id: "s1", result: { text: "partial", has_more: 1 } },
      { result: { text: "done", has_more: 0 } },
    );
    await aiModule(
      transport,
      vi.fn(async () => undefined),
    ).askBook({ bookId: "book", query: "q" });
    expect(transport.calls[0]?.options.idempotent).toBe(false);
    expect(transport.calls[1]?.options.idempotent).toBe(true);
  });
});

const cosCredential = {
  bucket: "bucket",
  ObjectName: "object",
  Response: {
    Credentials: { TmpSecretId: "id", TmpSecretKey: "key", Token: "token" },
    ExpiredTime: 123,
  },
};

/**
 * Every public operation has to accept a signal and hand it to the transport. A method that
 * silently drops it is indistinguishable from one that never had it — the caller sees a request
 * that outlives its abort — so this is asserted for every mobile operation, driven off the
 * operation registry so
 * a new operation cannot be added without one.
 */
describe("cancellation reaches every public operation", () => {
  const noSleep = () => vi.fn(async () => undefined);

  const invocations: Array<[string, (transport: RecordingTransport, signal: AbortSignal) => Promise<unknown>]> = [
    ["search.books", (t, signal) => searchModule(t).books("keyword", { signal })],
    ["search.suggest", (t, signal) => searchModule(t).suggest("keyword", { signal })],
    ["book.info", (t, signal) => bookModule(t).info("book", { signal })],
    ["book.detail", (t, signal) => bookModule(t).detail("book", { signal })],
    [
      "book.chapters",
      (t, signal) => {
        t.responses.push({ data: [{ bookId: "book", synckey: 1, updated: [] }] });
        return bookModule(t).chapters("book", { signal });
      },
    ],
    ["book.progress", (t, signal) => bookModule(t).progress("book", { signal })],
    ["shelf.sync", (t, signal) => shelfModule(t).sync({ signal })],
    ["shelf.add", (t, signal) => shelfModule(t).add("book", { signal })],
    ["shelf.delete", (t, signal) => shelfModule(t).delete("book", { signal })],
    ["shelf.pin", (t, signal) => shelfModule(t).pin("book", true, { signal })],
    ["shelf.setPrivate", (t, signal) => shelfModule(t).setPrivate("book", true, { signal })],
    ["shelf.markFinished", (t, signal) => shelfModule(t).markFinished("book", true, { signal })],
    ["shelf.markReading", (t, signal) => shelfModule(t).markReading("book", true, { signal })],
    ["publicAccounts.subscriptions", (t, signal) => publicAccountsModule(t).subscriptions({ signal })],
    ["publicAccounts.articles", (t, signal) => publicAccountsModule(t).articles("MP_WXS_1", { signal })],
    [
      "publicAccounts.resolveArticle",
      (t, signal) => {
        t.responses.push({ reviewIds: [{ url: "https://mp.weixin.qq.com/s/id", reviewId: "review" }] });
        return publicAccountsModule(t).resolveArticle("https://mp.weixin.qq.com/s/id", { signal });
      },
    ],
    [
      "publicAccounts.paidContent",
      (t, signal) => {
        // An empty result is a hard failure on this route, so the canned reply must carry an entry.
        t.responses.push({ data: [{ url: "https://mp.weixin.qq.com/s?id=1", content: "<p>paid</p>" }] });
        return publicAccountsModule(t).paidContent("https://mp.weixin.qq.com/s?id=1", { signal });
      },
    ],
    ["publicAccounts.subscribe", (t, signal) => publicAccountsModule(t).subscribe("MP_WXS_1", { signal })],
    ["publicAccounts.unsubscribe", (t, signal) => publicAccountsModule(t).unsubscribe("MP_WXS_1", { signal })],
    ["notes.notebooks", (t, signal) => notesModule(t).notebooks({ signal })],
    ["notes.recent", (t, signal) => notesModule(t).recent({ signal })],
    ["notes.bookmarks", (t, signal) => notesModule(t).bookmarks("book", { signal })],
    ["notes.mine", (t, signal) => notesModule(t).mine("book", { signal })],
    ["notes.best", (t, signal) => notesModule(t).best("book", { signal })],
    ["notes.readReviews", (t, signal) => notesModule(t).readReviews("book", 1, [{ range: "0-1" }], { signal })],
    ["notes.underlines", (t, signal) => notesModule(t).underlines("book", 1, { signal })],
    [
      "notes.addBookmark",
      (t, signal) => notesModule(t).addBookmark({ bookId: "book", chapterUid: 1, range: "0-1", markText: "x", signal }),
    ],
    [
      "notes.updateBookmark",
      (t, signal) => notesModule(t).updateBookmark({ bookmarkId: "bookmark", style: 2, signal }),
    ],
    ["notes.removeBookmark", (t, signal) => notesModule(t).removeBookmark("bookmark", { signal })],
    ["review.list", (t, signal) => reviewModule(t).list("book", { signal })],
    ["review.single", (t, signal) => reviewModule(t).single("review", { signal })],
    ["review.add", (t, signal) => reviewModule(t).add({ bookId: "book", content: "hi", signal })],
    ["review.edit", (t, signal) => reviewModule(t).edit("review", "replacement", { signal })],
    ["review.delete", (t, signal) => reviewModule(t).delete("review", { signal })],
    ["readData.detail", (t, signal) => readDataModule(t).detail({ signal })],
    ["discover.recommend", (t, signal) => discoverModule(t).recommend({ signal })],
    ["discover.similar", (t, signal) => discoverModule(t).similar("book", { signal })],
    [
      "ai.askBook",
      (t, signal) => {
        t.responses.push({ chatid: "c", session_id: "s", result: { text: "answer", has_more: 0 } });
        return aiModule(t, noSleep()).askBook({ bookId: "book", query: "q", signal });
      },
    ],
    ["ai.suggest", (t, signal) => aiModule(t, noSleep()).suggest({ bookId: "book", signal })],
    [
      "import.book",
      (t, signal) => {
        t.responses.push(cosCredential, { status: 1, bookId: "imported" });
        return importModule(
          t,
          vi.fn<CosUploader>(async () => undefined),
        ).book({ name: "novel.epub", bytes: Buffer.from("book"), signal });
      },
    ],
  ];

  it("covers the whole public operation registry and nothing else", () => {
    const registered = Object.entries(PUBLIC_OPERATIONS)
      .flatMap(([namespace, operations]) => operations.map((operation) => `${namespace}.${operation}`))
      .sort();
    expect(invocations.map(([name]) => name).sort()).toEqual(registered);
    expect(registered).toHaveLength(40);
  });

  it.each(invocations)("%s passes its signal to every request it makes", async (_name, invoke) => {
    const transport = new RecordingTransport();
    const signal = new AbortController().signal;
    await invoke(transport, signal);
    expect(transport.calls.length).toBeGreaterThan(0);
    for (const call of transport.calls) expect(call.options.signal).toBe(signal);
  });

  it.each(invocations)("%s still works with no signal at all", async (_name, invoke) => {
    const transport = new RecordingTransport();
    // The parameter is optional everywhere: the existing call shapes must keep compiling and
    // must not start sending an `undefined` the transport treats as a real value.
    await invoke(transport, undefined as unknown as AbortSignal);
    for (const call of transport.calls) expect(call.options.signal).toBeUndefined();
  });
});

describe("AI polling cancellation", () => {
  it("ends during the sleep between polls instead of waiting the delay out", async () => {
    // The default sleep is used deliberately: a loop that only re-checks the signal between
    // requests would sit here for the full delayCapMs after the caller has already gone.
    const transport = new RecordingTransport();
    // A minute-long `request_interval`, uncapped: only an abortable delay can make this reject
    // inside the test timeout. A loop that merely re-checked the signal after the sleep would
    // sit here for the full sixty seconds first.
    transport.responses.push({
      chatid: "c",
      session_id: "s",
      request_interval: 60_000,
      result: { text: "partial", has_more: 1 },
    });
    const caller = new AbortController();
    const answer = aiModule(transport).askBook({
      bookId: "book",
      query: "q",
      delayCapMs: 60_000,
      signal: caller.signal,
    });
    const rejection = expect(answer).rejects.toThrow("ai.askBook: request aborted");
    await Promise.resolve();
    caller.abort(new DOMException("caller gone", "AbortError"));
    await rejection;
    expect(transport.calls).toHaveLength(1);
  });

  it("does not issue another poll when an injected sleep ignores the abort", async () => {
    // `MobileResourceDependencies.sleep` is caller-supplied and need not honour the signal, so
    // the loop re-checks rather than trusting it.
    const transport = new RecordingTransport();
    transport.responses.push({ chatid: "c", session_id: "s", result: { text: "partial", has_more: 1 } });
    const caller = new AbortController();
    const sleep = vi.fn(async () => {
      caller.abort(new DOMException("caller gone", "AbortError"));
    });
    await expect(
      aiModule(transport, sleep).askBook({ bookId: "book", query: "q", signal: caller.signal }),
    ).rejects.toBeInstanceOf(TransportError);
    expect(sleep).toHaveBeenCalledOnce();
    expect(transport.calls).toHaveLength(1);
  });
});

describe("import cancellation", () => {
  it("waits for the default uploader to clean up before reporting cancellation", async () => {
    const transport = new RecordingTransport();
    transport.responses.push(cosCredential);
    const caller = new AbortController();
    let finishCleanup: () => void = () => undefined;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    let cleanupStarted = false;
    defaultCosUpload.mockImplementationOnce(async ({ signal }) => {
      try {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new TransportError("COS upload: request aborted", { cause: signal?.reason });
      } finally {
        cleanupStarted = true;
        await cleanup;
      }
    });

    const rejection = importModule(transport).book({
      name: "novel.epub",
      bytes: Buffer.from("book"),
      signal: caller.signal,
    });
    await vi.waitFor(() => expect(defaultCosUpload).toHaveBeenCalledOnce());
    caller.abort(new DOMException("caller gone", "AbortError"));
    await vi.waitFor(() => expect(cleanupStarted).toBe(true));

    let settled = false;
    void rejection.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    finishCleanup();
    await expect(rejection).rejects.toMatchObject({ name: "TransportError", cause: caller.signal.reason });
    expect(transport.calls.map((call) => call.path)).toEqual(["/cos/getcredential"]);
  });

  it("reports a definite failure, not an ambiguous one, when the abort lands before the notify", async () => {
    // `/cos/notify` never went out, so the shelf import definitively did not occur. Classifying
    // that as ambiguous would tell the caller to check a shelf that cannot possibly have changed.
    const transport = new RecordingTransport();
    transport.responses.push(cosCredential);
    const caller = new AbortController();
    const upload = vi.fn<CosUploader>(() => new Promise(() => undefined));
    const rejection = importModule(transport, upload).book({
      name: "novel.epub",
      bytes: Buffer.from("book"),
      signal: caller.signal,
    });
    await vi.waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ signal: caller.signal })));
    caller.abort(new DOMException("caller gone", "AbortError"));
    await expect(rejection).rejects.toThrow("import.book: request aborted");
    await expect(rejection).rejects.not.toBeInstanceOf(ImportPhaseError);
    expect(transport.calls.map((call) => call.path)).toEqual(["/cos/getcredential"]);
  });
});
