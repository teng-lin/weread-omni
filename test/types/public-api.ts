import type {
  AccountManager,
  AccountManagerOptions,
  ArticleMpInfo,
  AskBookResult,
  applyConnectAttemptTimeout,
  BestBookmarksResponse,
  BookDetailOptions,
  BookDetailResponse,
  BookInfo,
  BookmarkListResponse,
  BookProgress,
  buildPublicAccountFeed,
  CanonicalClient,
  ChapterInfoResponse,
  ClientLoginOptions,
  Credentials,
  EinkClientOptions,
  exportPublicAccountArchive,
  ImportBookResult,
  Logger,
  MarkFinishedResponse,
  MineReviewListResponse,
  MobileApiClient,
  MobileApiClientOptions,
  MobileCallOptions,
  MobileClientOptions,
  MobileResourceDependencies,
  MutationSuccessResponse,
  NotebooksResponse,
  PaidArticleEntry,
  PaidArticleResponse,
  PublicAccountArchiveOptions,
  PublicAccountArchiveResult,
  PublicAccountArticleResolution,
  PublicAccountArticlesOptions,
  PublicAccountArticlesPage,
  PublicAccountArtifactError,
  PublicAccountFeedOptions,
  PublicAccountFeedResult,
  PublicAccountFeedSource,
  PublicAccountSubscriptionsOptions,
  PublicAccountSubscriptionsPage,
  RawMobileCallOptions,
  ReadDataResponse,
  ReadReviewsResponse,
  RecentNotesOptions,
  RecentNotesResponse,
  RecommendResponse,
  ReviewAddResponse,
  ReviewEditResponse,
  ReviewListResponse,
  ReviewSingleResponse,
  SearchResponse,
  SearchSuggestResponse,
  ShelfSyncResponse,
  SimilarResponse,
  SuggestResponse,
  TokenManagerOptions,
  UnderlinesResponse,
  UpdateBookmarkInput,
  WeReadClient,
} from "../../src/index.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;
type Expect<Value extends true> = Value;
type Result<Method> = Method extends (...args: never[]) => Promise<infer Response> ? Response : never;

declare const publicClient: WeReadClient;
declare const mpInfo: ArticleMpInfo;
// @ts-expect-error upstream extras are preserved at runtime, not widened into an index signature
mpInfo.unconfirmedUpstreamField;

const _partialLogger: Logger = { warn: () => undefined };
const _consoleLogger: Logger = console;
// @ts-expect-error a login cannot replace the client profile
const _loginWithProfile: ClientLoginOptions = { profile: undefined as never };
// @ts-expect-error a login cannot replace the client device
const _loginWithDevice: ClientLoginOptions = { device: undefined as never };
// @ts-expect-error the e-ink factory cannot accept a profile override
const _einkWithProfile: EinkClientOptions = { profile: undefined as never };
// @ts-expect-error the response ceiling belongs only to callRaw
const _parsedCallWithRawLimit: MobileCallOptions = { maxResponseBytes: 1 };

type PublicClientKeys =
  | "search"
  | "book"
  | "shelf"
  | "publicAccounts"
  | "notes"
  | "review"
  | "readData"
  | "discover"
  | "ai"
  | "import";
type MobileClientKeys = PublicClientKeys | "mobile" | "login" | "reloadCredentials";

export type PublicApiAssertions = [
  Expect<Equal<ConstructorParameters<typeof AccountManager>, [options?: AccountManagerOptions]>>,
  Expect<
    Equal<
      typeof applyConnectAttemptTimeout,
      (env?: NodeJS.ProcessEnv, setAttemptTimeout?: (milliseconds: number) => void) => number | undefined
    >
  >,
  Expect<Equal<keyof WeReadClient, PublicClientKeys>>,
  Expect<WeReadClient extends CanonicalClient ? true : false>,
  Expect<Equal<ConstructorParameters<typeof WeReadClient>, [options: { eink: MobileApiClient }]>>,
  Expect<Equal<keyof MobileApiClient, MobileClientKeys>>,
  Expect<Equal<keyof MobileApiClient["mobile"], "vid" | "call" | "callRaw">>,
  Expect<Equal<Parameters<MobileApiClient["mobile"]["call"]>[2], MobileCallOptions | undefined>>,
  Expect<Equal<Parameters<MobileApiClient["mobile"]["callRaw"]>[2], RawMobileCallOptions | undefined>>,
  Expect<Equal<keyof WeReadClient["search"], "books" | "suggest">>,
  Expect<Equal<keyof WeReadClient["book"], "info" | "detail" | "chapters" | "progress">>,
  Expect<
    Equal<
      keyof WeReadClient["shelf"],
      "sync" | "add" | "delete" | "pin" | "setPrivate" | "markFinished" | "markReading"
    >
  >,
  Expect<
    Equal<
      keyof WeReadClient["publicAccounts"],
      "subscriptions" | "articles" | "resolveArticle" | "paidContent" | "subscribe" | "unsubscribe"
    >
  >,
  Expect<Equal<Result<WeReadClient["publicAccounts"]["paidContent"]>, PaidArticleResponse>>,
  Expect<Equal<PaidArticleResponse["entries"][number], PaidArticleEntry>>,
  Expect<
    Equal<
      keyof WeReadClient["notes"],
      | "notebooks"
      | "recent"
      | "bookmarks"
      | "mine"
      | "best"
      | "readReviews"
      | "underlines"
      | "addBookmark"
      | "updateBookmark"
      | "removeBookmark"
    >
  >,
  Expect<Equal<keyof WeReadClient["review"], "list" | "single" | "add" | "edit" | "delete">>,
  Expect<Equal<keyof WeReadClient["readData"], "detail">>,
  Expect<Equal<keyof WeReadClient["discover"], "recommend" | "similar">>,
  Expect<Equal<keyof WeReadClient["ai"], "askBook" | "suggest">>,
  Expect<Equal<keyof WeReadClient["import"], "book">>,
  Expect<Equal<Extract<"profile", keyof ClientLoginOptions>, never>>,
  Expect<Equal<NonNullable<ClientLoginOptions["onCredentials"]>, (credentials: Credentials) => Promise<void> | void>>,
  Expect<Equal<NonNullable<MobileApiClientOptions["logger"]>, Logger>>,
  Expect<Equal<NonNullable<MobileClientOptions["logger"]>, Logger>>,
  Expect<Equal<NonNullable<TokenManagerOptions["logger"]>, Logger>>,
  Expect<Equal<Extract<"profile", keyof EinkClientOptions>, never>>,
  Expect<Equal<keyof MobileResourceDependencies, "sleep" | "cosUpload" | "env">>,
  Expect<Equal<Result<WeReadClient["search"]["books"]>, SearchResponse>>,
  Expect<Equal<Result<WeReadClient["search"]["suggest"]>, SearchSuggestResponse>>,
  Expect<Equal<Result<WeReadClient["book"]["info"]>, BookInfo>>,
  Expect<Equal<Result<WeReadClient["book"]["detail"]>, BookDetailResponse>>,
  Expect<Equal<Parameters<WeReadClient["book"]["detail"]>[1], BookDetailOptions | undefined>>,
  Expect<Equal<Result<WeReadClient["book"]["chapters"]>, ChapterInfoResponse>>,
  Expect<Equal<Result<WeReadClient["book"]["progress"]>, BookProgress>>,
  Expect<Equal<Result<WeReadClient["shelf"]["sync"]>, ShelfSyncResponse>>,
  Expect<Equal<Result<WeReadClient["shelf"]["add"]>, MutationSuccessResponse>>,
  Expect<Equal<Result<WeReadClient["shelf"]["delete"]>, MutationSuccessResponse>>,
  Expect<Equal<Result<WeReadClient["shelf"]["pin"]>, MutationSuccessResponse>>,
  Expect<Equal<Result<WeReadClient["shelf"]["setPrivate"]>, MutationSuccessResponse>>,
  Expect<Equal<Result<WeReadClient["shelf"]["markFinished"]>, MarkFinishedResponse>>,
  Expect<Equal<Result<WeReadClient["shelf"]["markReading"]>, MarkFinishedResponse>>,
  Expect<Equal<Result<WeReadClient["publicAccounts"]["subscriptions"]>, PublicAccountSubscriptionsPage>>,
  Expect<
    Equal<Parameters<WeReadClient["publicAccounts"]["subscriptions"]>[0], PublicAccountSubscriptionsOptions | undefined>
  >,
  Expect<Equal<Result<WeReadClient["publicAccounts"]["articles"]>, PublicAccountArticlesPage>>,
  Expect<Equal<Parameters<WeReadClient["publicAccounts"]["articles"]>[1], PublicAccountArticlesOptions | undefined>>,
  Expect<Equal<Result<WeReadClient["publicAccounts"]["resolveArticle"]>, PublicAccountArticleResolution>>,
  Expect<Equal<Result<WeReadClient["publicAccounts"]["subscribe"]>, MutationSuccessResponse>>,
  Expect<Equal<Result<WeReadClient["publicAccounts"]["unsubscribe"]>, MutationSuccessResponse>>,
  Expect<Equal<Result<WeReadClient["notes"]["notebooks"]>, NotebooksResponse>>,
  Expect<Equal<Result<WeReadClient["notes"]["recent"]>, RecentNotesResponse>>,
  Expect<Equal<Parameters<WeReadClient["notes"]["recent"]>[0], RecentNotesOptions | undefined>>,
  Expect<Equal<Result<WeReadClient["notes"]["bookmarks"]>, BookmarkListResponse>>,
  Expect<Equal<Result<WeReadClient["notes"]["mine"]>, MineReviewListResponse>>,
  Expect<Equal<Result<WeReadClient["notes"]["best"]>, BestBookmarksResponse>>,
  Expect<Equal<Result<WeReadClient["notes"]["readReviews"]>, ReadReviewsResponse>>,
  Expect<Equal<Result<WeReadClient["notes"]["underlines"]>, UnderlinesResponse>>,
  Expect<Equal<Result<WeReadClient["notes"]["addBookmark"]>, MutationSuccessResponse>>,
  Expect<Equal<Parameters<WeReadClient["notes"]["updateBookmark"]>[0], UpdateBookmarkInput>>,
  Expect<Equal<Result<WeReadClient["notes"]["updateBookmark"]>, MutationSuccessResponse>>,
  Expect<Equal<Result<WeReadClient["notes"]["removeBookmark"]>, MutationSuccessResponse>>,
  Expect<Equal<Result<WeReadClient["review"]["list"]>, ReviewListResponse>>,
  Expect<Equal<Result<WeReadClient["review"]["single"]>, ReviewSingleResponse>>,
  Expect<Equal<Result<WeReadClient["review"]["add"]>, ReviewAddResponse>>,
  Expect<Equal<Result<WeReadClient["review"]["edit"]>, ReviewEditResponse>>,
  Expect<Equal<Result<WeReadClient["review"]["delete"]>, MutationSuccessResponse>>,
  Expect<Equal<Result<WeReadClient["readData"]["detail"]>, ReadDataResponse>>,
  Expect<Equal<Result<WeReadClient["discover"]["recommend"]>, RecommendResponse>>,
  Expect<Equal<Result<WeReadClient["discover"]["similar"]>, SimilarResponse>>,
  Expect<Equal<Result<WeReadClient["ai"]["askBook"]>, AskBookResult>>,
  Expect<Equal<Result<WeReadClient["ai"]["suggest"]>, SuggestResponse>>,
  Expect<Equal<Result<WeReadClient["import"]["book"]>, ImportBookResult>>,
  Expect<
    Equal<
      Parameters<typeof buildPublicAccountFeed>,
      [
        client: Pick<CanonicalClient, "publicAccounts" | "review">,
        source: PublicAccountFeedSource,
        options: PublicAccountFeedOptions,
      ]
    >
  >,
  Expect<Equal<ReturnType<typeof buildPublicAccountFeed>, Promise<PublicAccountFeedResult>>>,
  Expect<
    Equal<
      Parameters<typeof exportPublicAccountArchive>,
      [
        client: Pick<CanonicalClient, "publicAccounts" | "review">,
        accountId: string,
        options: PublicAccountArchiveOptions,
      ]
    >
  >,
  Expect<Equal<ReturnType<typeof exportPublicAccountArchive>, Promise<PublicAccountArchiveResult>>>,
  Expect<Equal<InstanceType<typeof PublicAccountArtifactError>["incomplete"], boolean>>,
];
