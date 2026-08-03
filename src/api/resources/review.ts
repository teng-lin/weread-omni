import { assertOperationArguments, OPERATIONS } from "../operation-spec.js";
import { expectArrayFields } from "../response-guards.js";
import type {
  MobileTransport,
  MutationSuccessResponse,
  RequestOptions,
  ReviewAddInput,
  ReviewAddResponse,
  ReviewEditResponse,
  ReviewListOptions,
  ReviewListResponse,
  ReviewSingleOptions,
  ReviewSingleResponse,
} from "../types.js";

export function reviewModule(mobile: MobileTransport) {
  return {
    list(bookId: string, options: ReviewListOptions = {}): Promise<ReviewListResponse> {
      const listType = options.listType ?? 1;
      const listMode = options.listMode ?? 0;
      const mine = options.mine ?? 0;
      const synckey = options.synckey ?? 0;
      const count = options.count ?? 20;
      const maxIdx = options.maxIdx ?? 0;
      assertOperationArguments(OPERATIONS.reviewList, {
        bookId,
        listType,
        listMode,
        mine,
        synckey,
        count,
        maxIdx,
      });
      const pageEnd = maxIdx + count;
      if (synckey === 0 && !Number.isSafeInteger(pageEnd + 1)) {
        throw new RangeError("maxIdx + count must leave room for a safe pagination lookahead");
      }
      return mobile
        .call<ReviewListResponse>("GET", "/review/list", {
          query: {
            bookId,
            listType,
            listMode,
            mine,
            synckey,
            count: synckey === 0 ? pageEnd + 1 : count,
            maxIdx: synckey === 0 ? 0 : maxIdx,
          },
          signal: options.signal,
        })
        .then((response) => expectArrayFields(response, "/review/list", ["reviews"], ["friendCommentUsers"]))
        .then((response) => {
          if (synckey !== 0) return response;
          // The endpoint widens a prefix with count and returns no later results for maxIdx > 0.
          // Fetch one item beyond the requested window, then expose a conventional disjoint page.
          const reviews = response.reviews.slice(maxIdx, pageEnd);
          const hasMore = response.reviews.length > pageEnd || response.hasMore === 1;
          return { ...response, reviews, hasMore: hasMore ? 1 : 0 };
        });
    },
    single(reviewId: string, options: ReviewSingleOptions = {}): Promise<ReviewSingleResponse> {
      const commentsCount = options.commentsCount ?? 10;
      const commentsDirection = options.commentsDirection ?? 0;
      const likesCount = options.likesCount ?? 10;
      const likesDirection = options.likesDirection ?? 0;
      const synckey = options.synckey ?? 0;
      assertOperationArguments(OPERATIONS.reviewSingle, {
        reviewId,
        commentsCount,
        commentsDirection,
        likesCount,
        likesDirection,
        synckey,
      });
      return mobile
        .call<ReviewSingleResponse>("GET", "/review/single", {
          query: {
            reviewId,
            commentsCount,
            commentsDirection,
            likesCount,
            likesDirection,
            synckey,
          },
          signal: options.signal,
        })
        .then((response) => response.body);
    },
    add(input: ReviewAddInput): Promise<ReviewAddResponse> {
      assertOperationArguments(OPERATIONS.reviewAdd, input);
      const body: Record<string, unknown> = {
        bookId: input.bookId,
        content: input.content,
        type: input.type ?? 1,
      };
      if (input.star !== undefined) body.star = input.star;
      if (input.range) body.range = input.range;
      if (input.abstract) body.abstract = input.abstract;
      if (input.chapterUid !== undefined) body.chapterUid = input.chapterUid;
      return mobile
        .call<ReviewAddResponse>("POST", "/review/add", { body, signal: input.signal })
        .then((response) => response.body);
    },
    edit(reviewId: string, content: string, options: RequestOptions = {}): Promise<ReviewEditResponse> {
      assertOperationArguments(OPERATIONS.reviewEdit, { reviewId, content });
      return mobile
        .call<ReviewEditResponse>("POST", "/review/useredit", {
          body: { reviewId, content },
          signal: options.signal,
        })
        .then((response) => response.body);
    },
    delete: (reviewId: string, options: RequestOptions = {}): Promise<MutationSuccessResponse> => {
      assertOperationArguments(OPERATIONS.reviewDelete, { reviewId });
      return mobile
        .call<MutationSuccessResponse>("POST", "/review/delete", { body: { reviewId }, signal: options.signal })
        .then((response) => response.body);
    },
  };
}
