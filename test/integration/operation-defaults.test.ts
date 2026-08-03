import { describe, expect, it } from "vitest";
import type { MobileCallOptions, MobileResponse } from "../../src/api/mobile.js";
import { OPERATIONS } from "../../src/api/operation-spec.js";
import { aiModule } from "../../src/api/resources/ai.js";
import { bookModule } from "../../src/api/resources/book.js";
import { discoverModule } from "../../src/api/resources/discover.js";
import { notesModule } from "../../src/api/resources/notes.js";
import { publicAccountsModule } from "../../src/api/resources/public-accounts.js";
import { readDataModule } from "../../src/api/resources/read-data.js";
import { reviewModule } from "../../src/api/resources/review.js";
import { searchModule } from "../../src/api/resources/search.js";
import { shelfModule } from "../../src/api/resources/shelf.js";
import type { MobileTransport } from "../../src/api/types.js";

/**
 * Declaring a default in `operation-spec.ts` is a claim about what the SDK actually sends.
 *
 * The spec's own doc comment promised this file for a long time before it existed, so a default
 * could be declared, rendered into `--help` and into the skill's schema, and never once compared
 * against the request. A wrong number there is invisible: the operation still works, it just
 * silently paginates or scopes differently from what every projection advertises.
 *
 * Each case below calls one operation with its REQUIRED arguments only and asserts that every
 * declared default arrives on the wire. Expectations are read from the spec rather than restated,
 * so changing a declared default without changing the resource module fails here.
 */

const ACCEPTED_BODY = {
  books: [],
  albums: [],
  data: [],
  updated: [],
  reviews: [],
  items: [],
  list: [],
  records: [],
  underlines: [],
  booksimilar: { books: [] },
  skuImages: { urls: [] },
  authorOpus: { books: [] },
  copyRightOpus: {},
};

class RecordingTransport implements MobileTransport {
  readonly calls: Array<{ method: string; path: string; options: MobileCallOptions }> = [];

  async call<T = unknown>(method: string, path: string, options: MobileCallOptions = {}): Promise<MobileResponse<T>> {
    this.calls.push({ method, path, options });
    return { status: 200, headers: new Headers(), body: { ...ACCEPTED_BODY } as T };
  }
}

type Resources = {
  search: ReturnType<typeof searchModule>;
  book: ReturnType<typeof bookModule>;
  shelf: ReturnType<typeof shelfModule>;
  publicAccounts: ReturnType<typeof publicAccountsModule>;
  notes: ReturnType<typeof notesModule>;
  review: ReturnType<typeof reviewModule>;
  readData: ReturnType<typeof readDataModule>;
  discover: ReturnType<typeof discoverModule>;
  ai: ReturnType<typeof aiModule>;
};

/**
 * Declared defaults whose wire form is not the declared value, each pinned to what is actually sent.
 *
 * A default describes the SDK's public contract; several operations transform it before the request.
 * Enumerating them here means the transformation is asserted too, so a lookahead that quietly
 * becomes `+2`, or an inverted flag that flips sense, fails this test rather than shipping.
 *
 * `undefined` asserts the key is absent from the request.
 */
const TRANSFORMED: Readonly<
  Record<string, Readonly<Record<string, { readonly key: string; readonly value: unknown; readonly why: string }>>>
> = {
  bookDetail: {
    count: { key: "count", value: "6,6,6", why: "one count per catalog: author, publisher, rightsholder" },
  },
  shelfPin: { top: { key: "isDel", value: 0, why: "upstream takes the inverse as a deletion flag" } },
  shelfSetPrivate: { secret: { key: "private", value: 1, why: "upstream takes a numeric flag" } },
  shelfMarkFinished: { finished: { key: "isCancel", value: 0, why: "upstream takes the inverse, numerically" } },
  shelfMarkReading: { reading: { key: "isCancel", value: 0, why: "upstream takes the inverse, numerically" } },
  notesBest: { count: { key: "count", value: 21, why: "first page asks one extra to detect a next page" } },
  reviewList: { count: { key: "count", value: 21, why: "first page asks one extra to detect a next page" } },
  aiSuggest: { toolbar: { key: "cmd", value: undefined, why: "false selects the body shape without `cmd`" } },
};

/**
 * Defaults that never reach any request, each with the reason.
 *
 * Enumerated rather than inferred: a default that stops being sent has to be added here on purpose.
 */
const NOT_SENT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // `/shelf/sync` takes no pagination; count and offset drive the local projection in shelf-view.ts.
  shelfSync: { count: "local projection, not a request parameter", offset: "local projection" },
  // Paged locally out of one `/shelf/sync` snapshot, for the same reason.
  publicAccountsSubscriptions: { count: "local projection over a shelf snapshot", offset: "local projection" },
  // Polling behaviour of the ask/answer loop, never serialized into a request.
  aiAskBook: { maxPolls: "client-side poll ceiling", delayCapMs: "client-side backoff cap" },
};

const CASES: ReadonlyArray<{ spec: keyof typeof OPERATIONS; call(resources: Resources): Promise<unknown> }> = [
  { spec: "searchBooks", call: (r) => r.search.books("keyword") },
  { spec: "searchSuggest", call: (r) => r.search.suggest("keyword") },
  { spec: "bookDetail", call: (r) => r.book.detail("book") },
  { spec: "shelfSync", call: (r) => r.shelf.sync() },
  { spec: "shelfPin", call: (r) => r.shelf.pin("book") },
  { spec: "shelfSetPrivate", call: (r) => r.shelf.setPrivate("book") },
  { spec: "shelfMarkFinished", call: (r) => r.shelf.markFinished("book") },
  { spec: "shelfMarkReading", call: (r) => r.shelf.markReading("book") },
  { spec: "publicAccountsSubscriptions", call: (r) => r.publicAccounts.subscriptions() },
  { spec: "publicAccountsArticles", call: (r) => r.publicAccounts.articles("MP_WXS_1") },
  { spec: "notesNotebooks", call: (r) => r.notes.notebooks() },
  { spec: "notesRecent", call: (r) => r.notes.recent() },
  { spec: "notesBookmarks", call: (r) => r.notes.bookmarks("book") },
  { spec: "notesMine", call: (r) => r.notes.mine("book") },
  { spec: "notesBest", call: (r) => r.notes.best("book") },
  { spec: "notesUnderlines", call: (r) => r.notes.underlines("book", 1) },
  { spec: "reviewList", call: (r) => r.review.list("book") },
  { spec: "reviewSingle", call: (r) => r.review.single("review") },
  { spec: "readDataDetail", call: (r) => r.readData.detail() },
  { spec: "discoverRecommend", call: (r) => r.discover.recommend() },
  { spec: "discoverSimilar", call: (r) => r.discover.similar("book") },
];

const declaredDefaults = (spec: keyof typeof OPERATIONS): Array<[string, unknown]> =>
  Object.entries(OPERATIONS[spec].parameters).flatMap(([name, parameter]) =>
    parameter.default === undefined ? [] : [[name, parameter.default] as [string, unknown]],
  );

/** Assert every default the spec declares for `spec` against one recorded request. */
function expectDeclaredDefaults(spec: keyof typeof OPERATIONS, sent: Record<string, unknown>): void {
  const exempt = NOT_SENT[spec] ?? {};
  const transformed = TRANSFORMED[spec] ?? {};
  for (const [name, value] of declaredDefaults(spec)) {
    if (name in exempt) continue;
    const wire = transformed[name];
    if (wire) {
      expect(sent[wire.key], `${spec}.${name} -> ${wire.key} (${wire.why})`).toEqual(wire.value);
      continue;
    }
    expect(sent[name], `${spec}.${name} declares ${JSON.stringify(value)}`).toEqual(value);
  }
}

const requestFields = (options: MobileCallOptions | undefined): Record<string, unknown> => ({
  ...(options?.query ?? {}),
  ...((options?.body as Record<string, unknown>) ?? {}),
});

describe("declared defaults reach the wire", () => {
  it("covers every operation that declares one", () => {
    const declaring = Object.keys(OPERATIONS).filter((key) =>
      Object.values(OPERATIONS[key as keyof typeof OPERATIONS].parameters).some((p) => p.default !== undefined),
    );
    const covered = new Set<string>(CASES.map((testCase) => testCase.spec));
    // Writes that take an input object rather than positional options are exercised separately
    // below; everything else has to appear in CASES.
    const separately = ["notesAddBookmark", "reviewAdd", "aiAskBook", "aiSuggest"];
    for (const key of separately) covered.add(key);

    expect(declaring.filter((key) => !covered.has(key))).toEqual([]);
  });

  it.each(CASES.map((testCase) => [testCase.spec, testCase] as const))("%s", async (spec, testCase) => {
    const transport = new RecordingTransport();
    const resources: Resources = {
      search: searchModule(transport),
      book: bookModule(transport),
      shelf: shelfModule(transport),
      publicAccounts: publicAccountsModule(transport),
      notes: notesModule(transport),
      review: reviewModule(transport),
      readData: readDataModule(transport),
      discover: discoverModule(transport),
      ai: aiModule(transport),
    };

    // The response guards are not what this test is about; only the request that was already
    // recorded matters, so a rejection after the call is irrelevant.
    await testCase.call(resources).catch(() => undefined);

    const first = transport.calls[0];
    expect(first, `${spec} sent no request`).toBeDefined();
    expectDeclaredDefaults(spec, requestFields(first?.options));
  });

  it("sends the declared bookmark defaults", async () => {
    const transport = new RecordingTransport();
    await notesModule(transport)
      .addBookmark({ bookId: "book", chapterUid: 1, range: "1-2", markText: "text" })
      .catch(() => undefined);

    expectDeclaredDefaults("notesAddBookmark", requestFields(transport.calls[0]?.options));
  });

  it("sends the declared review defaults", async () => {
    const transport = new RecordingTransport();
    await reviewModule(transport)
      .add({ bookId: "book", content: "content" })
      .catch(() => undefined);

    expectDeclaredDefaults("reviewAdd", requestFields(transport.calls[0]?.options));
  });

  it("sends the declared suggest defaults", async () => {
    const transport = new RecordingTransport();
    await aiModule(transport)
      .suggest({ bookId: "book" })
      .catch(() => undefined);

    expectDeclaredDefaults("aiSuggest", requestFields(transport.calls[0]?.options));
  });
});
