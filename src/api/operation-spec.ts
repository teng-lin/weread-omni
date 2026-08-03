/**
 * The declarative description of every projected operation.
 *
 * `PUBLIC_OPERATIONS` (`./operations.ts`) names the canonical operations and nothing else — it
 * is the stable root export and stays exactly that. This module is the part that was missing:
 * for each projected operation, the parameters it accepts, their **defaults**, and the write gate
 * it sits behind, in one place a projection can be generated from.
 *
 * Why it exists. The product's claim is that one surface is projected into the SDK, the CLI, and
 * the skill. That claim used to be maintained by hand in up to seven places per
 * operation — the name here, the option type in `types.ts`, the defaults in the resource module,
 * the JSON Schema, the argument mapping, an entry in a flat
 * 42-field argument bag, and the CLI flags — and merely *checked* afterwards by tests. Two
 * consequences that were not hypothetical:
 *
 * * **defaults were invisible.** `notes.best` returns 20 notes when `count` is omitted, but that
 *   number lived only inside `resources/notes.ts`. An agent reading the `weread_notes_best`
 *   schema could not learn it, and neither could `--help`.
 * * **the argument bag did not type anything.** Every tool shared one `ToolArguments` interface
 *   with 42 optional fields, so `args.maxIdx` type-checked inside the handler of a tool that has
 *   no `maxIdx`.
 *
 * This module is deliberately **not exported** from `src/index.ts` or `src/cli.ts`.
 * It is an internal spine, not a second public registry: freezing its shape would trade one
 * hand-maintained surface for another. Consumers that need the canonical list still read
 * `PUBLIC_OPERATIONS`.
 *
 * Declaring a default here is a claim about what the SDK actually sends. That claim is not taken
 * on trust: `test/integration/operation-defaults.test.ts` calls each operation with its required
 * arguments only and asserts the advertised default is the value that reaches the wire, including
 * for the handful that transform it first — an inverted flag, a per-catalog fan-out, a pagination
 * lookahead. A default that stops being sent has to be enumerated there, with a reason.
 */

import type { ReadDataOptions, ReadReviewQuery, SearchScope, StarRating } from "./types.js";

export const STAR_RATINGS = [20, 40, 60, 80, 100] as const;
export const READ_DATA_MODES = ["weekly", "monthly", "annually", "overall"] as const;
export const SEARCH_SCOPES = [0, 2, 4, 6, 10, 12, 13, 14, 16] as const;
export const PUBLIC_ACCOUNT_ID_PATTERN = "^MP_WXS_[0-9]+$";

/**
 * The write gates a projected operation can sit behind. The names classify what kind of write an
 * operation performs; `WEREAD_READONLY` closes all of them together.
 */
export type OperationGate = "upload" | "delete" | "shelf" | "review" | "notes";

type ReadDataMode = NonNullable<ReadDataOptions["mode"]>;

/** Books the shelf projection returns when the caller does not ask for a page size. */
export const DEFAULT_SHELF_COUNT = 50;
export const MAX_SHELF_COUNT = 200;

interface ParameterBase {
  readonly description: string;
}

export interface StringParameter extends ParameterBase {
  readonly kind: "string";
  readonly default?: string;
  readonly pattern?: string;
}

export interface IntegerParameter extends ParameterBase {
  readonly kind: "integer";
  readonly default?: number;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface BooleanParameter extends ParameterBase {
  readonly kind: "boolean";
  readonly default?: boolean;
}

/** The five-value WeRead star scale, kept as its own kind so it narrows to `StarRating`. */
export interface StarParameter extends ParameterBase {
  readonly kind: "star";
}

export interface ReadModeParameter extends ParameterBase {
  readonly kind: "readMode";
  readonly default?: ReadDataMode;
}

export interface SearchScopeParameter extends ParameterBase {
  readonly kind: "searchScope";
  readonly default?: SearchScope;
}

export interface ReviewQueriesParameter extends ParameterBase {
  readonly kind: "reviewQueries";
}

export type OperationParameter =
  | StringParameter
  | IntegerParameter
  | BooleanParameter
  | StarParameter
  | ReadModeParameter
  | SearchScopeParameter
  | ReviewQueriesParameter;

interface ValueByKind {
  string: string;
  integer: number;
  boolean: boolean;
  star: StarRating;
  readMode: ReadDataMode;
  searchScope: SearchScope;
  reviewQueries: ReadReviewQuery[];
}

export type ParameterMap = Readonly<Record<string, OperationParameter>>;

export interface OperationSpec<
  P extends ParameterMap = ParameterMap,
  R extends readonly (keyof P & string)[] = readonly (keyof P & string)[],
> {
  /** The `PUBLIC_OPERATIONS` namespace, or a non-canonical one (`upload`). */
  readonly resource: string;
  readonly action: string;
  /** One-line description of the operation. */
  readonly summary: string;
  readonly parameters: P;
  readonly required: R;
  readonly gate?: OperationGate;
  readonly destructive?: boolean;
  /** Static `_meta` for the projected tool. Dynamic meta (the upload widget) is merged later. */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** JSON Schema keywords merged into the generated schema — `import.book`'s `oneOf`. */
  readonly schemaExtras?: Readonly<Record<string, unknown>>;
}

type ValueOf<P extends ParameterMap, K extends PropertyKey> = K extends keyof P ? ValueByKind[P[K]["kind"]] : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * The arguments one operation accepts: its required parameters, plus its optional ones. Derived
 * from the spec, so a handler that reads a parameter its own tool does not declare fails to
 * compile — which the shared 42-field argument bag could never do.
 */
export type OperationArguments<S extends OperationSpec> =
  S extends OperationSpec<infer P, infer R>
    ? Simplify<{ [K in R[number]]: ValueOf<P, K> } & { [K in Exclude<keyof P, R[number]>]?: ValueOf<P, K> }>
    : never;

/** Preserves the literal parameter names and required tuple through inference. */
const operation = <P extends ParameterMap, const R extends readonly (keyof P & string)[]>(
  spec: OperationSpec<P, R>,
): OperationSpec<P, R> => spec;

const text = (description: string, options: Omit<StringParameter, "kind" | "description"> = {}): StringParameter => ({
  kind: "string",
  description,
  ...options,
});

const whole = (
  description: string,
  options: Omit<IntegerParameter, "kind" | "description"> = {},
): IntegerParameter => ({ kind: "integer", description, ...options });

const flag = (description: string, options: Omit<BooleanParameter, "kind" | "description"> = {}): BooleanParameter => ({
  kind: "boolean",
  description,
  ...options,
});

const star = (description: string): StarParameter => ({ kind: "star", description });

const readMode = (
  description: string,
  options: Omit<ReadModeParameter, "kind" | "description"> = {},
): ReadModeParameter => ({ kind: "readMode", description, ...options });

const searchScope = (description: string): SearchScopeParameter => ({ kind: "searchScope", description, default: 10 });
const reviewQueries = (description: string): ReviewQueriesParameter => ({ kind: "reviewQueries", description });

// Wording shared by parameters that recur across operations. Each call returns a fresh object so
// no two operations share a parameter instance.
const bookId = () => text("The WeRead book identifier.");
const publicAccountId = () =>
  text("The WeRead public-account identifier.", {
    pattern: PUBLIC_ACCOUNT_ID_PATTERN,
  });
const synckey = () =>
  whole("Delta synchronization cursor returned by a previous refresh; not a page offset.", {
    default: 0,
    minimum: 0,
  });
const count = (fallback: number) => whole("Maximum number of items to return.", { default: fallback, minimum: 1 });
const maxIdx = () => whole("Pagination offset into the result set.", { default: 0, minimum: 0 });

/**
 * Every operation the CLI projects.
 * `test/unit/operation-spec.test.ts` asserts this set and `PUBLIC_OPERATIONS` stay in step.
 */
export const OPERATIONS = {
  searchBooks: operation({
    resource: "search",
    action: "books",
    summary: "Search the WeRead catalog.",
    parameters: {
      keyword: text("Search query matched against the selected WeRead search tab."),
      scope: searchScope(
        "Search tab: 0 all, 10 ebooks, 16 web fiction, 14 audio, 6 authors, 12 full text, 13 booklists, 2 accounts, 4 articles.",
      ),
      count: whole("Maximum results to return; omit to use WeRead's page size.", { minimum: 1 }),
      maxIdx: maxIdx(),
    },
    required: ["keyword"],
  }),
  searchSuggest: operation({
    resource: "search",
    action: "suggest",
    summary: "Suggest WeRead search completions.",
    parameters: {
      keyword: text("Partial search query to complete."),
      count: count(10),
    },
    required: ["keyword"],
  }),
  bookInfo: operation({
    resource: "book",
    action: "info",
    summary: "Get book metadata.",
    parameters: { bookId: bookId() },
    required: ["bookId"],
  }),
  bookDetail: operation({
    resource: "book",
    action: "detail",
    summary: "Get product images and bounded author/rightsholder catalogs.",
    parameters: {
      bookId: bookId(),
      count: whole("Entries to return from each catalog.", {
        default: 6,
        minimum: 1,
        maximum: 12,
      }),
    },
    required: ["bookId"],
  }),
  bookChapters: operation({
    resource: "book",
    action: "chapters",
    summary: "List a book's chapters.",
    parameters: { bookId: bookId() },
    required: ["bookId"],
  }),
  bookProgress: operation({
    resource: "book",
    action: "progress",
    summary: "Get reading progress for a book.",
    parameters: { bookId: bookId() },
    required: ["bookId"],
  }),
  shelfSync: operation({
    resource: "shelf",
    action: "sync",
    summary:
      `List the active WeRead shelf with titles, authors and reading progress, ${DEFAULT_SHELF_COUNT} entries at a ` +
      "time. The raw shelf carries ~48 store/DRM fields per book and would not fit in one result, so this returns " +
      "only listing fields plus compact audio albums and article-collection presence. totalCount includes books, " +
      "albums, and the article collection. When the result has nextOffset, call again with that offset for the rest.",
    parameters: {
      count: whole("Shelf entries to return.", {
        default: DEFAULT_SHELF_COUNT,
        minimum: 1,
        maximum: MAX_SHELF_COUNT,
      }),
      offset: whole("Index of the first shelf entry to return. Use nextOffset from the previous call.", {
        default: 0,
        minimum: 0,
      }),
    },
    required: [],
  }),
  shelfAdd: operation({
    resource: "shelf",
    action: "add",
    summary: "Add a book to the shelf.",
    parameters: { bookId: bookId() },
    required: ["bookId"],
    gate: "shelf",
  }),
  shelfDelete: operation({
    resource: "shelf",
    action: "delete",
    summary: "Remove a book from the shelf.",
    parameters: { bookId: bookId() },
    required: ["bookId"],
    gate: "delete",
    destructive: true,
  }),
  shelfPin: operation({
    resource: "shelf",
    action: "pin",
    summary: "Pin or unpin a shelf book.",
    parameters: { bookId: bookId(), top: flag("Pin the book when true; unpin when false.", { default: true }) },
    required: ["bookId"],
    gate: "shelf",
  }),
  shelfSetPrivate: operation({
    resource: "shelf",
    action: "setPrivate",
    summary: "Toggle private reading for a book.",
    parameters: {
      bookId: bookId(),
      secret: flag("Make the book private when true; public when false.", { default: true }),
    },
    required: ["bookId"],
    gate: "shelf",
  }),
  shelfMarkFinished: operation({
    resource: "shelf",
    action: "markFinished",
    summary: "Mark a book finished or unread.",
    parameters: {
      bookId: bookId(),
      finished: flag("Mark the book finished when true; unread when false.", { default: true }),
    },
    required: ["bookId"],
    gate: "shelf",
  }),
  shelfMarkReading: operation({
    resource: "shelf",
    action: "markReading",
    summary: "Mark a book as reading (在读) or clear the reading status.",
    parameters: {
      bookId: bookId(),
      reading: flag("Mark the book as reading when true; clear the status when false.", { default: true }),
    },
    required: ["bookId"],
    gate: "shelf",
  }),
  publicAccountsSubscriptions: operation({
    resource: "publicAccounts",
    action: "subscriptions",
    summary: "List subscribed public accounts from the WeRead shelf.",
    parameters: {
      count: whole("Subscriptions to return.", { default: 50, minimum: 1 }),
      offset: whole("Zero-based subscription offset.", { default: 0, minimum: 0 }),
    },
    required: [],
  }),
  publicAccountsArticles: operation({
    resource: "publicAccounts",
    action: "articles",
    summary: "List article history for a subscribed public account.",
    parameters: {
      accountId: publicAccountId(),
      // Both official clients request 50 here.
      count: count(50),
      // The route takes two distinct shapes, and the official clients never mix them. The first
      // request carries `synckey` and no offset; every later page carries `offset` and no synckey.
      // Sending an offset on the first request matches neither, which is what this used to do.
      synckey: synckey(),
      offset: whole("Zero-based article offset. Omit for the first request; then use nextOffset.", { minimum: 0 }),
    },
    required: ["accountId"],
  }),
  publicAccountsResolveArticle: operation({
    resource: "publicAccounts",
    action: "resolveArticle",
    summary: "Resolve a public article URL to its WeRead review identifier.",
    parameters: {
      docUrl: text("Public article URL to resolve."),
    },
    required: ["docUrl"],
  }),
  publicAccountsPaidContent: operation({
    resource: "publicAccounts",
    action: "paidContent",
    summary: "Fetch an entitled paid public-account article body.",
    parameters: {
      docUrl: text("Article URL taken from the review's mpInfo.doc_url."),
    },
    required: ["docUrl"],
  }),
  publicAccountsSubscribe: operation({
    resource: "publicAccounts",
    action: "subscribe",
    summary: "Subscribe to a public account through the WeRead shelf.",
    parameters: { accountId: publicAccountId() },
    required: ["accountId"],
    gate: "shelf",
  }),
  publicAccountsUnsubscribe: operation({
    resource: "publicAccounts",
    action: "unsubscribe",
    summary: "Unsubscribe from a public account through the WeRead shelf.",
    parameters: { accountId: publicAccountId() },
    required: ["accountId"],
    gate: "delete",
    destructive: true,
  }),
  notesNotebooks: operation({
    resource: "notes",
    action: "notebooks",
    summary: "List notebooks with notes.",
    parameters: {
      count: count(20),
      lastSort: whole("Pagination cursor from a previous page of notebooks.", { minimum: 0 }),
    },
    required: [],
  }),
  notesRecent: operation({
    resource: "notes",
    action: "recent",
    summary: "List a bounded account-wide snapshot of recent notes and highlights.",
    parameters: {
      count: whole("Maximum recent notes and highlights to return.", { default: 20, minimum: 1, maximum: 100 }),
    },
    required: [],
  }),
  notesBookmarks: operation({
    resource: "notes",
    action: "bookmarks",
    summary:
      "List a book's highlights (划线, type=1) with their text (`markText`); type-0 bookmarks are excluded by the " +
      "endpoint. Refresh incrementally via `synckey`.",
    parameters: { bookId: bookId(), synckey: synckey() },
    required: ["bookId"],
  }),
  notesMine: operation({
    resource: "notes",
    action: "mine",
    summary: "List the user's notes for a book.",
    parameters: { bookId: bookId(), count: count(20), synckey: synckey() },
    required: ["bookId"],
  }),
  notesBest: operation({
    resource: "notes",
    action: "best",
    summary: "List popular notes for a book.",
    parameters: {
      bookId: bookId(),
      chapterUid: whole("Chapter UID, or 0 for the whole book.", { default: 0, minimum: 0 }),
      count: count(20),
      maxIdx: whole("Zero-based snapshot page offset; the SDK removes upstream prefix repeats.", {
        default: 0,
        minimum: 0,
      }),
      synckey: synckey(),
    },
    required: ["bookId"],
  }),
  notesReadReviews: operation({
    resource: "notes",
    action: "readReviews",
    summary: "Read thoughts and comments attached to one or more popular-highlight ranges.",
    parameters: {
      bookId: bookId(),
      chapterUid: whole("Chapter UID containing the highlight ranges.", { minimum: 0 }),
      reviews: reviewQueries("One or more {range, count?, maxIdx?, synckey?} queries; count is capped at 20."),
    },
    required: ["bookId", "chapterUid", "reviews"],
  }),
  notesUnderlines: operation({
    resource: "notes",
    action: "underlines",
    summary: "Per-chapter highlight heat statistics (range, count, score, type) — no highlight text is returned.",
    parameters: {
      bookId: bookId(),
      chapterUid: whole("The chapter identifier (chapterUid).", { minimum: 0 }),
      synckey: synckey(),
    },
    required: ["bookId", "chapterUid"],
  }),
  notesAddBookmark: operation({
    resource: "notes",
    action: "addBookmark",
    summary: "Add a highlight (划线) to a book.",
    parameters: {
      bookId: bookId(),
      chapterUid: whole("The chapter identifier (chapterUid) the highlight belongs to.", { minimum: 0 }),
      range: text("Character range within the chapter, e.g. '777-778'."),
      markText: text("The highlighted text to record."),
      type: whole("Bookmark type.", { default: 1, minimum: 0 }),
      style: whole("Highlight style.", { default: 1, minimum: 0 }),
      colorStyle: whole("Highlight color style.", { default: 0, minimum: 0 }),
      bookVersion: whole("Book version the highlight was made against.", { minimum: 0 }),
      chapterName: text("Chapter name the highlight belongs to."),
      contextAbstract: text("Surrounding context text for the highlight."),
    },
    required: ["bookId", "chapterUid", "range", "markText"],
    gate: "notes",
  }),
  notesUpdateBookmark: operation({
    resource: "notes",
    action: "updateBookmark",
    summary: "Change a highlight's style and optional color.",
    parameters: {
      bookmarkId: text("Identifier of the highlight to update."),
      style: whole("Highlight style.", { minimum: 0 }),
      colorStyle: whole("Highlight color style.", { minimum: 0 }),
    },
    required: ["bookmarkId", "style"],
    gate: "notes",
  }),
  notesRemoveBookmark: operation({
    resource: "notes",
    action: "removeBookmark",
    summary: "Delete one of the user's highlights.",
    parameters: { bookmarkId: text("Identifier of the highlight to delete.") },
    required: ["bookmarkId"],
    gate: "notes",
    destructive: true,
  }),
  reviewList: operation({
    resource: "review",
    action: "list",
    summary: "List reviews for a book.",
    parameters: {
      bookId: bookId(),
      listType: whole("Review list type filter.", { default: 1, minimum: 0 }),
      listMode: whole("Review list mode filter.", { default: 0, minimum: 0 }),
      mine: whole("When set, restrict the results to the user's own reviews.", {
        default: 0,
        minimum: 0,
        maximum: 1,
      }),
      synckey: synckey(),
      count: count(20),
      maxIdx: maxIdx(),
    },
    required: ["bookId"],
  }),
  reviewSingle: operation({
    resource: "review",
    action: "single",
    summary: "Get one thought or review with its rich-text detail.",
    parameters: {
      reviewId: text("Identifier of the thought or review."),
      commentsCount: count(10),
      commentsDirection: whole("Comment order: 0 descending, 1 ascending.", { default: 0, minimum: 0, maximum: 1 }),
      likesCount: count(10),
      likesDirection: whole("Like order: 0 descending, 1 ascending.", { default: 0, minimum: 0, maximum: 1 }),
      synckey: synckey(),
    },
    required: ["reviewId"],
  }),
  reviewAdd: operation({
    resource: "review",
    action: "add",
    summary: "Post a review or thought.",
    parameters: {
      bookId: bookId(),
      content: text("The review or thought text to post."),
      type: whole("Review type.", { default: 1, minimum: 0 }),
      star: star("Star rating: 20, 40, 60, 80, or 100 (one to five stars)."),
      range: text("Character range in the chapter this thought annotates."),
      abstract: text("Quoted book text the thought refers to."),
      chapterUid: whole("Chapter identifier the thought belongs to.", { minimum: 0 }),
    },
    required: ["bookId", "content"],
    gate: "review",
  }),
  reviewEdit: operation({
    resource: "review",
    action: "edit",
    summary: "Edit the text of one of the user's reviews or thoughts.",
    parameters: {
      reviewId: text("Identifier of the review to edit."),
      content: text("Replacement review or thought text."),
    },
    required: ["reviewId", "content"],
    gate: "review",
  }),
  reviewDelete: operation({
    resource: "review",
    action: "delete",
    summary: "Delete one of the user's reviews.",
    parameters: { reviewId: text("Identifier of the review to delete.") },
    required: ["reviewId"],
    gate: "review",
    destructive: true,
  }),
  readDataDetail: operation({
    resource: "readData",
    action: "detail",
    summary: "Get reading statistics.",
    parameters: {
      mode: readMode("Aggregation window for the statistics.", { default: "monthly" }),
      baseTime: whole("Base timestamp (seconds) anchoring the aggregation window.", { minimum: 0 }),
    },
    required: [],
  }),
  discoverRecommend: operation({
    resource: "discover",
    action: "recommend",
    summary: "Get personalized book recommendations.",
    parameters: { count: count(12), maxIdx: maxIdx() },
    required: [],
  }),
  discoverSimilar: operation({
    resource: "discover",
    action: "similar",
    summary: "Find books similar to a given book.",
    parameters: {
      bookId: bookId(),
      count: count(12),
      maxIdx: maxIdx(),
      sessionId: text("Recommendation session identifier."),
    },
    required: ["bookId"],
  }),
  aiAskBook: operation({
    resource: "ai",
    action: "askBook",
    summary: "Ask WeRead AI a question about a book.",
    parameters: {
      bookId: bookId(),
      query: text("The question to ask WeRead AI about the book."),
      intent: text("Optional prompt intent hint.", { default: "" }),
      maxPolls: whole("Maximum number of times to poll for the streamed answer.", {
        minimum: 1,
        maximum: 100,
        default: 80,
      }),
      delayCapMs: whole("Upper bound in milliseconds on the delay between polls.", {
        minimum: 1,
        maximum: 60_000,
        default: 1500,
      }),
    },
    required: ["bookId", "query"],
  }),
  aiSuggest: operation({
    resource: "ai",
    action: "suggest",
    summary: "Get suggested AI questions for a book.",
    parameters: {
      bookId: bookId(),
      chapterUid: whole("Chapter identifier to scope the suggestions.", { default: 0, minimum: 0 }),
      toolbar: flag("Request toolbar-style prompts instead of follow-up questions.", { default: false }),
      range: text("Character range in the chapter to scope the suggestions.", { default: "" }),
      mpReviewId: text("Review identifier to base follow-up suggestions on.", { default: "" }),
    },
    required: ["bookId"],
  }),
  importBook: operation({
    resource: "import",
    action: "book",
    summary: "Finish importing a personal book from a local file path.",
    parameters: {
      src_key: text("Storage key of a file previously uploaded via weread_upload_book."),
      path: text("Absolute path to a regular book file inside the server's WEREAD_LOCAL_IMPORT_ROOT."),
      name: text("Display name for the book, including its file extension."),
      overrideUnknownOutcome: text(
        "Only after an 'import outcome unknown' error AND checking the shelf with " +
          "weread_shelf_sync: the sha256 content digest that error reported, to import these " +
          "bytes anyway. Never guess it — a wrong or blind retry is what creates a duplicate.",
      ),
    },
    required: ["name"],
    gate: "upload",
    schemaExtras: { oneOf: [{ required: ["src_key"] }, { required: ["path"] }] },
  }),
} as const;

/** Required parameters of kind `string`, which the projection rejects when blank. */
export function requiredTextParameters(spec: OperationSpec): readonly string[] {
  return spec.required.filter((name) => spec.parameters[name]?.kind === "string");
}

export function assertReadReviewQueries(reviews: unknown): asserts reviews is ReadReviewQuery[] {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    throw new TypeError("reviews must be a non-empty array");
  }
  for (const review of reviews) {
    if (!review || typeof review !== "object" || typeof (review as ReadReviewQuery).range !== "string") {
      throw new TypeError("each review query must have a non-empty range");
    }
    const query = review as ReadReviewQuery;
    if (!query.range.trim()) throw new TypeError("each review query must have a non-empty range");
    if (query.count !== undefined && (!Number.isSafeInteger(query.count) || query.count < 1 || query.count > 20)) {
      throw new RangeError("review query count must be an integer from 1 to 20");
    }
    if (query.maxIdx !== undefined && (!Number.isSafeInteger(query.maxIdx) || query.maxIdx < 0)) {
      throw new RangeError("review query maxIdx must be a non-negative safe integer");
    }
    if (query.synckey !== undefined && (!Number.isSafeInteger(query.synckey) || query.synckey < 0)) {
      throw new RangeError("review query synckey must be a non-negative safe integer");
    }
  }
}

export function assertOperationParameter(name: string, parameter: OperationParameter, value: unknown): void {
  if (value === undefined) return;
  switch (parameter.kind) {
    case "string":
      if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
      if (parameter.pattern !== undefined && !new RegExp(parameter.pattern).test(value)) {
        throw new TypeError(`${name} must match ${parameter.pattern}`);
      }
      return;
    case "integer":
      if (typeof value !== "number") throw new TypeError(`${name} must be a number`);
      if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer`);
      if (parameter.minimum !== undefined && value < parameter.minimum) {
        throw new RangeError(`${name} must be at least ${parameter.minimum}`);
      }
      if (parameter.maximum !== undefined && value > parameter.maximum) {
        throw new RangeError(`${name} must be at most ${parameter.maximum}`);
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
      return;
    case "star":
      if (typeof value !== "number") throw new TypeError(`${name} must be a number`);
      if (!STAR_RATINGS.includes(value as StarRating)) {
        throw new RangeError(`${name} must be one of ${STAR_RATINGS.join(", ")}`);
      }
      return;
    case "readMode":
      if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
      if (!READ_DATA_MODES.includes(value as (typeof READ_DATA_MODES)[number])) {
        throw new RangeError(`${name} must be one of ${READ_DATA_MODES.join(", ")}`);
      }
      return;
    case "searchScope":
      if (typeof value !== "number") throw new TypeError(`${name} must be a number`);
      if (!SEARCH_SCOPES.includes(value as SearchScope)) {
        throw new RangeError(`${name} must be one of ${SEARCH_SCOPES.join(", ")}`);
      }
      return;
    case "reviewQueries":
      assertReadReviewQueries(value);
  }
}

export function assertOperationArguments(spec: OperationSpec, input: object): void {
  const arguments_ = input as Record<string, unknown>;
  for (const name of spec.required) {
    const value = arguments_[name];
    if (value === undefined) throw new TypeError(`${name} is required`);
    if (spec.parameters[name]?.kind === "string" && typeof value === "string" && !value.trim()) {
      throw new TypeError(`${name} must not be blank`);
    }
  }
  for (const [name, parameter] of Object.entries(spec.parameters)) {
    assertOperationParameter(name, parameter, arguments_[name]);
  }
}

export function parameterHelp(parameter: OperationParameter): string {
  const details: string[] = [];
  if ("default" in parameter && parameter.default !== undefined)
    details.push(`default: ${JSON.stringify(parameter.default)}`);
  if (parameter.kind === "integer") {
    if (parameter.minimum !== undefined) details.push(`min: ${parameter.minimum}`);
    if (parameter.maximum !== undefined) details.push(`max: ${parameter.maximum}`);
  }
  return details.length === 0 ? parameter.description : `${parameter.description} (${details.join(", ")})`;
}
