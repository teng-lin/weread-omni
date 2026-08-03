import { WeReadApiError } from "../../errors.js";
import { assertOperationArguments, OPERATIONS, PUBLIC_ACCOUNT_ID_PATTERN } from "../operation-spec.js";
import { expectArrayFields } from "../response-guards.js";
import type {
  MobileTransport,
  MutationSuccessResponse,
  PaidArticleResponse,
  PublicAccountArticle,
  PublicAccountArticleResolution,
  PublicAccountArticlesOptions,
  PublicAccountArticlesPage,
  PublicAccountSubscriptionsOptions,
  PublicAccountSubscriptionsPage,
  RequestOptions,
} from "../types.js";
import { shelfModule } from "./shelf.js";

const publicAccountId = new RegExp(PUBLIC_ACCOUNT_ID_PATTERN);

interface ArticlesEnvelope {
  data: PublicAccountArticle[];
  synckey?: unknown;
  hasMore?: unknown;
}

export function publicAccountsModule(mobile: MobileTransport) {
  const shelf = shelfModule(mobile);
  return {
    async subscriptions(options: PublicAccountSubscriptionsOptions = {}): Promise<PublicAccountSubscriptionsPage> {
      const count = options.count ?? 50;
      const offset = options.offset ?? 0;
      assertOperationArguments(OPERATIONS.publicAccountsSubscriptions, { count, offset });
      const pageEnd = offset + count;
      if (!Number.isSafeInteger(pageEnd)) throw new RangeError("offset + count must be a safe integer");

      const snapshot = await shelf.sync({ signal: options.signal });
      const accounts = snapshot.books
        .filter((book) => typeof book.bookId === "string" && publicAccountId.test(book.bookId))
        .map((book) => ({ ...book, accountId: book.bookId as string }));
      const page = accounts.slice(offset, pageEnd);
      return {
        accounts: page,
        returnedCount: page.length,
        requestedOffset: offset,
        totalCount: accounts.length,
        ...(pageEnd < accounts.length ? { nextOffset: pageEnd } : {}),
      };
    },

    async articles(accountId: string, options: PublicAccountArticlesOptions = {}): Promise<PublicAccountArticlesPage> {
      const count = options.count ?? 50;
      // Two shapes, never mixed. The official clients open with a synckey and no offset, then page
      // with an offset and no synckey; sending an offset on the first request matches neither.
      const paging = options.offset !== undefined;
      const offset = options.offset ?? 0;
      const synckey = options.synckey ?? 0;
      assertOperationArguments(OPERATIONS.publicAccountsArticles, {
        accountId,
        count,
        ...(paging ? { offset } : { synckey }),
      });
      const body = await mobile
        .call<ArticlesEnvelope>("GET", "/mp/chapters", {
          query: paging ? { bookId: accountId, count, offset } : { bookId: accountId, count, synckey },
          signal: options.signal,
        })
        .then((response) => expectArrayFields(response, "/mp/chapters", ["data"]));

      const result: Record<string, unknown> = {
        ...body,
        accountId,
        articles: body.data,
        returnedCount: body.data.length,
        requestedOffset: offset,
      };
      // Every upstream cursor field is dropped before the normalized ones are set. Letting one
      // through would publish a raw server value under a name this module defines the meaning of.
      delete result.nextOffset;
      delete result.nextSynckey;
      delete result.hasMore;
      // The upstream synckey is a delta-sync token. It is surfaced unchanged and is deliberately
      // not used to page: a short page is how this route signals exhaustion.
      if (Number.isSafeInteger(body.synckey) && (body.synckey as number) >= 0) {
        result.synckey = body.synckey;
      }
      if (body.data.length >= count) result.nextOffset = offset + body.data.length;
      if (body.hasMore === 0 || body.hasMore === 1) result.hasMore = body.hasMore;
      return result as unknown as PublicAccountArticlesPage;
    },

    async resolveArticle(docUrl: string, options: RequestOptions = {}): Promise<PublicAccountArticleResolution> {
      assertOperationArguments(OPERATIONS.publicAccountsResolveArticle, { docUrl });
      const response = await mobile.call<{ reviewIds: PublicAccountArticleResolution[] }>("POST", "/mp/getreviewid", {
        body: { urls: [docUrl] },
        idempotent: true,
        signal: options.signal,
      });
      const body = expectArrayFields(response, "/mp/getreviewid", ["reviewIds"]);
      const resolved = body.reviewIds[0];
      if (!resolved || typeof resolved.url !== "string" || typeof resolved.reviewId !== "string") {
        throw new WeReadApiError("mobile /mp/getreviewid: no review ID for the requested article", {
          path: "/mp/getreviewid",
          status: response.status,
        });
      }
      return resolved;
    },

    /**
     * Fetch a paid article body.
     *
     * The entitlement check happens server-side: an entitled account gets the authorized HTML
     * back, and an unentitled one gets `ispaid: false` plus a substitute URL pointing at the
     * preview. There is no archive, no encryption key and no client-side decryption here -- that
     * pipeline belongs to paid ebook chapters, not to public-account articles.
     *
     * Measured against a live session, this route answers `-2012` ("登录超时") for a session that
     * every other mobile route serves normally -- `/book/chapterInfos` returns 200 with the same
     * headers in the same process. The body shape below is right: sending `url` instead of `urls`
     * gets `-2003` from parameter validation, so `{urls, need_content}` is what reaches the
     * entitlement check. What the route wants beyond a valid access token is not established, and
     * a `-2012` from here should not be read as an expired token.
     */
    async paidContent(docUrl: string, options: RequestOptions = {}): Promise<PaidArticleResponse> {
      assertOperationArguments(OPERATIONS.publicAccountsPaidContent, { docUrl });
      const response = await mobile.call<unknown>("POST", "/mp/getpaidinfo", {
        body: { urls: [docUrl], need_content: true },
        // Semantically a read: it fetches a body and commits nothing, so replaying it once after
        // an auth refresh is safe.
        idempotent: true,
        acceptArrayResponse: true,
        treatExpiredSessionAsBusinessError: true,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const body = response.body;
      const entries = Array.isArray(body)
        ? body
        : Array.isArray((body as { data?: unknown } | null)?.data)
          ? (body as { data: unknown[] }).data
          : undefined;
      // An empty result is an upstream failure, not an article that happens to have no content.
      if (entries === undefined || entries.length === 0) {
        throw new WeReadApiError("mobile /mp/getpaidinfo: no entry for the requested article", {
          path: "/mp/getpaidinfo",
          status: response.status,
        });
      }
      return { entries: entries as PaidArticleResponse["entries"] };
    },

    subscribe(accountId: string, options: RequestOptions = {}): Promise<MutationSuccessResponse> {
      assertOperationArguments(OPERATIONS.publicAccountsSubscribe, { accountId });
      return shelf.add(accountId, { signal: options.signal });
    },

    unsubscribe(accountId: string, options: RequestOptions = {}): Promise<MutationSuccessResponse> {
      assertOperationArguments(OPERATIONS.publicAccountsUnsubscribe, { accountId });
      return shelf.delete(accountId, { signal: options.signal });
    },
  };
}
