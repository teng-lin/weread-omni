import { describe, expect, it } from "vitest";
import { DEFAULT_SHELF_COUNT, MAX_SHELF_COUNT, shelfView } from "../../src/shelf-view.js";

/** A synthetic `/shelf/sync` book: a handful of useful fields buried in store plumbing. */
const rawBook = (index: number) => ({
  bookId: `book-${index}`,
  title: `Title ${index}`,
  author: `Author ${index}`,
  translator: index % 2 === 0 ? `Translator ${index}` : "",
  category: "哲学宗教-东方哲学",
  format: "epub",
  finishReading: index % 2,
  cover: `https://rescdn.qqmail.com/weread/cover/${index}/very/long/path.jpg`,
  maxFreeInfo: { maxFreeChapterIdx: 24, maxFreeChapterUid: 24, maxFreeChapterRatio: 0.2 },
  categories: [{ categoryId: 600_000, subCategoryId: 600_001, categoryName: "哲学宗教" }],
  payType: 1_048_577,
  blockSaveImg: 0,
  isEPUBComics: 0,
});

const shelf = (books: number, progressFor: number[] = []) => ({
  bookCount: books,
  pureBookCount: books,
  synckey: 7,
  books: Array.from({ length: books }, (_, index) => rawBook(index)),
  bookProgress: progressFor.map((index) => ({
    bookId: `book-${index}`,
    progress: 42,
    readingTime: 60,
    chapterUid: 2,
    chapterOffset: 3,
    appId: "test-app",
    synckey: 7,
  })),
});

describe("shelf view", () => {
  it("counts and projects every visible shelf entry, including audio and article collections", () => {
    const view = shelfView({
      books: [
        { bookId: "public", title: "Public", deepLink: "weread://public", secret: 0 },
        { bookId: "private", title: "Private", secret: 1 },
      ],
      albums: [
        {
          albumInfo: { albumId: "audio", name: "Audio", authorName: "Narrator", trackCount: 12 },
          albumInfoExtra: { secret: 0 },
        },
      ],
      mp: { title: "article collection" },
      bookCount: 2,
    });

    expect(view).toMatchObject({
      bookCount: 2,
      albumCount: 1,
      totalCount: 4,
      publicCount: 2,
      privateCount: 2,
      returnedCount: 4,
      mp: true,
      albums: [{ albumId: "audio", name: "Audio", authorName: "Narrator", trackCount: 12, secret: false }],
    });
    expect(view.books[0]).toMatchObject({ bookId: "public", deepLink: "weread://public", secret: false });
  });

  it("does not count an empty article-collection object", () => {
    expect(shelfView({ books: [], mp: {} })).toMatchObject({
      totalCount: 0,
      privateCount: 0,
      returnedCount: 0,
    });
    expect(shelfView({ books: [], mp: {} })).not.toHaveProperty("mp");
  });

  it("keeps the listing fields and drops the store plumbing", () => {
    const view = shelfView(shelf(1));
    const book = view.books[0];
    expect(book).toMatchObject({
      bookId: "book-0",
      title: "Title 0",
      author: "Author 0",
      translator: "Translator 0",
      category: "哲学宗教-东方哲学",
      format: "epub",
      finished: false,
    });
    // The fields that made the raw payload unusable must not come back.
    for (const dropped of ["cover", "maxFreeInfo", "categories", "payType", "blockSaveImg", "isEPUBComics"]) {
      expect(book).not.toHaveProperty(dropped);
    }
  });

  it("joins reading progress onto the book it belongs to", () => {
    const view = shelfView(shelf(3, [1]));
    // The raw payload keeps progress in a separate id-keyed array, which is why a truncated result
    // could carry progress for many books and the name of none of them.
    expect(view.books[1]).toMatchObject({ bookId: "book-1", title: "Title 1", progress: 42, readingTime: 60 });
    expect(view.books[0]).not.toHaveProperty("progress");
    expect(view.books[2]).not.toHaveProperty("readingTime");
  });

  it("omits absent fields rather than emitting empty ones", () => {
    // Across a whole shelf a present-but-empty key costs more than it conveys.
    const view = shelfView({ books: [{ bookId: "b", title: "T", author: "", translator: "  " }] });
    expect(view.books[0]).toEqual({ bookId: "b", title: "T" });
  });

  it("pages, and says so, so the caller knows more is waiting", () => {
    const view = shelfView(shelf(125), { count: 50, offset: 0 });
    expect(view.returnedCount).toBe(50);
    expect(view.bookCount).toBe(125);
    expect(view.nextOffset).toBe(50);
    expect(view.note).toMatch(/1-50 of 125.*offset=50/);

    const last = shelfView(shelf(125), { count: 50, offset: 100 });
    expect(last.returnedCount).toBe(25);
    // No nextOffset is the signal to stop — its presence is the only "call again" marker.
    expect(last.nextOffset).toBeUndefined();
    expect(last.note).toMatch(/101-125 of 125/);
  });

  it("pages books, albums, and the article collection as one shelf", () => {
    const raw = {
      books: [rawBook(0), rawBook(1)],
      albums: [{ albumInfo: { albumId: "audio", name: "Audio" } }],
      mp: { title: "Articles" },
    };

    const pages = [0, 1, 2, 3].map((offset) => shelfView(raw, { count: 1, offset }));
    expect(pages.map(({ books, albums, mp }) => ({ books, albums, mp }))).toEqual([
      { books: [expect.objectContaining({ bookId: "book-0" })], albums: [], mp: undefined },
      { books: [expect.objectContaining({ bookId: "book-1" })], albums: [], mp: undefined },
      { books: [], albums: [expect.objectContaining({ albumId: "audio" })], mp: undefined },
      { books: [], albums: [], mp: true },
    ]);
    expect(pages.map((page) => page.nextOffset)).toEqual([1, 2, 3, undefined]);
    expect(pages.every((page) => page.returnedCount === 1)).toBe(true);
  });

  it("defaults to one page and clamps a caller who asks for too much or too little", () => {
    expect(shelfView(shelf(125)).returnedCount).toBe(DEFAULT_SHELF_COUNT);
    expect(shelfView(shelf(500), { count: 9_999 }).returnedCount).toBe(MAX_SHELF_COUNT);
    expect(shelfView(shelf(10), { count: 0 }).returnedCount).toBe(1);
    // Garbage from a model must not produce an empty or exploding page.
    expect(shelfView(shelf(10), { count: "abc", offset: -5 }).returnedCount).toBe(10);
    expect(shelfView(shelf(10), { offset: 999 })).toMatchObject({
      returnedCount: 0,
      note: "Showing 0 of 10 shelf entries.",
    });
  });

  it("survives a shelf body that is missing the parts it reads", () => {
    expect(shelfView(undefined)).toMatchObject({ bookCount: 0, returnedCount: 0, books: [] });
    expect(shelfView({})).toMatchObject({ bookCount: 0, books: [] });
    expect(shelfView({ books: "not-an-array", bookProgress: 7 })).toMatchObject({ books: [] });
  });

  it("brings a large shelf well under the default result cap", () => {
    // The regression this exists for: the raw body exceeded the result cap, and the surviving
    // prefix was the one block with no titles in it.
    const full = shelfView(
      shelf(
        125,
        Array.from({ length: 100 }, (_, index) => index),
      ),
    );
    const pretty = JSON.stringify(full, null, 2).length;
    expect(pretty).toBeLessThan(20_000);
    // And a full page still carries what a listing needs.
    expect(full.books[0]).toHaveProperty("title");
  });
});
