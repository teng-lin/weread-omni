import { aiModule } from "../../src/api/resources/ai.js";
import { bookModule } from "../../src/api/resources/book.js";
import { discoverModule } from "../../src/api/resources/discover.js";
import { importModule } from "../../src/api/resources/import.js";
import { notesModule } from "../../src/api/resources/notes.js";
import { readDataModule } from "../../src/api/resources/read-data.js";
import { reviewModule } from "../../src/api/resources/review.js";
import { searchModule } from "../../src/api/resources/search.js";
import { shelfModule } from "../../src/api/resources/shelf.js";
import type {
  AskBookResult,
  BestBookmarkItem,
  BestBookmarksResponse,
  BookDetailOptions,
  BookDetailResponse,
  BookInfo,
  Bookmark,
  BookmarkListResponse,
  BookProgress,
  ChapterInfo,
  ChapterInfoResponse,
  ImportBookInput,
  MarkFinishedResponse,
  MineReviewListResponse,
  MobileTransport,
  MutationSuccessResponse,
  NotebookBook,
  NotebooksResponse,
  ReadDataResponse,
  ReadReviewQuery,
  ReadReviewsResponse,
  RecentNotesResponse,
  RecommendBook,
  RecommendResponse,
  ReviewAddInput,
  ReviewAddResponse,
  ReviewEditResponse,
  ReviewItem,
  ReviewListResponse,
  ReviewSingleResponse,
  SearchOptions,
  SearchResponse,
  SearchResult,
  SearchSuggestion,
  SearchSuggestResponse,
  ShelfAlbum,
  ShelfSyncResponse,
  SimilarResponse,
  SuggestResponse,
  UnderlineItem,
  UnderlinesResponse,
  UpdateBookmarkInput,
} from "../../src/api/types.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;
type Expect<Value extends true> = Value;
type Result<Method> = Method extends (...args: never[]) => Promise<infer Response> ? Response : never;

declare const mobile: MobileTransport;
const search = searchModule(mobile);
const book = bookModule(mobile);
const shelf = shelfModule(mobile);
const notes = notesModule(mobile);
const review = reviewModule(mobile);
const readData = readDataModule(mobile);
const discover = discoverModule(mobile);
const ai = aiModule(mobile);
const importBook = importModule(mobile);

const personalEpub: ImportBookInput = { name: "personal.epub", bytes: new Uint8Array() };
void personalEpub;

declare const bookInfo: BookInfo;
declare const readDataBody: ReadDataResponse;
// `BookInfo` and `ReadDataResponse` used to carry `[key: string]: unknown`, which typed every
// unknown upstream field — and, as a side effect, every misspelling of a curated one. Untyped
// pass-through fields still arrive at runtime; reaching for them now costs an explicit cast.
// @ts-expect-error a typo on a curated field must not compile
void bookInfo.titel;
// @ts-expect-error a typo on a curated field must not compile
void readDataBody.totalReadTimes;

export type DirectResourceAssertions = [
  Expect<Equal<keyof typeof book, "info" | "detail" | "chapters" | "progress">>,
  Expect<Equal<Result<typeof search.books>, SearchResponse>>,
  Expect<Equal<Result<typeof search.suggest>, SearchSuggestResponse>>,
  Expect<Equal<Result<typeof book.info>, BookInfo>>,
  Expect<Equal<Result<typeof book.detail>, BookDetailResponse>>,
  Expect<Equal<Parameters<typeof book.detail>[1], BookDetailOptions | undefined>>,
  Expect<Equal<Result<typeof book.chapters>, ChapterInfoResponse>>,
  Expect<Equal<Result<typeof book.progress>, BookProgress>>,
  Expect<Equal<Result<typeof shelf.sync>, ShelfSyncResponse>>,
  Expect<Equal<Result<typeof shelf.add>, MutationSuccessResponse>>,
  Expect<Equal<Result<typeof shelf.markFinished>, MarkFinishedResponse>>,
  Expect<Equal<Result<typeof notes.notebooks>, NotebooksResponse>>,
  Expect<Equal<Result<typeof notes.recent>, RecentNotesResponse>>,
  Expect<Equal<Result<typeof notes.bookmarks>, BookmarkListResponse>>,
  Expect<Equal<Result<typeof notes.mine>, MineReviewListResponse>>,
  Expect<Equal<Result<typeof notes.best>, BestBookmarksResponse>>,
  Expect<Equal<Result<typeof notes.readReviews>, ReadReviewsResponse>>,
  Expect<Equal<Result<typeof notes.underlines>, UnderlinesResponse>>,
  Expect<Equal<Parameters<typeof notes.updateBookmark>[0], UpdateBookmarkInput>>,
  Expect<Equal<Result<typeof notes.updateBookmark>, MutationSuccessResponse>>,
  Expect<Equal<Result<typeof notes.removeBookmark>, MutationSuccessResponse>>,
  Expect<Equal<Result<typeof review.list>, ReviewListResponse>>,
  Expect<Equal<Result<typeof review.single>, ReviewSingleResponse>>,
  Expect<Equal<Result<typeof review.add>, ReviewAddResponse>>,
  Expect<Equal<Result<typeof review.edit>, ReviewEditResponse>>,
  Expect<Equal<Result<typeof readData.detail>, ReadDataResponse>>,
  Expect<Equal<Result<typeof discover.recommend>, RecommendResponse>>,
  Expect<Equal<Result<typeof discover.similar>, SimilarResponse>>,
  Expect<Equal<Result<typeof ai.askBook>, AskBookResult>>,
  Expect<Equal<Result<typeof ai.suggest>, SuggestResponse>>,
  Expect<Equal<Result<typeof importBook.book>, { bookId: string; deepLink: string }>>,
  Expect<Equal<NonNullable<ReviewAddInput["star"]>, 20 | 40 | 60 | 80 | 100>>,
  // `albums` is optional: the live `/shelf/sync` omits the key for an account with no album
  // collections, so the seam checks it only when present. Everything *inside* an album is
  // unvalidated, so it is optional too and the assertion says so rather than pretending.
  Expect<Equal<ShelfSyncResponse["albums"], ShelfAlbum[] | undefined>>,
  Expect<Equal<NonNullable<ShelfAlbum["albumInfo"]>["albumId"], string | undefined>>,
  // `/book/bestbookmarks` answers `{"synckey":0}` for a book with no community highlights — every
  // user-imported (`CB_…`) book, by construction — so `items` is not guaranteed to be there, and
  // the seam checks it only when present.
  Expect<Equal<BestBookmarksResponse["items"], BestBookmarkItem[] | undefined>>,
  Expect<Equal<BestBookmarksResponse["hasMore"], number | undefined>>,
  // The declarations are honest in both directions: a field the seam asserts unconditionally stays
  // required, a field nothing checks is optional. `albums` and `items` above are the third case —
  // checked only when they are present, which makes them optional too, not required. Restoring a
  // `required` on an unchecked field fails here.
  Expect<Equal<SearchResponse["books"], SearchResult[]>>,
  Expect<Equal<SearchSuggestResponse["records"], SearchSuggestion[]>>,
  Expect<Equal<NotebooksResponse["books"], NotebookBook[]>>,
  Expect<Equal<BookmarkListResponse["updated"], Bookmark[]>>,
  Expect<Equal<ReviewListResponse["reviews"], ReviewItem[]>>,
  Expect<Equal<UnderlinesResponse["underlines"], UnderlineItem[]>>,
  Expect<Equal<RecommendResponse["books"], RecommendBook[]>>,
  Expect<Equal<SimilarResponse["booksimilar"]["books"], Array<{ idx?: number; book?: { bookInfo?: BookInfo } }>>>,
  Expect<Equal<BookInfo["title"], string | undefined>>,
  // Nothing inspects list *elements*, so nothing inside one may be declared required either.
  Expect<Equal<SearchResult["searchIdx"], number | undefined>>,
  Expect<Equal<NonNullable<SearchOptions["scope"]>, 0 | 2 | 4 | 6 | 10 | 12 | 13 | 14 | 16>>,
  Expect<Equal<ReadReviewQuery["range"], string>>,
  Expect<Equal<ReadReviewsResponse["vid"], string | number | undefined>>,
  Expect<Equal<NotebookBook["bookId"], string | undefined>>,
  Expect<Equal<Bookmark["markText"], string | undefined>>,
  Expect<Equal<ReviewItem["idx"], number | undefined>>,
  Expect<Equal<UnderlineItem["range"], string | undefined>>,
  Expect<Equal<BestBookmarkItem["bookmarkId"], string | undefined>>,
  Expect<Equal<ReadDataResponse["totalReadTime"], number | undefined>>,
  Expect<Equal<MutationSuccessResponse["succ"], number | undefined>>,
  Expect<Equal<ReviewListResponse["synckey"], number | undefined>>,
  // …except where the SDK itself builds the value, which is the one place a guarantee is real.
  Expect<Equal<ChapterInfoResponse["synckey"], number>>,
  Expect<Equal<ChapterInfoResponse["chapters"], ChapterInfo[]>>,
];
