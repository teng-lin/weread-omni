import type { MobileResponse, MobileTransportCallOptions } from "./mobile.js";

export interface MobileTransport {
  call<T = unknown>(method: string, path: string, options?: MobileTransportCallOptions): Promise<MobileResponse<T>>;
}

/**
 * Cancellation, accepted by every public operation.
 *
 * Aborting rejects the operation with a `TransportError` and covers the whole request path,
 * including the access-token mint the request may have to wait for first. A mint shared with
 * other in-flight requests is not itself cancelled — only this caller stops waiting for it.
 */
export interface RequestOptions {
  signal?: AbortSignal;
}

/** One chapter's body, for a client that supplies `book.chapterContent` as an extra. */
export type ChapterContent =
  | {
      bookId: string;
      chapterUid: number;
      format: "epub";
      html: string;
      css?: string;
    }
  | {
      bookId: string;
      chapterUid: number;
      format: "txt";
      text: string;
      html: string;
    };

/**
 * ## What the response declarations below promise
 *
 * WeRead's mobile API is private and undocumented; this package neither owns nor versions it, and
 * `MobileClient.call` casts the parsed JSON straight to the types here. A declaration is therefore
 * a claim about somebody else's server, and the only claims kept are the ones the SDK enforces.
 *
 * The rule, applied throughout: **a field is required only where the SDK guarantees it.** That is
 * one of exactly two things — an array field a resource asserts at its seam (see
 * `response-guards.ts`), or a value the SDK itself constructs (`ChapterInfoResponse`,
 * `AskBookResult`, `ImportBookResult`). Everything else is optional, because it genuinely can be
 * absent and declaring otherwise only moves the failure into the consumer's code, where nothing
 * identifies the SDK as its source.
 *
 * Unknown upstream fields still arrive at runtime — the parsed body is passed through untouched —
 * they are simply not typed. The index signatures that used to type them (on `BookInfo` and
 * `ReadDataResponse`) are gone: `[key: string]: unknown` made every typo on a *curated* field
 * compile, which is a steep price for pass-through convenience. Reach for an untyped field with an
 * explicit cast, and expect no stability guarantee on it.
 */

export interface SyncCursor {
  /** Cursor for a later incremental refresh. It is not a list-page offset. */
  synckey?: number;
}

export interface BookInfo {
  bookId?: string;
  title?: string;
  deepLink?: string;
  author?: string;
  translator?: string;
  cover?: string;
  intro?: string;
  category?: string;
  publisher?: string;
  publishTime?: string;
  isbn?: string;
  wordCount?: number;
  newRating?: number;
  newRatingCount?: number;
  newRatingDetail?: { title?: string };
  payType?: number;
  price?: number;
  soldout?: number;
  type?: number;
  bookStatus?: number;
  format?: string;
  finished?: number;
}

/** Selector-backed panels returned by `book.detail`; every declared list is checked at the seam. */
export interface BookDetailResponse {
  skuImages: {
    urls: string[];
  };
  authorOpus: {
    books: Array<{ bookInfo?: BookInfo }>;
    totalCount?: number;
    synckey?: number;
    authorBooksHasMore?: number;
    uncertifiedUser?: { name?: string; authorId?: string; isSubscribed?: number };
  };
  copyRightOpus: {
    books?: Array<{ bookInfo?: BookInfo }>;
    totalCount?: number;
    synckey?: number;
    copyRightBooksHasMore?: number;
    user?: UserSummary & {
      role?: number;
      isHide?: number;
      isFollowing?: number;
    };
  };
}

export interface UserSummary {
  userVid?: string | number;
  name?: string;
  avatar?: string;
}

export interface ChapterInfo {
  chapterUid?: number;
  chapterIdx?: number;
  title?: string;
  wordCount?: number;
  level?: number;
  updateTime?: number;
  price?: number;
  paid?: number;
  isMPChapter?: number;
  anchors?: Array<{ title?: string; level?: number }>;
}

/** Search tabs accepted by `GET /store/search`. */
export type SearchScope = 0 | 2 | 4 | 6 | 10 | 12 | 13 | 14 | 16;

export interface SearchAuthorResult {
  word?: string;
  authorId?: string;
  recordType?: number;
  role?: number;
  bookId?: string;
  title?: string;
  recordDesc?: string;
  bookCount?: number;
}

export interface SearchBookContentResult {
  chapterUid?: number;
  chapterIdx?: number;
  chapterTitle?: string;
  abstract?: string;
  keyword?: string[];
}

export interface SearchBooklistResult {
  author?: UserSummary;
  booklistTitle?: string;
  booklistId?: string;
  collectCount?: number;
  books?: BookInfo[];
  totalCount?: number;
}

export interface SearchAudioResult {
  albumInfoNew?: {
    albumId?: string;
    name?: string;
    authorName?: string;
    cover?: string;
    trackCount?: number;
    intro?: string;
    isPodcast?: number;
    payType?: number;
  };
  albumInfo?: {
    albumId?: string;
    name?: string;
    authorName?: string;
    cover?: string;
    desc?: string;
    scheme?: string;
  };
}

export interface SearchResult {
  searchIdx?: number;
  bookInfo?: BookInfo;
  reading?: number;
  readingCount?: number;
  reason?: string;
  type?: number;
  scope?: number;
  scopeCount?: number;
  recordInfo?: SearchAuthorResult;
  bookContentInfo?: SearchBookContentResult;
  booklistInfo?: SearchBooklistResult;
  tsResultInfo?: SearchAudioResult;
}

/** `/store/search` returns a flat `books` array. */
export interface SearchResponse {
  sid?: string;
  queryUid?: string;
  hasMore?: number;
  totalCount?: number;
  correction?: string;
  parts?: string[];
  books: SearchResult[];
}

export interface SearchSuggestion {
  type?: number;
  word?: string;
  categoryId?: string;
  totalCount?: number;
  bookId?: string;
}

/** Autocomplete candidates returned by `GET /store/suggest`; every list is checked at the seam. */
export interface SearchSuggestResponse {
  keyword?: string;
  list: SearchSuggestion[];
  records: SearchSuggestion[];
  parts: string[];
}

/** Wholly constructed by `book.chapters`, so every field here really is guaranteed. */
export interface ChapterInfoResponse extends SyncCursor {
  bookId: string;
  synckey: number;
  chapterUpdateTime?: number;
  chapters: ChapterInfo[];
}

export interface BookProgress {
  bookId?: string;
  timestamp?: number;
  book?: {
    chapterUid?: number;
    chapterOffset?: number;
    progress?: number;
    updateTime?: number;
    recordReadingTime?: number;
    finishTime?: number;
    isStartReading?: number;
  };
}

export interface ShelfBook {
  bookId?: string;
  title?: string;
  deepLink?: string;
  author?: string;
  cover?: string;
  category?: string;
  readUpdateTime?: number;
  finishReading?: number;
  updateTime?: number;
  isTop?: number;
  secret?: number;
}

/** Upstream shelf metadata retained even though the public SDK has no audio operations. */
export interface ShelfAlbum {
  albumInfo?: {
    albumId?: string;
    name?: string;
    authorName?: string;
    cover?: string;
    trackCount?: number;
    finishStatus?: string;
    finish?: number;
    payType?: number;
    intro?: string;
    updateTime?: number;
  };
  albumInfoExtra?: {
    secret?: number;
    lecturePaid?: number;
    lectureReadUpdateTime?: number;
    isTop?: number;
  };
}

export interface ShelfArchive {
  name?: string;
  bookIds?: string[];
}

/**
 * `books` is asserted to be an array at the `/shelf/sync` seam, `albums` and `archive` when present.
 * Live responses can omit `albums` even when `books` is populated, while the same body still sends
 * other empty lists as `[]` — so nothing guarantees the field is there, and a field the seam does
 * not require is optional here (see `response-guards.ts`).
 */
export interface ShelfSyncResponse {
  books: ShelfBook[];
  albums?: ShelfAlbum[];
  mp?: Record<string, unknown> | null;
  archive?: ShelfArchive[];
  bookCount?: number;
}

/** A public-account shelf entry. Unmodelled shelf fields still pass through at runtime. */
export interface PublicAccount extends ShelfBook {
  accountId: string;
}

export interface PublicAccountSubscriptionsOptions extends RequestOptions {
  count?: number;
  offset?: number;
}

/** Constructed from one shelf snapshot after public-account IDs have been filtered. */
export interface PublicAccountSubscriptionsPage {
  accounts: PublicAccount[];
  returnedCount: number;
  requestedOffset: number;
  totalCount: number;
  nextOffset?: number;
}

/** One `/mp/chapters` entry; additional upstream fields pass through without being typed. */
export interface PublicAccountArticle {
  reviewId?: string;
  title?: string;
  createTime?: number;
  mpInfo?: ArticleMpInfo;
}

/** One entry from the paid-article endpoint. */
export interface PaidArticleEntry {
  url?: string;
  content?: string;
  /** Whether the account is entitled. False means `url` points at a preview instead. */
  ispaid?: boolean;
  fee?: number;
}

export interface PaidArticleResponse {
  entries: PaidArticleEntry[];
}

/** One article URL resolved to its WeRead review identifier. */
export interface PublicAccountArticleResolution {
  url: string;
  reviewId: string;
}

export interface PublicAccountArticlesOptions extends RequestOptions {
  count?: number;
  /**
   * Delta-synchronisation token for the *first* request, which is the only one that carries it.
   *
   * Zero for a fresh collection.
   */
  synckey?: number;
  /**
   * Zero-based article offset, for every request after the first.
   *
   * Mutually exclusive with `synckey`: the official clients open with a synckey and no offset,
   * then page with an offset and no synckey. Supplying this switches the request to the paging
   * shape, so leave it undefined for the first call.
   */
  offset?: number;
}

/** Constructed around the asserted `/mp/chapters` `data` article array. */
export interface PublicAccountArticlesPage {
  accountId: string;
  articles: PublicAccountArticle[];
  returnedCount: number;
  requestedOffset: number;
  /** Absent once the server returns a short page, which is how this route signals exhaustion. */
  nextOffset?: number;
  /** Upstream delta-sync token, surfaced unchanged. Not a page cursor. */
  synckey?: number;
  hasMore?: 0 | 1;
}

export interface NotebookBook {
  bookId?: string;
  book?: {
    bookId?: string;
    title?: string;
    author?: string;
    cover?: string;
  };
  reviewCount?: number;
  noteCount?: number;
  bookmarkCount?: number;
  readingProgress?: number;
  markedStatus?: number;
  sort?: number;
}

/** `books` is asserted and client-paged at the `/user/notebooks` seam. */
export interface NotebooksResponse {
  totalBookCount?: number;
  totalNoteCount?: number;
  hasMore?: number;
  books: NotebookBook[];
}

/** One entry from the account-wide recent notes snapshot. */
export interface RecentNoteItem {
  type?: number;
  bookmark?: Bookmark;
  review?: ReviewDetail;
}

/** `books` and `items` are asserted at the `/user/allNotes` seam. */
export interface RecentNotesResponse {
  books: BookInfo[];
  items: RecentNoteItem[];
}

export interface Bookmark {
  bookmarkId?: string;
  bookId?: string;
  chapterUid?: number;
  range?: string;
  markText?: string;
  createTime?: number;
  style?: number;
  colorStyle?: number;
  type?: number;
  chapterIdx?: number;
}

/** `updated` is asserted to be an array at the `/book/bookmarklist` seam, `chapters` when present. */
export interface BookmarkListResponse {
  book?: { bookId?: string; title?: string };
  chapters?: Array<{ chapterUid?: number; title?: string }>;
  updated: Bookmark[];
}

export interface ReviewAuthor extends UserSummary {
  isDeepV?: number;
  isV?: number;
  signature?: string;
  deepVTitle?: string;
}

/** Public-account article metadata observed on `review.mpInfo`. */
export interface ArticleMpInfo {
  originalId?: string;
  doc_url?: string;
  pic_url?: string;
  title?: string;
  content?: string;
  mp_name?: string;
  avatar?: string;
  time?: number;
  payType?: number;
  inner?: number;
}

export interface ReviewDetail {
  reviewId?: string;
  bookId?: string;
  content?: string;
  htmlContent?: string;
  createTime?: number;
  star?: number;
  chapterName?: string;
  isFinish?: number;
  range?: string;
  chapterUid?: number;
  chapterIdx?: number;
  abstract?: string;
  title?: string;
  type?: number;
  userVid?: string | number;
  flag?: number;
  friendship?: number;
  isDeepV?: number;
  isLike?: number;
  isPrivate?: number;
  isReposted?: number;
  author?: ReviewAuthor;
  book?: BookInfo;
  mpInfo?: ArticleMpInfo;
}

export interface MineReviewItem extends ReviewDetail {}

/** `/review/list/mine` returns this one-level `reviews` array. */
export interface MineReviewListResponse extends SyncCursor {
  totalCount?: number;
  hasMore?: number;
  reviews: Array<{ review?: MineReviewItem }>;
}

export interface UnderlineItem {
  range?: string;
  count?: number;
  score?: number;
  type?: number;
}

/** `underlines` is asserted to be an array at the `/book/underlines` seam. */
export interface UnderlinesResponse extends SyncCursor {
  bookId?: string;
  chapterUid?: number;
  underlines: UnderlineItem[];
}

export interface BestBookmarkItem {
  bookId?: string;
  userVid?: string;
  bookmarkId?: string;
  chapterUid?: number;
  range?: string;
  markText?: string;
  totalCount?: number;
  simplifiedRange?: string;
  traditionalRange?: string;
}

/**
 * `items` and `chapters` are asserted to be arrays at the `/book/bestbookmarks` seam when present.
 * The endpoint answers `{"synckey":0}` and nothing else for a book with no community highlights —
 * every user-imported (`CB_…`) book, by construction — so nothing guarantees either key is there,
 * and a field the seam does not require is optional here (see `response-guards.ts`).
 */
export interface BestBookmarksResponse extends SyncCursor {
  totalCount?: number;
  /** Present on initial snapshot pages; delta-sync responses remain upstream-shaped. */
  hasMore?: number;
  items?: BestBookmarkItem[];
  chapters?: Array<{ bookId?: string; chapterUid?: number; chapterIdx?: number; title?: string }>;
}

export interface ReviewItem {
  idx?: number;
  reviewId?: string;
  likesCount?: number;
  review?: ReviewDetail;
}

/** `/review/list` returns this shape. */
export interface ReviewListResponse extends SyncCursor {
  totalCount?: number;
  hasMore?: number;
  reviewsCnt?: number;
  recentTotalCnt?: number;
  reviewsHasMore?: number;
  reviewsHas5Star?: number;
  reviewsHas1Star?: number;
  reviewsHasRecent?: number;
  friendCommentCount?: number;
  friendUniqueCount?: number;
  friendCommentUsers?: UserSummary[];
  deepVRecommendInfo?: { title?: string; subtitle?: string };
  deepVRecommendValue?: number;
  deepVUniqueCount?: number;
  reviews: ReviewItem[];
}

export interface ReadReviewQuery {
  range: string;
  maxIdx?: number;
  count?: number;
  synckey?: number;
}

export interface ReadReviewPageItem {
  reviewId?: string;
  likesCount?: number;
  review?: ReviewDetail;
}

export interface ReadReviewRange extends SyncCursor {
  range?: string;
  totalCount?: number;
  bookMarkCount?: number;
  hasMore?: number;
  maxIdx?: number;
  pageReviews?: ReadReviewPageItem[];
}

/** `reviews` is asserted to be an array at the `/book/readreviews` seam. */
export interface ReadReviewsResponse {
  vid?: string | number;
  bookId?: string;
  chapterUid?: number;
  reviews: ReadReviewRange[];
}

export interface ReviewSingleResponse extends SyncCursor {
  reviewId?: string;
  review?: ReviewDetail;
  htmlContent?: string;
  bookFinderSuccessCount?: number;
  dislikeCount?: number;
}

export interface ReadStatItem {
  stat?: string;
  counts?: string;
  scheme?: string;
}

export interface ReadLongestItem {
  book?: BookInfo;
  albumInfo?: NonNullable<ShelfAlbum["albumInfo"]>;
  readTime?: number;
  recordReadingTime?: number;
  tags?: string[];
}

export interface PreferCategoryItem {
  categoryId?: number;
  categoryTitle?: string;
  parentCategoryId?: number;
  parentCategoryTitle?: string;
  val?: number;
  readingTime?: number;
  readingCount?: number;
  categoryType?: number;
}

export interface PreferAuthorItem {
  authorId?: string;
  name?: string;
  count?: number;
  /** Upstream-formatted text such as `5小时30分钟`, not seconds. */
  readTime?: string;
  user?: UserSummary;
}

export interface PreferPublisherItem {
  name?: string;
  count?: number;
}

export interface PreferCopyrightItem {
  count?: number;
  copyrightInfo?: UserSummary & { role?: number };
}

export interface YearReportItem {
  year?: number;
  times?: number[];
  scheme?: string;
}

/** Every array field here is asserted at the `/readdata/detail` seam when it is present. */
export interface ReadDataResponse {
  baseTime?: number;
  totalReadTime?: number;
  dayAverageReadTime?: number;
  readDays?: number;
  readTimes?: Record<string, number>;
  dailyReadTimes?: Record<string, number>;
  compare?: number;
  readStat?: ReadStatItem[];
  readLongest?: ReadLongestItem[];
  preferCategory?: PreferCategoryItem[];
  preferCategoryWord?: string;
  preferTime?: number[];
  preferTimeWord?: string;
  preferAuthor?: PreferAuthorItem[];
  authorCount?: number;
  preferPublisher?: PreferPublisherItem[];
  preferCp?: PreferCopyrightItem[];
  readRate?: number;
  wrReadTime?: number;
  wrListenTime?: number;
  rank?: { text?: string; scheme?: string };
  registTime?: number;
  medals?: Array<Record<string, unknown>>;
  preferBooks?: Array<Record<string, unknown>>;
  yearReport?: YearReportItem[];
  recordReadingTime?: number;
  readRecordsWord?: string;
  readDistributionWord?: string;
  readTimeGears?: number[];
  styleType?: string;
}

export interface RecommendBook extends BookInfo {
  reason?: string;
  readingCount?: number;
  searchIdx?: number;
  type?: number;
}

/** `books` is asserted to be an array at the `/book/recommend` seam. */
export interface RecommendResponse {
  books: RecommendBook[];
}

/** `booksimilar` and its `books` are asserted at the `/book/detailinfo` similar-books seam. */
export interface SimilarResponse {
  booksimilar: {
    sessionId?: string;
    books: Array<{ idx?: number; book?: { bookInfo?: BookInfo } }>;
  };
}

export interface MutationSuccessResponse {
  succ?: number;
}

export interface MarkFinishedResponse {
  finishReading?: number;
}

export interface ReviewAddResponse {
  reviewId?: string;
  createTime?: number;
}

export interface ReviewEditResponse {
  reviewId?: string;
  userEditTime?: number;
}

export interface SuggestPrompt {
  title?: string;
  icon?: string;
  prompt?: string;
  intent?: string;
}

export interface SuggestQuestionHint {
  question?: string;
  hints?: string;
}

/** Every array field here is asserted at the `/ai/chat/suggest` seam when it is present. */
export interface SuggestResponse {
  questions?: string[];
  questionHints?: SuggestQuestionHint[];
  prompts?: SuggestPrompt[];
  dropOldMsgs?: number;
}

export interface NotebooksOptions extends RequestOptions {
  /** Maximum notebooks returned by the SDK, even when the endpoint sends its full snapshot. */
  count?: number;
  /** The final notebook `sort` from the previous page. */
  lastSort?: number;
}

export interface RecentNotesOptions extends RequestOptions {
  /** Maximum recent notes and highlights returned, from 1 to 100. */
  count?: number;
}

export interface SearchOptions extends RequestOptions {
  /** 10=ebooks, 0=all, 16=web fiction, 14=audio, 6=authors, 12=full text, 13=booklists, 2=accounts, 4=articles. */
  scope?: SearchScope;
  maxIdx?: number;
  count?: number;
}

export interface SearchSuggestOptions extends RequestOptions {
  /** Maximum autocomplete candidates to return. Defaults to 10. */
  count?: number;
}

export interface BookDetailOptions extends RequestOptions {
  /** Entries requested from each of the author and rightsholder catalogs, from 1 to 12. */
  count?: number;
}

export interface SyncOptions extends RequestOptions {
  synckey?: number;
}

export interface MineNotesOptions extends SyncOptions {
  count?: number;
}

export interface BestNotesOptions extends SyncOptions {
  chapterUid?: number;
  count?: number;
  /** Zero-based snapshot page offset. Ignored as a page cursor when synckey is nonzero. */
  maxIdx?: number;
}

export interface ReviewListOptions extends SyncOptions {
  listType?: number;
  listMode?: number;
  mine?: number;
  count?: number;
  /** Zero-based snapshot page offset. Ignored as a page cursor when synckey is nonzero. */
  maxIdx?: number;
}

export interface ReviewSingleOptions extends SyncOptions {
  commentsCount?: number;
  commentsDirection?: 0 | 1;
  likesCount?: number;
  likesDirection?: 0 | 1;
}

export type StarRating = 20 | 40 | 60 | 80 | 100;

export interface ReviewAddInput extends RequestOptions {
  bookId: string;
  content: string;
  type?: number;
  star?: StarRating;
  range?: string;
  abstract?: string;
  chapterUid?: number;
}

export interface AddBookmarkInput extends RequestOptions {
  bookId: string;
  chapterUid: number;
  range: string;
  markText: string;
  type?: number;
  style?: number;
  colorStyle?: number;
  bookVersion?: number;
  chapterName?: string;
  contextAbstract?: string;
}

export interface UpdateBookmarkInput extends RequestOptions {
  bookmarkId: string;
  style: number;
  colorStyle?: number;
}

export interface ReadDataOptions extends RequestOptions {
  mode?: "weekly" | "monthly" | "annually" | "overall";
  baseTime?: number;
}

export interface RecommendOptions extends RequestOptions {
  count?: number;
  maxIdx?: number;
}

export interface SimilarOptions extends RequestOptions {
  count?: number;
  maxIdx?: number;
  sessionId?: string;
}

export interface AskBookInput extends RequestOptions {
  bookId: string;
  query: string;
  intent?: string;
  maxPolls?: number;
  delayCapMs?: number;
}

export interface AskBookResult {
  text: string;
  thinking: string;
  chatid: string;
  sessionId: string;
  complete: boolean;
}

export interface SuggestInput extends RequestOptions {
  bookId: string;
  chapterUid?: number;
  toolbar?: boolean;
  range?: string;
  mpReviewId?: string;
}

export type PublicAccountFeedFormat = "rss" | "atom" | "json";

export type PublicAccountFeedSource = { kind: "account"; accountId: string } | { kind: "subscriptions" };

export interface PublicAccountFeedOptions extends RequestOptions {
  format: PublicAccountFeedFormat;
  /** Maximum emitted items, from 1 to 100. */
  limit?: number;
  /** Consulted before fetching, and filled in afterwards, so an article is retrieved once. */
  library?: PublicAccountLibrary;
  /** Defaults to "prefer". */
  libraryMode?: PublicAccountLibraryMode;
}

/**
 * Why a collection stopped.
 *
 * `repeated_cursor` is retained but no longer produced: it existed when paging followed the
 * server's `synckey`, which could repeat. Offset paging advances locally and strictly increases,
 * so the state is unreachable. It stays in the union because stored indexes from before the switch
 * may carry it, and the library schema constrains the column to this set.
 */
export type PublicAccountCursorTerminal =
  | "limit"
  | "explicit"
  | "empty"
  | "missing_cursor"
  | "repeated_cursor"
  | "duplicate_only";

/** Honest per-account collection state; aggregate feeds intentionally have no shared cursor. */
export interface PublicAccountCursor {
  accountId: string;
  requestedOffset: number;
  nextOffset?: number;
  terminal: PublicAccountCursorTerminal;
}

export type PublicAccountArticleState = "complete" | "partial" | "unsupported";

export type PublicAccountDiagnosticCode =
  | "ARTICLE_ID_MISSING"
  | "ARTICLE_UNAVAILABLE"
  | "SOURCE_URL_INVALID"
  | "SOURCE_REDIRECT_INVALID"
  | "SOURCE_REDIRECT_LIMIT"
  | "SOURCE_HTTP_ERROR"
  | "SOURCE_TIMEOUT"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_FETCH_FAILED"
  | "SOURCE_CLOUDFLARE_CHALLENGE"
  | "SOURCE_WECHAT_CHALLENGE"
  | "SOURCE_CONTENT_INSUFFICIENT"
  | "SOURCE_FALLBACK_USED"
  | "SOURCE_PAYWALL_PREVIEW";

export interface PublicAccountDiagnostic {
  code: PublicAccountDiagnosticCode;
  message: string;
  accountId: string;
  reviewId?: string;
  sourceUrl?: string;
  status?: number;
  path?: string;
  errCode?: number;
  ambiguous?: boolean;
}

export interface PublicAccountFeedResult {
  format: PublicAccountFeedFormat;
  content: string;
  itemCount: number;
  cursors: PublicAccountCursor[];
  diagnostics: PublicAccountDiagnostic[];
}

/** An article state the content library will store. A failed retrieval is never content. */
export type StorableArticleState = Exclude<PublicAccountArticleState, "unsupported">;

/** One article as the content library holds it. */
export interface StoredArticle {
  /** Local storage time, not a claim of a fresh network read. */
  storedAt?: string;
  reviewId: string;
  state: StorableArticleState;
  review: ReviewSingleResponse;
  accountId?: string;
  title?: string;
  publicationTime?: number;
  sourceUrl?: string;
  mpInfo?: ArticleMpInfo;
  sourceBytes?: Uint8Array;
  sourceSha256?: string;
  sourceByteLength?: number;
  markdown?: string;
  contentHtml?: string;
  fallbackHtml?: string;
  /** Retained so a replayed article explains its own state as the fetched one did. */
  diagnostics?: PublicAccountDiagnostic[];
}

export type PutArticleInput = Omit<StoredArticle, "sourceSha256" | "storedAt">;

/**
 * The slice of the content library the public-account paths use.
 *
 * Structural rather than a concrete import so this module stays free of a dependency on the
 * store, which already depends on the types here.
 */
export interface PublicAccountLibrary {
  getArticle(reviewId: string): Promise<StoredArticle | undefined>;
  putArticle(input: PutArticleInput): Promise<void>;
}

/**
 * How the stored copy is used.
 *
 * `refresh` still writes; it only declines to read, so `--refresh` repairs a stored article rather
 * than merely bypassing it once.
 */
export type PublicAccountLibraryMode = "prefer" | "refresh";

export interface PublicAccountArchiveOptions extends RequestOptions {
  /** Consulted before fetching, and filled in afterwards, so an article is retrieved once. */
  library?: PublicAccountLibrary;
  /** Defaults to "prefer". */
  libraryMode?: PublicAccountLibraryMode;
  directory: string;
  /** Maximum archived articles, from 1 to 100. */
  limit?: number;
}

export interface PublicAccountArchiveItem {
  accountId: string;
  reviewId: string;
  state: PublicAccountArticleState;
  directory: string;
  metadata: "metadata.json";
  mpInfo?: "mp-info.json";
  article?: "article.md";
  source?: "source.html" | "fallback.html";
  sourceUrl?: string;
  sourceSha256?: string;
  sourceByteLength?: number;
}

export interface PublicAccountArchiveManifest {
  version: 1;
  accountId: string;
  createdAt: string;
  itemCount: number;
  completeCount: number;
  partialCount: number;
  unsupportedCount: number;
  cursors: PublicAccountCursor[];
  diagnostics: PublicAccountDiagnostic[];
  items: PublicAccountArchiveItem[];
}

export interface PublicAccountArchiveResult {
  path: string;
  manifest: PublicAccountArchiveManifest;
}

export type PublicAccountArtifactErrorCode = "ARTIFACT_EXISTS" | "ARTIFACT_INCOMPLETE" | "ARTIFACT_PUBLISH_FAILED";

export type ImportBookInput = RequestOptions &
  ({ name: string; bytes: Uint8Array; path?: never } | { name: string; path: string; bytes?: never });

export interface ImportBookResult {
  bookId: string;
  deepLink: string;
}

export interface CosCredentials {
  TmpSecretId: string;
  TmpSecretKey: string;
  Token: string;
}

export interface CosUploadInput {
  bucket: string;
  key: string;
  credentials: CosCredentials;
  expiredTime: number;
  bytes: Uint8Array;
  signal?: AbortSignal;
}

export type CosUploader = (input: CosUploadInput) => Promise<void>;
