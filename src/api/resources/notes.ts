import { assertOperationArguments, OPERATIONS } from "../operation-spec.js";
import { expectArrayFields } from "../response-guards.js";
import type {
  AddBookmarkInput,
  BestBookmarksResponse,
  BestNotesOptions,
  BookmarkListResponse,
  MineNotesOptions,
  MineReviewListResponse,
  MobileTransport,
  MutationSuccessResponse,
  NotebooksOptions,
  NotebooksResponse,
  ReadReviewQuery,
  ReadReviewsResponse,
  RecentNotesOptions,
  RecentNotesResponse,
  RequestOptions,
  SyncOptions,
  UnderlinesResponse,
  UpdateBookmarkInput,
} from "../types.js";

export function notesModule(mobile: MobileTransport) {
  return {
    notebooks(options: NotebooksOptions = {}): Promise<NotebooksResponse> {
      const { count = 20, lastSort } = options;
      assertOperationArguments(OPERATIONS.notesNotebooks, { count, lastSort });
      return mobile
        .call<NotebooksResponse>("GET", "/user/notebooks", { query: { count, lastSort }, signal: options.signal })
        .then((response) => expectArrayFields(response, "/user/notebooks", ["books"]))
        .then((response) => {
          // The direct-mobile endpoint currently ignores both paging arguments and returns the
          // complete descending snapshot. Slice that snapshot here so SDK and CLI callers
          // all receive the bounded contract those arguments advertise.
          const start =
            lastSort === undefined
              ? 0
              : response.books.findIndex((book) => typeof book.sort === "number" && book.sort < lastSort);
          const remaining = start < 0 ? [] : response.books.slice(start);
          return {
            ...response,
            books: remaining.slice(0, count),
            hasMore: remaining.length > count || (response.books.length <= count && response.hasMore === 1) ? 1 : 0,
          };
        });
    },
    recent(options: RecentNotesOptions = {}): Promise<RecentNotesResponse> {
      const count = options.count ?? 20;
      assertOperationArguments(OPERATIONS.notesRecent, { count });
      return mobile
        .call<RecentNotesResponse>("GET", "/user/allNotes", {
          query: { maxid: 0, count },
          signal: options.signal,
        })
        .then((response) => expectArrayFields(response, "/user/allNotes", ["books", "items"]));
    },
    bookmarks(bookId: string, options: SyncOptions = {}): Promise<BookmarkListResponse> {
      const synckey = options.synckey ?? 0;
      assertOperationArguments(OPERATIONS.notesBookmarks, { bookId, synckey });
      return mobile
        .call<BookmarkListResponse>("GET", "/book/bookmarklist", {
          query: { bookId, synckey },
          signal: options.signal,
        })
        .then((response) => expectArrayFields(response, "/book/bookmarklist", ["updated"], ["chapters"]));
    },
    mine(bookId: string, options: MineNotesOptions = {}): Promise<MineReviewListResponse> {
      const synckey = options.synckey ?? 0;
      const count = options.count ?? 20;
      assertOperationArguments(OPERATIONS.notesMine, { bookId, synckey, count });
      return mobile
        .call<MineReviewListResponse>("GET", "/review/list", {
          query: {
            bookId,
            listType: 1,
            listMode: 0,
            mine: 1,
            synckey,
            count,
          },
          signal: options.signal,
        })
        .then((response) => expectArrayFields(response, "/review/list", ["reviews"]));
    },
    best(bookId: string, options: BestNotesOptions = {}): Promise<BestBookmarksResponse> {
      const chapterUid = options.chapterUid ?? 0;
      const count = options.count ?? 20;
      const maxIdx = options.maxIdx ?? 0;
      const synckey = options.synckey ?? 0;
      assertOperationArguments(OPERATIONS.notesBest, { bookId, chapterUid, count, maxIdx, synckey });
      const pageEnd = maxIdx + count;
      if (synckey === 0 && !Number.isSafeInteger(pageEnd + 1)) {
        throw new RangeError("maxIdx + count must leave room for a safe pagination lookahead");
      }
      return mobile
        .call<BestBookmarksResponse>("GET", "/book/bestbookmarks", {
          query: {
            bookId,
            chapterUid,
            count: synckey === 0 ? count + 1 : count,
            maxIdx,
            synckey,
          },
          signal: options.signal,
        })
        .then((response) => expectArrayFields(response, "/book/bestbookmarks", [], ["items", "chapters"]))
        .then((response) => {
          if (synckey !== 0) return response;
          // Snapshot calls return the entire prefix through maxIdx + count, not a disjoint page.
          // Keep delta-sync responses untouched, but turn the initial snapshot into real pages.
          const items = (response.items ?? []).slice(maxIdx, pageEnd);
          const hasMore =
            (response.items?.length ?? 0) > pageEnd ||
            (typeof response.totalCount === "number" && maxIdx + items.length < response.totalCount);
          return { ...response, items, hasMore: hasMore ? 1 : 0 };
        });
    },
    readReviews(
      bookId: string,
      chapterUid: number,
      reviews: ReadReviewQuery[],
      options: RequestOptions = {},
    ): Promise<ReadReviewsResponse> {
      assertOperationArguments(OPERATIONS.notesReadReviews, { bookId, chapterUid, reviews });
      return mobile
        .call<ReadReviewsResponse>("POST", "/book/readreviews", {
          body: { bookId, chapterUid, cht2sMode: "", reviews },
          idempotent: true,
          signal: options.signal,
        })
        .then((response) => expectArrayFields(response, "/book/readreviews", ["reviews"]));
    },
    underlines(bookId: string, chapterUid: number, options: SyncOptions = {}): Promise<UnderlinesResponse> {
      const synckey = options.synckey ?? 0;
      assertOperationArguments(OPERATIONS.notesUnderlines, { bookId, chapterUid, synckey });
      return mobile
        .call<UnderlinesResponse>("GET", "/book/underlines", {
          query: { bookId, chapterUid, synckey },
          signal: options.signal,
        })
        .then((response) => expectArrayFields(response, "/book/underlines", ["underlines"]));
    },
    addBookmark(input: AddBookmarkInput): Promise<MutationSuccessResponse> {
      assertOperationArguments(OPERATIONS.notesAddBookmark, input);
      const body: Record<string, unknown> = {
        bookId: input.bookId,
        chapterUid: input.chapterUid,
        range: input.range,
        markText: input.markText,
        type: input.type ?? 1,
        style: input.style ?? 1,
        colorStyle: input.colorStyle ?? 0,
      };
      if (input.bookVersion != null) body.bookVersion = input.bookVersion;
      if (input.chapterName != null) body.chapterName = input.chapterName;
      if (input.contextAbstract != null) body.contextAbstract = input.contextAbstract;
      return mobile
        .call<MutationSuccessResponse>("POST", "/book/addBookmark", { body, signal: input.signal })
        .then((response) => response.body);
    },
    updateBookmark(input: UpdateBookmarkInput): Promise<MutationSuccessResponse> {
      assertOperationArguments(OPERATIONS.notesUpdateBookmark, input);
      const body: Record<string, unknown> = { bookmarkId: input.bookmarkId, style: input.style };
      if (input.colorStyle !== undefined) body.colorStyle = input.colorStyle;
      return mobile
        .call<MutationSuccessResponse>("POST", "/book/updateBookmark", { body, signal: input.signal })
        .then((response) => response.body);
    },
    removeBookmark(bookmarkId: string, options: RequestOptions = {}): Promise<MutationSuccessResponse> {
      assertOperationArguments(OPERATIONS.notesRemoveBookmark, { bookmarkId });
      return mobile
        .call<MutationSuccessResponse>("POST", "/book/removeBookmark", {
          body: { bookmarkIds: [bookmarkId] },
          signal: options.signal,
        })
        .then((response) => response.body);
    },
  };
}
