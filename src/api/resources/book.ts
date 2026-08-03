import { WeReadApiError } from "../../errors.js";
import { assertOperationArguments, OPERATIONS } from "../operation-spec.js";
import { expectNestedArrayFields } from "../response-guards.js";
import type {
  BookDetailOptions,
  BookDetailResponse,
  BookInfo,
  BookProgress,
  ChapterInfo,
  ChapterInfoResponse,
  MobileTransport,
  RequestOptions,
} from "../types.js";

interface ChapterInfosWire {
  data?: Array<{
    bookId?: string;
    synckey?: number;
    chapterUpdateTime?: number;
    updated?: ChapterInfo[];
  }>;
}

/** Public book reads: metadata, detail panels, table of contents, and progress. */
export function bookModule(mobile: MobileTransport) {
  return {
    info: (bookId: string, options: RequestOptions = {}): Promise<BookInfo> => {
      assertOperationArguments(OPERATIONS.bookInfo, { bookId });
      return mobile
        .call<BookInfo>("GET", "/book/info", { query: { bookId }, signal: options.signal })
        .then((response) => response.body);
    },
    detail: (bookId: string, options: BookDetailOptions = {}): Promise<BookDetailResponse> => {
      const count = options.count ?? 6;
      assertOperationArguments(OPERATIONS.bookDetail, { bookId, count });
      return mobile
        .call<BookDetailResponse>("GET", "/book/detailinfo", {
          query: {
            bookId,
            listtypes: "5,7,9",
            synckey: "0,0,0",
            maxIdx: "0,0,0",
            count: `${count},${count},${count}`,
          },
          signal: options.signal,
        })
        .then((response) => {
          expectNestedArrayFields(response, "/book/detailinfo", "skuImages", ["urls"]);
          expectNestedArrayFields(response, "/book/detailinfo", "authorOpus", ["books"]);
          return expectNestedArrayFields(response, "/book/detailinfo", "copyRightOpus", [], ["books"]);
        });
    },
    chapters: (bookId: string, options: RequestOptions = {}): Promise<ChapterInfoResponse> => {
      assertOperationArguments(OPERATIONS.bookChapters, { bookId });
      return mobile
        .call<ChapterInfosWire>("POST", "/book/chapterInfos", {
          idempotent: true,
          body: { bookIds: [bookId], synckeys: [0], updateTimes: [0], maxfreeIdx: [0] },
          signal: options.signal,
        })
        .then((response) => {
          // An absent `data` is an unusable response, not an empty book. Defaulting it produced
          // a plausible "this book has no chapters" result that no caller could tell apart from
          // the real thing. `data: []` IS a real empty listing and stays a success.
          const data = response.body?.data;
          if (!Array.isArray(data)) {
            throw new WeReadApiError(`mobile /book/chapterInfos: missing chapter data`, {
              path: "/book/chapterInfos",
              status: response.status,
            });
          }
          const entry = data[0] ?? {};
          return {
            bookId: entry.bookId ?? bookId,
            synckey: entry.synckey ?? 0,
            ...(entry.chapterUpdateTime === undefined ? {} : { chapterUpdateTime: entry.chapterUpdateTime }),
            // Declared ChapterInfo[]; `?? []` only guarded null/undefined, so a string upstream
            // reached callers as `chapters` and threw TypeError on .map().
            chapters: Array.isArray(entry.updated) ? entry.updated : [],
          };
        });
    },
    progress: (bookId: string, options: RequestOptions = {}): Promise<BookProgress> => {
      assertOperationArguments(OPERATIONS.bookProgress, { bookId });
      return mobile
        .call<BookProgress>("GET", "/book/getProgress", { query: { bookId }, signal: options.signal })
        .then((response) => response.body);
    },
  };
}
