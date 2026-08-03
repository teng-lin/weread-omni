import { assertOperationArguments, OPERATIONS } from "../operation-spec.js";
import { expectArrayFields } from "../response-guards.js";
import type {
  MarkFinishedResponse,
  MobileTransport,
  MutationSuccessResponse,
  RequestOptions,
  ShelfSyncResponse,
} from "../types.js";

const shelfBody = (bookId: string) => ({ albumIds: [], archiveIds: [], bookIds: [bookId] });

export function shelfModule(mobile: MobileTransport) {
  return {
    sync: (options: RequestOptions = {}): Promise<ShelfSyncResponse> =>
      mobile
        .call<ShelfSyncResponse>("GET", "/shelf/sync", { signal: options.signal })
        .then((response) => expectArrayFields(response, "/shelf/sync", ["books"], ["albums", "archive"])),
    add: (bookId: string, options: RequestOptions = {}): Promise<MutationSuccessResponse> => {
      assertOperationArguments(OPERATIONS.shelfAdd, { bookId });
      return mobile
        .call<MutationSuccessResponse>("POST", "/shelf/add", { body: shelfBody(bookId), signal: options.signal })
        .then((response) => response.body);
    },
    delete: (bookId: string, options: RequestOptions = {}): Promise<MutationSuccessResponse> => {
      assertOperationArguments(OPERATIONS.shelfDelete, { bookId });
      return mobile
        .call<MutationSuccessResponse>("POST", "/shelf/delete", { body: shelfBody(bookId), signal: options.signal })
        .then((response) => response.body);
    },
    pin: (bookId: string, top = true, options: RequestOptions = {}): Promise<MutationSuccessResponse> => {
      assertOperationArguments(OPERATIONS.shelfPin, { bookId, top });
      return mobile
        .call<MutationSuccessResponse>("POST", "/shelf/top", {
          body: { ...shelfBody(bookId), isDel: top ? 0 : 1 },
          signal: options.signal,
        })
        .then((response) => response.body);
    },
    setPrivate: (bookId: string, on = true, options: RequestOptions = {}): Promise<MutationSuccessResponse> => {
      assertOperationArguments(OPERATIONS.shelfSetPrivate, { bookId, secret: on });
      return mobile
        .call<MutationSuccessResponse>("POST", "/book/secret", {
          body: { albumIds: [], bookIds: [bookId], private: on ? 1 : 0 },
          signal: options.signal,
        })
        .then((response) => response.body);
    },
    markFinished: (bookId: string, on = true, options: RequestOptions = {}): Promise<MarkFinishedResponse> => {
      assertOperationArguments(OPERATIONS.shelfMarkFinished, { bookId, finished: on });
      return mobile
        .call<MarkFinishedResponse>("POST", "/book/markstatus", {
          body: { auto: 0, bookId, finishInfo: 0, isCancel: on ? 0 : 1, status: 4 },
          signal: options.signal,
        })
        .then((response) => response.body);
    },
    markReading: (bookId: string, on = true, options: RequestOptions = {}): Promise<MarkFinishedResponse> => {
      assertOperationArguments(OPERATIONS.shelfMarkReading, { bookId, reading: on });
      return mobile
        .call<MarkFinishedResponse>("POST", "/book/markstatus", {
          body: { auto: 0, bookId, finishInfo: 0, isCancel: on ? 0 : 1, status: 2 },
          signal: options.signal,
        })
        .then((response) => response.body);
    },
  };
}
