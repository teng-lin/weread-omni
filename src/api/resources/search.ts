import { assertOperationArguments, OPERATIONS } from "../operation-spec.js";
import { expectArrayFields } from "../response-guards.js";
import type {
  MobileTransport,
  SearchOptions,
  SearchResponse,
  SearchSuggestOptions,
  SearchSuggestResponse,
} from "../types.js";

export function searchModule(mobile: MobileTransport) {
  return {
    books(keyword: string, options: SearchOptions = {}): Promise<SearchResponse> {
      const scope = options.scope ?? 10;
      assertOperationArguments(OPERATIONS.searchBooks, {
        keyword,
        scope,
        count: options.count,
        maxIdx: options.maxIdx,
      });
      return mobile
        .call<SearchResponse>("GET", "/store/search", {
          query: {
            keyword,
            scope,
            count: options.count,
            maxIdx: options.maxIdx ?? 0,
          },
          signal: options.signal,
        })
        .then((response) => expectArrayFields(response, "/store/search", ["books"], ["parts"]));
    },
    suggest(keyword: string, options: SearchSuggestOptions = {}): Promise<SearchSuggestResponse> {
      const count = options.count ?? 10;
      assertOperationArguments(OPERATIONS.searchSuggest, { keyword, count });
      return mobile
        .call<SearchSuggestResponse>("GET", "/store/suggest", {
          query: { keyword, count },
          signal: options.signal,
        })
        .then((response) => expectArrayFields(response, "/store/suggest", ["list", "records", "parts"]));
    },
  };
}
