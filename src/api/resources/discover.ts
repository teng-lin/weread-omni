import { assertOperationArguments, OPERATIONS } from "../operation-spec.js";
import { expectArrayFields, expectNestedArrayFields } from "../response-guards.js";
import type {
  MobileTransport,
  RecommendOptions,
  RecommendResponse,
  SimilarOptions,
  SimilarResponse,
} from "../types.js";

export function discoverModule(mobile: MobileTransport) {
  return {
    recommend(options: RecommendOptions = {}): Promise<RecommendResponse> {
      const count = options.count ?? 12;
      const maxIdx = options.maxIdx ?? 0;
      assertOperationArguments(OPERATIONS.discoverRecommend, { count, maxIdx });
      return mobile
        .call<RecommendResponse>("GET", "/book/recommend", {
          query: { count, maxIdx },
          signal: options.signal,
        })
        .then((response) => expectArrayFields(response, "/book/recommend", ["books"]));
    },
    similar(bookId: string, options: SimilarOptions = {}): Promise<SimilarResponse> {
      const count = options.count ?? 12;
      const maxIdx = options.maxIdx ?? 0;
      assertOperationArguments(OPERATIONS.discoverSimilar, { bookId, count, maxIdx, sessionId: options.sessionId });
      return mobile
        .call<SimilarResponse>("GET", "/book/detailinfo", {
          query: {
            bookId,
            listtypes: 2,
            synckey: 0,
            maxIdx,
            count,
            sessionId: options.sessionId,
          },
          signal: options.signal,
        })
        .then((response) => expectNestedArrayFields(response, "/book/detailinfo", "booksimilar", ["books"]));
    },
  };
}
