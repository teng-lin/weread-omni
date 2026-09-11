# weread-omni public API surface

<!--
  GENERATED FILE — do not edit by hand.

  Produced from the built declarations (dist/) by test/support/api-surface.ts and compared
  by test/integration/api-surface.test.ts. A diff here is a public API change: review it,
  then re-bless deliberately with

      npm run build && npm run api-surface:update

  Members are sorted, so a diff shows semantic change rather than source order.
-->

## Entry points

### `weread-omni` — dist/index.d.ts (197 exports)

- `ALLOWED_EXT` — const — dist/api/import-guards.d.ts
- `AccessToken` — interface — dist/auth/token.d.ts
- `AccountLoginOptions` — interface — dist/accounts.d.ts
- `AccountManager` — class — dist/accounts.d.ts
- `AccountManagerOptions` — interface — dist/accounts.d.ts
- `AccountSummary` — interface — dist/accounts.d.ts
- `AddBookmarkInput` — interface — dist/api/types.d.ts
- `ArticleMpInfo` — interface — dist/api/types.d.ts
- `AskBookInput` — interface — dist/api/types.d.ts
- `AskBookResult` — interface — dist/api/types.d.ts
- `AuthError` — class — dist/errors.d.ts
- `AuthRequestOptions` — interface — dist/auth/qrlogin.d.ts
- `BestBookmarkItem` — interface — dist/api/types.d.ts
- `BestBookmarksResponse` — interface — dist/api/types.d.ts
- `BestNotesOptions` — interface — dist/api/types.d.ts
- `BookDetailOptions` — interface — dist/api/types.d.ts
- `BookDetailResponse` — interface — dist/api/types.d.ts
- `BookInfo` — interface — dist/api/types.d.ts
- `BookProgress` — interface — dist/api/types.d.ts
- `BookValidationError` — class — dist/api/import-guards.d.ts
- `Bookmark` — interface — dist/api/types.d.ts
- `BookmarkListResponse` — interface — dist/api/types.d.ts
- `CanonicalBook` — type — dist/api/client.d.ts
- `CanonicalClient` — interface — dist/api/client.d.ts
- `ChapterContent` — type — dist/api/types.d.ts
- `ChapterInfo` — interface — dist/api/types.d.ts
- `ChapterInfoResponse` — interface — dist/api/types.d.ts
- `ChapterMetadata` — interface — dist/library/store.d.ts
- `ClientLoginOptions` — type — dist/api/mobile-client.d.ts
- `ClientProfile` — interface — dist/profile.d.ts
- `ClientSummary` — interface — dist/accounts.d.ts
- `ContentLibrary` — class — dist/library/store.d.ts
- `ContentLibraryOptions` — interface — dist/library/store.d.ts
- `CosCredentials` — interface — dist/api/types.d.ts
- `CosUploadInput` — interface — dist/api/types.d.ts
- `CosUploader` — type — dist/api/types.d.ts
- `Credentials` — interface — dist/auth/credentials.d.ts
- `EinkClientOptions` — type — dist/api/mobile-client.d.ts
- `ImportBookInput` — type — dist/api/types.d.ts
- `ImportBookResult` — interface — dist/api/types.d.ts
- `ImportFailurePhase` — type — dist/api/resources/import.d.ts
- `ImportPhaseError` — class — dist/api/resources/import.d.ts
- `LibraryClientOptions` — interface — dist/library/cached-client.d.ts
- `LibraryError` — class — dist/library/errors.d.ts
- `LibraryMode` — type — dist/library/cached-client.d.ts
- `LibraryStats` — interface — dist/library/store.d.ts
- `LibraryStoreError` — class — dist/library/errors.d.ts
- `LibraryUnsupportedError` — class — dist/library/errors.d.ts
- `LibraryVersionError` — class — dist/library/errors.d.ts
- `LoadCredentialsOptions` — interface — dist/auth/credentials.d.ts
- `Logger` — type — dist/logger.d.ts
- `LoginOptions` — interface — dist/auth/qrlogin.d.ts
- `LoginStatus` — type — dist/auth/qrlogin.d.ts
- `MarkFinishedResponse` — interface — dist/api/types.d.ts
- `MineNotesOptions` — interface — dist/api/types.d.ts
- `MineReviewItem` — interface — dist/api/types.d.ts
- `MineReviewListResponse` — interface — dist/api/types.d.ts
- `MintAccessTokenOptions` — interface — dist/auth/token.d.ts
- `MobileApiClient` — class — dist/api/mobile-client.d.ts
- `MobileApiClientOptions` — interface — dist/api/mobile-client.d.ts
- `MobileCallOptions` — interface — dist/api/mobile.d.ts
- `MobileClient` — class — dist/api/mobile.d.ts
- `MobileClientOptions` — interface — dist/api/mobile.d.ts
- `MobileDevice` — interface — dist/device-ua.d.ts
- `MobileResourceDependencies` — interface — dist/api/resources/index.d.ts
- `MobileResponse` — interface — dist/api/mobile.d.ts
- `MutationSuccessResponse` — interface — dist/api/types.d.ts
- `NotebookBook` — interface — dist/api/types.d.ts
- `NotebooksOptions` — interface — dist/api/types.d.ts
- `NotebooksResponse` — interface — dist/api/types.d.ts
- `OpenAccount` — interface — dist/accounts.d.ts
- `PUBLIC_OPERATIONS` — const — dist/api/operations.d.ts
- `PaidArticleEntry` — interface — dist/api/types.d.ts
- `PaidArticleResponse` — interface — dist/api/types.d.ts
- `PollOptions` — interface — dist/auth/qrlogin.d.ts
- `PreferAuthorItem` — interface — dist/api/types.d.ts
- `PreferCategoryItem` — interface — dist/api/types.d.ts
- `PreferCopyrightItem` — interface — dist/api/types.d.ts
- `PreferPublisherItem` — interface — dist/api/types.d.ts
- `PublicAccount` — interface — dist/api/types.d.ts
- `PublicAccountArchiveItem` — interface — dist/api/types.d.ts
- `PublicAccountArchiveManifest` — interface — dist/api/types.d.ts
- `PublicAccountArchiveOptions` — interface — dist/api/types.d.ts
- `PublicAccountArchiveResult` — interface — dist/api/types.d.ts
- `PublicAccountArticle` — interface — dist/api/types.d.ts
- `PublicAccountArticleResolution` — interface — dist/api/types.d.ts
- `PublicAccountArticleState` — type — dist/api/types.d.ts
- `PublicAccountArticlesOptions` — interface — dist/api/types.d.ts
- `PublicAccountArticlesPage` — interface — dist/api/types.d.ts
- `PublicAccountArtifactError` — class — dist/public-accounts.d.ts
- `PublicAccountArtifactErrorCode` — type — dist/api/types.d.ts
- `PublicAccountCursor` — interface — dist/api/types.d.ts
- `PublicAccountCursorTerminal` — type — dist/api/types.d.ts
- `PublicAccountDiagnostic` — interface — dist/api/types.d.ts
- `PublicAccountDiagnosticCode` — type — dist/api/types.d.ts
- `PublicAccountFeedFormat` — type — dist/api/types.d.ts
- `PublicAccountFeedOptions` — interface — dist/api/types.d.ts
- `PublicAccountFeedResult` — interface — dist/api/types.d.ts
- `PublicAccountFeedSource` — type — dist/api/types.d.ts
- `PublicAccountLibrary` — interface — dist/api/types.d.ts
- `PublicAccountLibraryMode` — type — dist/api/types.d.ts
- `PublicAccountReadError` — class — dist/public-accounts.d.ts
- `PublicAccountReadOptions` — interface — dist/public-accounts.d.ts
- `PublicAccountReadResult` — interface — dist/public-accounts.d.ts
- `PublicAccountSubscriptionsOptions` — interface — dist/api/types.d.ts
- `PublicAccountSubscriptionsPage` — interface — dist/api/types.d.ts
- `PutArticleInput` — type — dist/api/types.d.ts
- `QrRequest` — interface — dist/auth/qrlogin.d.ts
- `QueryValue` — type — dist/api/mobile.d.ts
- `RawMobileCallOptions` — interface — dist/api/mobile.d.ts
- `ReadDataOptions` — interface — dist/api/types.d.ts
- `ReadDataResponse` — interface — dist/api/types.d.ts
- `ReadLongestItem` — interface — dist/api/types.d.ts
- `ReadReviewPageItem` — interface — dist/api/types.d.ts
- `ReadReviewQuery` — interface — dist/api/types.d.ts
- `ReadReviewRange` — interface — dist/api/types.d.ts
- `ReadReviewsResponse` — interface — dist/api/types.d.ts
- `ReadStatItem` — interface — dist/api/types.d.ts
- `RecentNoteItem` — interface — dist/api/types.d.ts
- `RecentNotesOptions` — interface — dist/api/types.d.ts
- `RecentNotesResponse` — interface — dist/api/types.d.ts
- `RecommendBook` — interface — dist/api/types.d.ts
- `RecommendOptions` — interface — dist/api/types.d.ts
- `RecommendResponse` — interface — dist/api/types.d.ts
- `RequestOptions` — interface — dist/api/types.d.ts
- `ReviewAddInput` — interface — dist/api/types.d.ts
- `ReviewAddResponse` — interface — dist/api/types.d.ts
- `ReviewAuthor` — interface — dist/api/types.d.ts
- `ReviewDetail` — interface — dist/api/types.d.ts
- `ReviewEditResponse` — interface — dist/api/types.d.ts
- `ReviewItem` — interface — dist/api/types.d.ts
- `ReviewListOptions` — interface — dist/api/types.d.ts
- `ReviewListResponse` — interface — dist/api/types.d.ts
- `ReviewSingleOptions` — interface — dist/api/types.d.ts
- `ReviewSingleResponse` — interface — dist/api/types.d.ts
- `SaveCredentialsOptions` — interface — dist/auth/credentials.d.ts
- `SearchAudioResult` — interface — dist/api/types.d.ts
- `SearchAuthorResult` — interface — dist/api/types.d.ts
- `SearchBookContentResult` — interface — dist/api/types.d.ts
- `SearchBooklistResult` — interface — dist/api/types.d.ts
- `SearchOptions` — interface — dist/api/types.d.ts
- `SearchResponse` — interface — dist/api/types.d.ts
- `SearchResult` — interface — dist/api/types.d.ts
- `SearchScope` — type — dist/api/types.d.ts
- `SearchSuggestOptions` — interface — dist/api/types.d.ts
- `SearchSuggestResponse` — interface — dist/api/types.d.ts
- `SearchSuggestion` — interface — dist/api/types.d.ts
- `ShelfAlbum` — interface — dist/api/types.d.ts
- `ShelfArchive` — interface — dist/api/types.d.ts
- `ShelfBook` — interface — dist/api/types.d.ts
- `ShelfSyncResponse` — interface — dist/api/types.d.ts
- `SimilarOptions` — interface — dist/api/types.d.ts
- `SimilarResponse` — interface — dist/api/types.d.ts
- `StarRating` — type — dist/api/types.d.ts
- `StorableArticleState` — type — dist/api/types.d.ts
- `StoredArticle` — interface — dist/api/types.d.ts
- `SuggestInput` — interface — dist/api/types.d.ts
- `SuggestPrompt` — interface — dist/api/types.d.ts
- `SuggestQuestionHint` — interface — dist/api/types.d.ts
- `SuggestResponse` — interface — dist/api/types.d.ts
- `SyncCursor` — interface — dist/api/types.d.ts
- `SyncOptions` — interface — dist/api/types.d.ts
- `TocBackend` — type — dist/library/store.d.ts
- `TokenManager` — class — dist/auth/token.d.ts
- `TokenManagerOptions` — interface — dist/auth/token.d.ts
- `TokenProvider` — interface — dist/api/mobile.d.ts
- `TransportError` — class — dist/errors.d.ts
- `UnderlineItem` — interface — dist/api/types.d.ts
- `UnderlinesResponse` — interface — dist/api/types.d.ts
- `UpdateBookmarkInput` — interface — dist/api/types.d.ts
- `UserSummary` — interface — dist/api/types.d.ts
- `WeReadApiError` — class — dist/errors.d.ts
- `WeReadClient` — class — dist/api/client.d.ts
- `WeReadClientOptions` — interface — dist/api/client.d.ts
- `WeReadError` — class — dist/errors.d.ts
- `YearReportItem` — interface — dist/api/types.d.ts
- `applyConnectAttemptTimeout` — function — dist/connect-timeout.d.ts
- `buildPublicAccountFeed` — function — dist/public-accounts.d.ts
- `createEinkClient` — const — dist/api/mobile-client.d.ts
- `deviceVersionHeaders` — function — dist/device-ua.d.ts
- `einkDevice` — function — dist/device-ua.d.ts
- `einkProfile` — function — dist/profile.d.ts
- `exchange` — function — dist/auth/qrlogin.d.ts
- `exportPublicAccountArchive` — function — dist/public-accounts.d.ts
- `isAmbiguousImportOutcome` — const — dist/api/resources/import.d.ts
- `libraryRoot` — function — dist/library/paths.d.ts
- `loadCredentials` — function — dist/auth/credentials.d.ts
- `login` — function — dist/auth/qrlogin.d.ts
- `mintAccessToken` — function — dist/auth/token.d.ts
- `pollForCode` — function — dist/auth/qrlogin.d.ts
- `readPublicAccountArticle` — function — dist/public-accounts.d.ts
- `requestQr` — function — dist/auth/qrlogin.d.ts
- `resolveProfile` — function — dist/profile.d.ts
- `saveCredentials` — function — dist/auth/credentials.d.ts
- `storePath` — function — dist/auth/credentials.d.ts
- `toTransportError` — function — dist/errors.d.ts
- `withContentLibrary` — function — dist/library/cached-client.d.ts

### `weread-omni/cli` — dist/cli.d.ts (21 exports)

- `AccountCliDependencies` — interface — dist/cli.d.ts
- `AccountSelector` — type — dist/cli.d.ts
- `CliDependencies` — interface — dist/cli.d.ts
- `CliIdentity` — interface — dist/cli.d.ts
- `CliOperationsClient` — type — dist/cli/commands.d.ts
- `CliStore` — interface — dist/cli.d.ts
- `CliStoreCommandContext` — interface — dist/cli.d.ts
- `CliStoreIdentity` — interface — dist/cli.d.ts
- `CommandContext` — interface — dist/cli/commands.d.ts
- `ExtendProgram` — type — dist/cli.d.ts
- `ExtendStoreProgram` — type — dist/cli.d.ts
- `OutputOptions` — interface — dist/cli/output.d.ts
- `OutputWriter` — interface — dist/cli/output.d.ts
- `createProgram` — function — dist/cli.d.ts
- `integer` — function — dist/cli/commands.d.ts
- `isMain` — function — dist/cli.d.ts
- `output` — function — dist/cli/output.d.ts
- `port` — function — dist/cli/commands.d.ts
- `printQr` — function — dist/auth/qr-terminal.d.ts
- `runAccountCli` — function — dist/cli.d.ts
- `runCli` — function — dist/cli.d.ts

### `weread-omni/plugin` — dist/plugin.d.ts (16 exports)

- `CLIENT_ID_PATTERN` — const — dist/plugin.d.ts
- `CLIENT_PLUGIN_API_VERSION` — const — dist/plugin.d.ts
- `ClientIdentity` — interface — dist/plugin.d.ts
- `ClientLoginContext` — interface — dist/plugin.d.ts
- `ClientLoginResult` — interface — dist/plugin.d.ts
- `ClientOpenContext` — interface — dist/plugin.d.ts
- `ClientOpenResult` — interface — dist/plugin.d.ts
- `ClientPlugin` — interface — dist/plugin.d.ts
- `ClientProvider` — interface — dist/plugin.d.ts
- `JsonValue` — type — dist/plugin.d.ts
- `RegisteredClient` — interface — dist/plugin.d.ts
- `assertCanonicalClient` — function — dist/plugin.d.ts
- `loadClientPlugins` — function — dist/plugin.d.ts
- `pluginSpecifiers` — function — dist/plugin.d.ts
- `registerClientPlugins` — function — dist/plugin.d.ts
- `validateClientPlugin` — function — dist/plugin.d.ts

## Declarations

Every exported symbol above, plus every package-declared type reachable from one.

### `ALLOWED_EXT` — dist/api/import-guards.d.ts

```ts
const ALLOWED_EXT: ReadonlySet<string>
```

### `AccessToken` — dist/auth/token.d.ts

```ts
interface AccessToken {
  accessToken: string
  refreshToken: string
  vid: string
}
```

### `AccountCliDependencies` — dist/cli.d.ts

```ts
interface AccountCliDependencies extends Omit<CliDependencies<MobileApiClient>, "accountManager" | "getClient" | "stores"> {
  accountManager: AccountManager
  confirm?: ((message: string) => Promise<boolean>)
  env?: ProcessEnv
  extendProgram?: ExtendProgram<MobileApiClient>
  extendStoreProgram?: ExtendStoreProgram
  getIdentity?: (() => CliIdentity)
  isTTY?: boolean
  library?: PublicAccountLibrary
  libraryMode?: PublicAccountLibraryMode
  renderQr?: ((text: string) => Promise<string | undefined>)
  selectAccount?: AccountSelector
  signal?: AbortSignal
  stderr?: OutputWriter
  stdout?: OutputWriter
  store?: string
}
```

### `AccountLoginOptions` — dist/accounts.d.ts

```ts
interface AccountLoginOptions extends Pick<ClientLoginContext, "onOtp" | "onQr" | "onStatus" | "signal"> {
  client?: string
  onOtp: () => string | Promise<string>
  onQr: (url: string, stage?: string | undefined) => void | Promise<void>
  onStatus: (status: string, stage?: string | undefined) => void | Promise<void>
  signal?: AbortSignal
}
```

### `AccountManager` — dist/accounts.d.ts

```ts
class AccountManager {
  new (options?: AccountManagerOptions): AccountManager
  #private
  accounts: () => AccountSummary[]
  clearDefaultAccount: () => void
  clients: () => ClientSummary[]
  defaultAccount: () => string | undefined
  login: (aliasInput: string, options: AccountLoginOptions) => Promise<AccountSummary & ClientIdentity>
  open: (aliasInput: string) => Promise<OpenAccount>
  select: (requested?: readonly string[] | undefined) => string[]
  setDefaultAccount: (aliasInput: string) => AccountSummary
}
```

### `AccountManagerOptions` — dist/accounts.d.ts

```ts
interface AccountManagerOptions {
  env?: ProcessEnv
  fetchImpl?: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }
  plugins?: readonly ClientPlugin[]
}
```

### `AccountSelector` — dist/cli.d.ts

```ts
type AccountSelector = (accounts: readonly AccountSummary[]) => string | Promise<string>
```

### `AccountSummary` — dist/accounts.d.ts

```ts
interface AccountSummary {
  account: string
  client: string
}
```

### `AddBookmarkInput` — dist/api/types.d.ts

```ts
interface AddBookmarkInput extends RequestOptions {
  bookId: string
  bookVersion?: number
  chapterName?: string
  chapterUid: number
  colorStyle?: number
  contextAbstract?: string
  markText: string
  range: string
  signal?: AbortSignal
  style?: number
  type?: number
}
```

### `ArticleMpInfo` — dist/api/types.d.ts

```ts
interface ArticleMpInfo {
  avatar?: string
  content?: string
  doc_url?: string
  inner?: number
  mp_name?: string
  originalId?: string
  payType?: number
  pic_url?: string
  time?: number
  title?: string
}
```

### `AskBookInput` — dist/api/types.d.ts

```ts
interface AskBookInput extends RequestOptions {
  bookId: string
  delayCapMs?: number
  intent?: string
  maxPolls?: number
  query: string
  signal?: AbortSignal
}
```

### `AskBookResult` — dist/api/types.d.ts

```ts
interface AskBookResult {
  chatid: string
  complete: boolean
  sessionId: string
  text: string
  thinking: string
}
```

### `AuthError` — dist/errors.d.ts

```ts
class AuthError extends WeReadError {
  new (message: string, options?: { cause?: unknown; }): AuthError
}
```

### `AuthRequestOptions` — dist/auth/qrlogin.d.ts

```ts
interface AuthRequestOptions {
  profile?: ClientProfile
  signal?: AbortSignal
  timeoutMs?: number
}
```

### `BestBookmarkItem` — dist/api/types.d.ts

```ts
interface BestBookmarkItem {
  bookId?: string
  bookmarkId?: string
  chapterUid?: number
  markText?: string
  range?: string
  simplifiedRange?: string
  totalCount?: number
  traditionalRange?: string
  userVid?: string
}
```

### `BestBookmarksResponse` — dist/api/types.d.ts

```ts
interface BestBookmarksResponse extends SyncCursor {
  chapters?: { bookId?: string | undefined; chapterUid?: number | undefined; chapterIdx?: number | undefined; title?: string | undefined; }[]
  hasMore?: number
  items?: BestBookmarkItem[]
  synckey?: number
  totalCount?: number
}
```

### `BestNotesOptions` — dist/api/types.d.ts

```ts
interface BestNotesOptions extends SyncOptions {
  chapterUid?: number
  count?: number
  maxIdx?: number
  signal?: AbortSignal
  synckey?: number
}
```

### `BookDetailOptions` — dist/api/types.d.ts

```ts
interface BookDetailOptions extends RequestOptions {
  count?: number
  signal?: AbortSignal
}
```

### `BookDetailResponse` — dist/api/types.d.ts

```ts
interface BookDetailResponse {
  authorOpus: { books: { bookInfo?: BookInfo | undefined; }[]; totalCount?: number | undefined; synckey?: number | undefined; authorBooksHasMore?: number | undefined; uncertifiedUser?: { name?: string | undefined; authorId?: string | undefined; isSubscribed?: number | undefined; } | undefined; }
  copyRightOpus: { books?: { bookInfo?: BookInfo | undefined; }[] | undefined; totalCount?: number | undefined; synckey?: number | undefined; copyRightBooksHasMore?: number | undefined; user?: (UserSummary & { role?: number | undefined; isHide?: number | undefined; isFollowing?: number | undefined; }) | undefined; }
  skuImages: { urls: string[]; }
}
```

### `BookInfo` — dist/api/types.d.ts

```ts
interface BookInfo {
  author?: string
  bookId?: string
  bookStatus?: number
  category?: string
  cover?: string
  deepLink?: string
  finished?: number
  format?: string
  intro?: string
  isbn?: string
  newRating?: number
  newRatingCount?: number
  newRatingDetail?: { title?: string | undefined; }
  payType?: number
  price?: number
  publishTime?: string
  publisher?: string
  soldout?: number
  title?: string
  translator?: string
  type?: number
  wordCount?: number
}
```

### `BookProgress` — dist/api/types.d.ts

```ts
interface BookProgress {
  book?: { chapterUid?: number | undefined; chapterOffset?: number | undefined; progress?: number | undefined; updateTime?: number | undefined; recordReadingTime?: number | undefined; finishTime?: number | undefined; isStartReading?: number | undefined; }
  bookId?: string
  timestamp?: number
}
```

### `BookValidationError` — dist/api/import-guards.d.ts

```ts
class BookValidationError extends WeReadError {
  new (code: "too-large" | "unsupported-format", message: string): BookValidationError
  readonly code: "too-large" | "unsupported-format"
}
```

### `Bookmark` — dist/api/types.d.ts

```ts
interface Bookmark {
  bookId?: string
  bookmarkId?: string
  chapterIdx?: number
  chapterUid?: number
  colorStyle?: number
  createTime?: number
  markText?: string
  range?: string
  style?: number
  type?: number
}
```

### `BookmarkListResponse` — dist/api/types.d.ts

```ts
interface BookmarkListResponse {
  book?: { bookId?: string | undefined; title?: string | undefined; }
  chapters?: { chapterUid?: number | undefined; title?: string | undefined; }[]
  updated: Bookmark[]
}
```

### `CLIENT_ID_PATTERN` — dist/plugin.d.ts

```ts
const CLIENT_ID_PATTERN: RegExp
```

### `CLIENT_PLUGIN_API_VERSION` — dist/plugin.d.ts

```ts
const CLIENT_PLUGIN_API_VERSION: 1
```

### `CanonicalBook` — dist/api/client.d.ts

```ts
type CanonicalBook = { info: (bookId: string, options?: RequestOptions | undefined) => Promise<BookInfo>; detail: (bookId: string, options?: BookDetailOptions | undefined) => Promise<BookDetailResponse>; chapters: (bookId: string, options?: RequestOptions | undefined) => Promise<ChapterInfoResponse>; progress: (bookId: string, options?: RequestOptions | undefined) => Promise<BookProgress>; }
// resolves to:
//   chapters: (bookId: string, options?: RequestOptions | undefined) => Promise<ChapterInfoResponse>
//   detail: (bookId: string, options?: BookDetailOptions | undefined) => Promise<BookDetailResponse>
//   info: (bookId: string, options?: RequestOptions | undefined) => Promise<BookInfo>
//   progress: (bookId: string, options?: RequestOptions | undefined) => Promise<BookProgress>
```

### `CanonicalClient` — dist/api/client.d.ts

```ts
interface CanonicalClient {
  readonly ai: { askBook(input: AskBookInput): Promise<AskBookResult>; suggest(input: SuggestInput): Promise<SuggestResponse>; }
  readonly book: { info: (bookId: string, options?: RequestOptions | undefined) => Promise<BookInfo>; detail: (bookId: string, options?: BookDetailOptions | undefined) => Promise<BookDetailResponse>; chapters: (bookId: string, options?: RequestOptions | undefined) => Promise<ChapterInfoResponse>; progress: (bookId: string, options?: RequestOptions | undefined) => Promise<BookProgress>; }
  readonly discover: { recommend(options?: RecommendOptions | undefined): Promise<RecommendResponse>; similar(bookId: string, options?: SimilarOptions | undefined): Promise<SimilarResponse>; }
  readonly import: { book(input: ImportBookInput): Promise<ImportBookResult>; }
  readonly notes: { notebooks(options?: NotebooksOptions | undefined): Promise<NotebooksResponse>; recent(options?: RecentNotesOptions | undefined): Promise<RecentNotesResponse>; bookmarks(bookId: string, options?: SyncOptions | undefined): Promise<BookmarkListResponse>; mine(bookId: string, options?: MineNotesOptions | undefined): Promise<MineReviewListResponse>; best(bookId: string, options?: BestNotesOptions | undefined): Promise<BestBookmarksResponse>; readReviews(bookId: string, chapterUid: number, reviews: ReadReviewQuery[], options?: RequestOptions | undefined): Promise<ReadReviewsResponse>; underlines(bookId: string, chapterUid: number, options?: SyncOptions | undefined): Promise<UnderlinesResponse>; addBookmark(input: AddBookmarkInput): Promise<MutationSuccessResponse>; updateBookmark(input: UpdateBookmarkInput): Promise<MutationSuccessResponse>; removeBookmark(bookmarkId: string, options?: RequestOptions | undefined): Promise<MutationSuccessResponse>; }
  readonly publicAccounts: { subscriptions(options?: PublicAccountSubscriptionsOptions | undefined): Promise<PublicAccountSubscriptionsPage>; articles(accountId: string, options?: PublicAccountArticlesOptions | undefined): Promise<PublicAccountArticlesPage>; resolveArticle(docUrl: string, options?: RequestOptions | undefined): Promise<PublicAccountArticleResolution>; paidContent(docUrl: string, options?: RequestOptions | undefined): Promise<PaidArticleResponse>; subscribe(accountId: string, options?: RequestOptions | undefined): Promise<MutationSuccessResponse>; unsubscribe(accountId: string, options?: RequestOptions | undefined): Promise<MutationSuccessResponse>; }
  readonly readData: { detail(options?: ReadDataOptions | undefined): Promise<ReadDataResponse>; }
  readonly review: { list(bookId: string, options?: ReviewListOptions | undefined): Promise<ReviewListResponse>; single(reviewId: string, options?: ReviewSingleOptions | undefined): Promise<ReviewSingleResponse>; add(input: ReviewAddInput): Promise<ReviewAddResponse>; edit(reviewId: string, content: string, options?: RequestOptions | undefined): Promise<ReviewEditResponse>; delete: (reviewId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; }
  readonly search: { books(keyword: string, options?: SearchOptions | undefined): Promise<SearchResponse>; suggest(keyword: string, options?: SearchSuggestOptions | undefined): Promise<SearchSuggestResponse>; }
  readonly shelf: { sync: (options?: RequestOptions | undefined) => Promise<ShelfSyncResponse>; add: (bookId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; delete: (bookId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; pin: (bookId: string, top?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; setPrivate: (bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; markFinished: (bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MarkFinishedResponse>; markReading: (bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MarkFinishedResponse>; }
}
```

### `ChapterContent` — dist/api/types.d.ts

```ts
type ChapterContent = { bookId: string; chapterUid: number; format: "epub"; html: string; css?: string | undefined; } | { bookId: string; chapterUid: number; format: "txt"; text: string; html: string; }
// resolves to:
//   bookId: string
//   chapterUid: number
//   format: "epub" | "txt"
//   html: string
```

### `ChapterInfo` — dist/api/types.d.ts

```ts
interface ChapterInfo {
  anchors?: { title?: string | undefined; level?: number | undefined; }[]
  chapterIdx?: number
  chapterUid?: number
  isMPChapter?: number
  level?: number
  paid?: number
  price?: number
  title?: string
  updateTime?: number
  wordCount?: number
}
```

### `ChapterInfoResponse` — dist/api/types.d.ts

```ts
interface ChapterInfoResponse extends SyncCursor {
  bookId: string
  chapterUpdateTime?: number
  chapters: ChapterInfo[]
  synckey: number
}
```

### `ChapterMetadata` — dist/library/store.d.ts

```ts
interface ChapterMetadata {
  chapterIdx?: number
  origin?: string
  title?: string
  tocSynckey?: number
}
```

### `CliDependencies` — dist/cli.d.ts

```ts
interface CliDependencies<TClient extends CliOperationsClient> {
  accountManager?: AccountManager
  confirm?: ((message: string) => Promise<boolean>)
  env?: ProcessEnv
  extendProgram?: ExtendProgram<TClient>
  extendStoreProgram?: ExtendStoreProgram
  getClient?: (() => TClient)
  getIdentity?: (() => CliIdentity)
  isTTY?: boolean
  library?: PublicAccountLibrary
  libraryMode?: PublicAccountLibraryMode
  renderQr?: ((text: string) => Promise<string | undefined>)
  signal?: AbortSignal
  stderr?: OutputWriter
  stdout?: OutputWriter
  store?: string
  stores?: readonly CliStore[]
}
```

### `CliIdentity` — dist/cli.d.ts

```ts
interface CliIdentity {
  deviceId: string
  source: "environment" | "file"
  vid: string
}
```

### `CliOperationsClient` — dist/cli/commands.d.ts

```ts
type CliOperationsClient = { readonly ai?: { readonly askBook?: ((input: AskBookInput) => Promise<AskBookResult>) | undefined; readonly suggest?: ((input: SuggestInput) => Promise<SuggestResponse>) | undefined; } | undefined; readonly book?: { readonly chapters?: ((bookId: string, options?: RequestOptions | undefined) => Promise<ChapterInfoResponse>) | undefined; readonly detail?: ((bookId: string, options?: BookDetailOptions | undefined) => Promise<BookDetailResponse>) | undefined; readonly info?: ((bookId: string, options?: RequestOptions | undefined) => Promise<BookInfo>) | undefined; readonly progress?: ((bookId: string, options?: RequestOptions | undefined) => Promise<BookProgress>) | undefined; } | undefined; readonly discover?: { readonly recommend?: ((options?: RecommendOptions | undefined) => Promise<RecommendResponse>) | undefined; readonly similar?: ((bookId: string, options?: SimilarOptions | undefined) => Promise<SimilarResponse>) | undefined; } | undefined; readonly import?: { readonly book?: ((input: ImportBookInput) => Promise<ImportBookResult>) | undefined; } | undefined; readonly notes?: { readonly addBookmark?: ((input: AddBookmarkInput) => Promise<MutationSuccessResponse>) | undefined; readonly best?: ((bookId: string, options?: BestNotesOptions | undefined) => Promise<BestBookmarksResponse>) | undefined; readonly bookmarks?: ((bookId: string, options?: SyncOptions | undefined) => Promise<BookmarkListResponse>) | undefined; readonly mine?: ((bookId: string, options?: MineNotesOptions | undefined) => Promise<MineReviewListResponse>) | undefined; readonly notebooks?: ((options?: NotebooksOptions | undefined) => Promise<NotebooksResponse>) | undefined; readonly readReviews?: ((bookId: string, chapterUid: number, reviews: ReadReviewQuery[], options?: RequestOptions | undefined) => Promise<ReadReviewsResponse>) | undefined; readonly recent?: ((options?: RecentNotesOptions | undefined) => Promise<RecentNotesResponse>) | undefined; readonly removeBookmark?: ((bookmarkId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly underlines?: ((bookId: string, chapterUid: number, options?: SyncOptions | undefined) => Promise<UnderlinesResponse>) | undefined; readonly updateBookmark?: ((input: UpdateBookmarkInput) => Promise<MutationSuccessResponse>) | undefined; } | undefined; readonly publicAccounts?: { readonly articles?: ((accountId: string, options?: PublicAccountArticlesOptions | undefined) => Promise<PublicAccountArticlesPage>) | undefined; readonly paidContent?: ((docUrl: string, options?: RequestOptions | undefined) => Promise<PaidArticleResponse>) | undefined; readonly resolveArticle?: ((docUrl: string, options?: RequestOptions | undefined) => Promise<PublicAccountArticleResolution>) | undefined; readonly subscribe?: ((accountId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly subscriptions?: ((options?: PublicAccountSubscriptionsOptions | undefined) => Promise<PublicAccountSubscriptionsPage>) | undefined; readonly unsubscribe?: ((accountId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; } | undefined; readonly readData?: { readonly detail?: ((options?: ReadDataOptions | undefined) => Promise<ReadDataResponse>) | undefined; } | undefined; readonly review?: { readonly add?: ((input: ReviewAddInput) => Promise<ReviewAddResponse>) | undefined; readonly delete?: ((reviewId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly edit?: ((reviewId: string, content: string, options?: RequestOptions | undefined) => Promise<ReviewEditResponse>) | undefined; readonly list?: ((bookId: string, options?: ReviewListOptions | undefined) => Promise<ReviewListResponse>) | undefined; readonly single?: ((reviewId: string, options?: ReviewSingleOptions | undefined) => Promise<ReviewSingleResponse>) | undefined; } | undefined; readonly search?: { readonly books?: ((keyword: string, options?: SearchOptions | undefined) => Promise<SearchResponse>) | undefined; readonly suggest?: ((keyword: string, options?: SearchSuggestOptions | undefined) => Promise<SearchSuggestResponse>) | undefined; } | undefined; readonly shelf?: { readonly add?: ((bookId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly delete?: ((bookId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly markFinished?: ((bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MarkFinishedResponse>) | undefined; readonly markReading?: ((bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MarkFinishedResponse>) | undefined; readonly pin?: ((bookId: string, top?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly setPrivate?: ((bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly sync?: ((options?: RequestOptions | undefined) => Promise<ShelfSyncResponse>) | undefined; } | undefined; }
// resolves to:
//   ai?: { readonly askBook?: ((input: AskBookInput) => Promise<AskBookResult>) | undefined; readonly suggest?: ((input: SuggestInput) => Promise<SuggestResponse>) | undefined; }
//   book?: { readonly chapters?: ((bookId: string, options?: RequestOptions | undefined) => Promise<ChapterInfoResponse>) | undefined; readonly detail?: ((bookId: string, options?: BookDetailOptions | undefined) => Promise<BookDetailResponse>) | undefined; readonly info?: ((bookId: string, options?: RequestOptions | undefined) => Promise<BookInfo>) | undefined; readonly progress?: ((bookId: string, options?: RequestOptions | undefined) => Promise<BookProgress>) | undefined; }
//   discover?: { readonly recommend?: ((options?: RecommendOptions | undefined) => Promise<RecommendResponse>) | undefined; readonly similar?: ((bookId: string, options?: SimilarOptions | undefined) => Promise<SimilarResponse>) | undefined; }
//   import?: { readonly book?: ((input: ImportBookInput) => Promise<ImportBookResult>) | undefined; }
//   notes?: { readonly addBookmark?: ((input: AddBookmarkInput) => Promise<MutationSuccessResponse>) | undefined; readonly best?: ((bookId: string, options?: BestNotesOptions | undefined) => Promise<BestBookmarksResponse>) | undefined; readonly bookmarks?: ((bookId: string, options?: SyncOptions | undefined) => Promise<BookmarkListResponse>) | undefined; readonly mine?: ((bookId: string, options?: MineNotesOptions | undefined) => Promise<MineReviewListResponse>) | undefined; readonly notebooks?: ((options?: NotebooksOptions | undefined) => Promise<NotebooksResponse>) | undefined; readonly readReviews?: ((bookId: string, chapterUid: number, reviews: ReadReviewQuery[], options?: RequestOptions | undefined) => Promise<ReadReviewsResponse>) | undefined; readonly recent?: ((options?: RecentNotesOptions | undefined) => Promise<RecentNotesResponse>) | undefined; readonly removeBookmark?: ((bookmarkId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly underlines?: ((bookId: string, chapterUid: number, options?: SyncOptions | undefined) => Promise<UnderlinesResponse>) | undefined; readonly updateBookmark?: ((input: UpdateBookmarkInput) => Promise<MutationSuccessResponse>) | undefined; }
//   publicAccounts?: { readonly articles?: ((accountId: string, options?: PublicAccountArticlesOptions | undefined) => Promise<PublicAccountArticlesPage>) | undefined; readonly paidContent?: ((docUrl: string, options?: RequestOptions | undefined) => Promise<PaidArticleResponse>) | undefined; readonly resolveArticle?: ((docUrl: string, options?: RequestOptions | undefined) => Promise<PublicAccountArticleResolution>) | undefined; readonly subscribe?: ((accountId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly subscriptions?: ((options?: PublicAccountSubscriptionsOptions | undefined) => Promise<PublicAccountSubscriptionsPage>) | undefined; readonly unsubscribe?: ((accountId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; }
//   readData?: { readonly detail?: ((options?: ReadDataOptions | undefined) => Promise<ReadDataResponse>) | undefined; }
//   review?: { readonly add?: ((input: ReviewAddInput) => Promise<ReviewAddResponse>) | undefined; readonly delete?: ((reviewId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly edit?: ((reviewId: string, content: string, options?: RequestOptions | undefined) => Promise<ReviewEditResponse>) | undefined; readonly list?: ((bookId: string, options?: ReviewListOptions | undefined) => Promise<ReviewListResponse>) | undefined; readonly single?: ((reviewId: string, options?: ReviewSingleOptions | undefined) => Promise<ReviewSingleResponse>) | undefined; }
//   search?: { readonly books?: ((keyword: string, options?: SearchOptions | undefined) => Promise<SearchResponse>) | undefined; readonly suggest?: ((keyword: string, options?: SearchSuggestOptions | undefined) => Promise<SearchSuggestResponse>) | undefined; }
//   shelf?: { readonly add?: ((bookId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly delete?: ((bookId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly markFinished?: ((bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MarkFinishedResponse>) | undefined; readonly markReading?: ((bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MarkFinishedResponse>) | undefined; readonly pin?: ((bookId: string, top?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly setPrivate?: ((bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>) | undefined; readonly sync?: ((options?: RequestOptions | undefined) => Promise<ShelfSyncResponse>) | undefined; }
```

### `CliStore` — dist/cli.d.ts

```ts
interface CliStore {
  readonly backend: string
  readonly client: CliOperationsClient
  readonly clientProfile?: string
  readonly name: string
  readonly readIdentity?: (() => CliStoreIdentity | Promise<CliStoreIdentity>)
}
```

### `CliStoreCommandContext` — dist/cli.d.ts

```ts
interface CliStoreCommandContext {
  confirm: (message: string) => Promise<boolean>
  getStore: () => CliStore
  isTTY: boolean
  signal?: AbortSignal
  stdout: OutputWriter
}
```

### `CliStoreIdentity` — dist/cli.d.ts

```ts
interface CliStoreIdentity {
  deviceId?: string
  source?: "environment" | "file"
  vid?: string
}
```

### `ClientIdentity` — dist/plugin.d.ts

```ts
interface ClientIdentity {
  deviceId?: string
  vid: string
}
```

### `ClientLoginContext` — dist/plugin.d.ts

```ts
interface ClientLoginContext {
  env: ProcessEnv
  fetchImpl: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }
  onOtp: () => string | Promise<string>
  onQr: (url: string, stage?: string | undefined) => void | Promise<void>
  onStatus: (status: string, stage?: string | undefined) => void | Promise<void>
  previousState?: JsonValue
  signal?: AbortSignal
}
```

### `ClientLoginOptions` — dist/api/mobile-client.d.ts

```ts
type ClientLoginOptions = Omit<LoginOptions, "profile"> & { onCredentials?: ((credentials: Credentials) => void | Promise<void>) | undefined; }
// resolves to:
//   deadlineMs?: number
//   deviceId?: string
//   fetchImpl?: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }
//   onCredentials?: ((credentials: Credentials) => void | Promise<void>)
//   onQr?: ((confirmUrl: string) => void | Promise<void>)
//   onStatus?: ((status: LoginStatus) => void | Promise<void>)
//   pollDelayMs?: number
//   pollTimeoutMs?: number
//   signal?: AbortSignal
//   timeoutMs?: number
```

### `ClientLoginResult` — dist/plugin.d.ts

```ts
interface ClientLoginResult {
  identity: ClientIdentity
  state: JsonValue
}
```

### `ClientOpenContext` — dist/plugin.d.ts

```ts
interface ClientOpenContext {
  env: ProcessEnv
  fetchImpl: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }
  saveState: (state: JsonValue) => Promise<void>
  state: JsonValue
}
```

### `ClientOpenResult` — dist/plugin.d.ts

```ts
interface ClientOpenResult {
  client: PluginCanonicalClient
  identity: ClientIdentity
}
```

### `ClientPlugin` — dist/plugin.d.ts

```ts
interface ClientPlugin {
  clients: Readonly<Record<string, ClientProvider>>
  meta: { name: string; version: string; apiVersion: 1; }
}
```

### `ClientProfile` — dist/profile.d.ts

```ts
interface ClientProfile {
  authHeaders: (token: { vid: string; accessToken: string; }) => Record<string, string>
  readonly deviceName: string
  readonly deviceType: number
  loginBodyExtras: () => Record<string, unknown>
  newDeviceId: () => string
  newInstallId: () => string
  refreshSignature: (deviceId: string, timestamp: number, random: number, refreshToken: string) => string
  readonly versionHeaders: Record<string, string>
}
```

### `ClientProvider` — dist/plugin.d.ts

```ts
interface ClientProvider {
  login: (context: ClientLoginContext) => Promise<ClientLoginResult>
  open: (context: ClientOpenContext) => Promise<ClientOpenResult>
}
```

### `ClientSummary` — dist/accounts.d.ts

```ts
interface ClientSummary {
  apiVersion: number
  client: string
  plugin: string
  version: string
}
```

### `CommandContext` — dist/cli/commands.d.ts

```ts
interface CommandContext<TClient extends CliOperationsClient> {
  confirm: (message: string) => Promise<boolean>
  getClient: () => TClient
  isTTY: boolean
  signal?: AbortSignal
  stdout: OutputWriter
}
```

### `ContentLibrary` — dist/library/store.d.ts

```ts
class ContentLibrary {
  new (): ContentLibrary
  static static open: (options: ContentLibraryOptions) => Promise<ContentLibrary>
  #private
  close: () => void
  getArticle: (reviewId: string) => Promise<StoredArticle | undefined>
  getBookInfo: (bookId: string) => BookInfo | undefined
  getChapterContent: (bookId: string, chapterUid: number) => Promise<ChapterContent | undefined>
  getChapterIndex: (bookId: string, backend: TocBackend) => ChapterInfoResponse | undefined
  has: (bookId: string, chapterUid: number) => boolean
  missing: (bookId: string, chapterUids: readonly number[]) => number[]
  putArticle: (input: PutArticleInput) => Promise<void>
  putBookInfo: (bookId: string, info: BookInfo, origin?: string | undefined) => void
  putChapterContent: (content: ChapterContent, meta?: ChapterMetadata | undefined) => Promise<void>
  putChapterIndex: (response: ChapterInfoResponse, backend: TocBackend) => void
  readonly root: string
  stats: () => LibraryStats
  verify: () => Promise<{ ok: boolean; problems: string[]; }>
}
```

### `ContentLibraryOptions` — dist/library/store.d.ts

```ts
interface ContentLibraryOptions {
  env?: ProcessEnv
  logger?: Partial<Record<"debug" | "error" | "info" | "warn", (message: string) => void>>
  root?: string
  vid: string
}
```

### `CosCredentials` — dist/api/types.d.ts

```ts
interface CosCredentials {
  TmpSecretId: string
  TmpSecretKey: string
  Token: string
}
```

### `CosUploadInput` — dist/api/types.d.ts

```ts
interface CosUploadInput {
  bucket: string
  bytes: Uint8Array<ArrayBufferLike>
  credentials: CosCredentials
  expiredTime: number
  key: string
  signal?: AbortSignal
}
```

### `CosUploader` — dist/api/types.d.ts

```ts
type CosUploader = (input: CosUploadInput) => Promise<void>
```

### `Credentials` — dist/auth/credentials.d.ts

```ts
interface Credentials {
  accessToken?: string
  deviceId: string
  refreshToken: string
  vid: string
}
```

### `EinkClientOptions` — dist/api/mobile-client.d.ts

```ts
type EinkClientOptions = { credentials?: Credentials | undefined; env?: ProcessEnv | undefined; store?: string | undefined; fetchImpl?: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; } | undefined; mobileBaseUrl?: string | undefined; mobileTimeoutMs?: number | undefined; logger?: Partial<Record<"debug" | "error" | "info" | "warn", (message: string) => void>> | undefined; onCredentials?: ((credentials: Credentials) => void | Promise<void>) | undefined; resources?: MobileResourceDependencies | undefined; }
// resolves to:
//   credentials?: Credentials
//   env?: ProcessEnv
//   fetchImpl?: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }
//   logger?: Partial<Record<"debug" | "error" | "info" | "warn", (message: string) => void>>
//   mobileBaseUrl?: string
//   mobileTimeoutMs?: number
//   onCredentials?: ((credentials: Credentials) => void | Promise<void>)
//   resources?: MobileResourceDependencies
//   store?: string
```

### `ExtendProgram` — dist/cli.d.ts

```ts
type ExtendProgram<TClient extends CliOperationsClient> = (program: Command, context: CommandContext<TClient>) => void
```

### `ExtendStoreProgram` — dist/cli.d.ts

```ts
type ExtendStoreProgram = (program: Command, context: CliStoreCommandContext) => void
```

### `ImportBookInput` — dist/api/types.d.ts

```ts
type ImportBookInput = RequestOptions & ({ name: string; bytes: Uint8Array<ArrayBufferLike>; path?: undefined; } | { name: string; path: string; bytes?: undefined; })
// resolves to:
//   bytes?: Uint8Array<ArrayBufferLike>
//   name: string
//   path?: string
//   signal?: AbortSignal
```

### `ImportBookResult` — dist/api/types.d.ts

```ts
interface ImportBookResult {
  bookId: string
  deepLink: string
}
```

### `ImportFailurePhase` — dist/api/resources/import.d.ts

```ts
type ImportFailurePhase = "post-notify" | "pre-notify"
// resolves to:
//   readonly [key: number]: string
```

### `ImportPhaseError` — dist/api/resources/import.d.ts

```ts
class ImportPhaseError extends WeReadError {
  new (message: string, info: { phase: ImportFailurePhase; ambiguous: boolean; digest?: string | undefined; cause?: unknown; }): ImportPhaseError
  readonly ambiguous: boolean
  readonly digest?: string
  readonly phase: ImportFailurePhase
}
```

### `JsonValue` — dist/plugin.d.ts

```ts
type JsonValue = string | number | boolean | JsonValue[] | { [key: string]: JsonValue; } | null
```

### `LibraryClientOptions` — dist/library/cached-client.d.ts

```ts
interface LibraryClientOptions {
  library: ContentLibrary
  logger?: Partial<Record<"debug" | "error" | "info" | "warn", (message: string) => void>>
  mode?: LibraryMode
}
```

### `LibraryError` — dist/library/errors.d.ts

```ts
class LibraryError extends WeReadError {
  new (message: string, options?: { cause?: unknown; }): LibraryError
}
```

### `LibraryMode` — dist/library/cached-client.d.ts

```ts
type LibraryMode = "off" | "prefer" | "refresh"
// resolves to:
//   readonly [key: number]: string
```

### `LibraryStats` — dist/library/store.d.ts

```ts
interface LibraryStats {
  articles: number
  blobBytes: number
  blobs: number
  books: number
  chapterIndexes: number
  chapters: number
  supersededVersions: number
}
```

### `LibraryStoreError` — dist/library/errors.d.ts

```ts
class LibraryStoreError extends LibraryError {
  new (message: string, options?: { cause?: unknown; }): LibraryStoreError
}
```

### `LibraryUnsupportedError` — dist/library/errors.d.ts

```ts
class LibraryUnsupportedError extends LibraryError {
  new (message: string, options?: { cause?: unknown; }): LibraryUnsupportedError
}
```

### `LibraryVersionError` — dist/library/errors.d.ts

```ts
class LibraryVersionError extends LibraryError {
  new (message: string, info: { found: number; supported: number; cause?: unknown; }): LibraryVersionError
  readonly found: number
  readonly supported: number
}
```

### `LoadCredentialsOptions` — dist/auth/credentials.d.ts

```ts
interface LoadCredentialsOptions {
  credentials?: Partial<Credentials>
  env?: ProcessEnv
  store?: string
}
```

### `Logger` — dist/logger.d.ts

```ts
type Logger = { debug?: ((message: string) => void) | undefined; error?: ((message: string) => void) | undefined; info?: ((message: string) => void) | undefined; warn?: ((message: string) => void) | undefined; }
// resolves to:
//   debug?: ((message: string) => void)
//   error?: ((message: string) => void)
//   info?: ((message: string) => void)
//   warn?: ((message: string) => void)
```

### `LoginOptions` — dist/auth/qrlogin.d.ts

```ts
interface LoginOptions extends PollOptions {
  deadlineMs?: number
  deviceId?: string
  fetchImpl?: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }
  onQr?: ((confirmUrl: string) => void | Promise<void>)
  onStatus?: ((status: LoginStatus) => void | Promise<void>)
  pollDelayMs?: number
  pollTimeoutMs?: number
  profile?: ClientProfile
  signal?: AbortSignal
  timeoutMs?: number
}
```

### `LoginStatus` — dist/auth/qrlogin.d.ts

```ts
type LoginStatus = "confirmed" | "scanned"
// resolves to:
//   readonly [key: number]: string
```

### `MarkFinishedResponse` — dist/api/types.d.ts

```ts
interface MarkFinishedResponse {
  finishReading?: number
}
```

### `MineNotesOptions` — dist/api/types.d.ts

```ts
interface MineNotesOptions extends SyncOptions {
  count?: number
  signal?: AbortSignal
  synckey?: number
}
```

### `MineReviewItem` — dist/api/types.d.ts

```ts
interface MineReviewItem extends ReviewDetail {
  abstract?: string
  author?: ReviewAuthor
  book?: BookInfo
  bookId?: string
  chapterIdx?: number
  chapterName?: string
  chapterUid?: number
  content?: string
  createTime?: number
  flag?: number
  friendship?: number
  htmlContent?: string
  isDeepV?: number
  isFinish?: number
  isLike?: number
  isPrivate?: number
  isReposted?: number
  mpInfo?: ArticleMpInfo
  range?: string
  reviewId?: string
  star?: number
  title?: string
  type?: number
  userVid?: string | number
}
```

### `MineReviewListResponse` — dist/api/types.d.ts

```ts
interface MineReviewListResponse extends SyncCursor {
  hasMore?: number
  reviews: { review?: MineReviewItem | undefined; }[]
  synckey?: number
  totalCount?: number
}
```

### `MintAccessTokenOptions` — dist/auth/token.d.ts

```ts
interface MintAccessTokenOptions {
  baseUrl?: string
  profile?: ClientProfile
  signal?: AbortSignal
  timeoutMs?: number
}
```

### `MobileApiClient` — dist/api/mobile-client.d.ts

```ts
class MobileApiClient {
  new (options?: MobileApiClientOptions): MobileApiClient
  #private
  readonly ai: { askBook(input: AskBookInput): Promise<AskBookResult>; suggest(input: SuggestInput): Promise<SuggestResponse>; }
  readonly book: { info: (bookId: string, options?: RequestOptions | undefined) => Promise<BookInfo>; detail: (bookId: string, options?: BookDetailOptions | undefined) => Promise<BookDetailResponse>; chapters: (bookId: string, options?: RequestOptions | undefined) => Promise<ChapterInfoResponse>; progress: (bookId: string, options?: RequestOptions | undefined) => Promise<BookProgress>; }
  readonly discover: { recommend(options?: RecommendOptions | undefined): Promise<RecommendResponse>; similar(bookId: string, options?: SimilarOptions | undefined): Promise<SimilarResponse>; }
  readonly import: { book(input: ImportBookInput): Promise<ImportBookResult>; }
  login: (options?: ClientLoginOptions | undefined) => Promise<Credentials>
  get mobile: MobileClient
  readonly notes: { notebooks(options?: NotebooksOptions | undefined): Promise<NotebooksResponse>; recent(options?: RecentNotesOptions | undefined): Promise<RecentNotesResponse>; bookmarks(bookId: string, options?: SyncOptions | undefined): Promise<BookmarkListResponse>; mine(bookId: string, options?: MineNotesOptions | undefined): Promise<MineReviewListResponse>; best(bookId: string, options?: BestNotesOptions | undefined): Promise<BestBookmarksResponse>; readReviews(bookId: string, chapterUid: number, reviews: ReadReviewQuery[], options?: RequestOptions | undefined): Promise<ReadReviewsResponse>; underlines(bookId: string, chapterUid: number, options?: SyncOptions | undefined): Promise<UnderlinesResponse>; addBookmark(input: AddBookmarkInput): Promise<MutationSuccessResponse>; updateBookmark(input: UpdateBookmarkInput): Promise<MutationSuccessResponse>; removeBookmark(bookmarkId: string, options?: RequestOptions | undefined): Promise<MutationSuccessResponse>; }
  readonly publicAccounts: { subscriptions(options?: PublicAccountSubscriptionsOptions | undefined): Promise<PublicAccountSubscriptionsPage>; articles(accountId: string, options?: PublicAccountArticlesOptions | undefined): Promise<PublicAccountArticlesPage>; resolveArticle(docUrl: string, options?: RequestOptions | undefined): Promise<PublicAccountArticleResolution>; paidContent(docUrl: string, options?: RequestOptions | undefined): Promise<PaidArticleResponse>; subscribe(accountId: string, options?: RequestOptions | undefined): Promise<MutationSuccessResponse>; unsubscribe(accountId: string, options?: RequestOptions | undefined): Promise<MutationSuccessResponse>; }
  readonly readData: { detail(options?: ReadDataOptions | undefined): Promise<ReadDataResponse>; }
  reloadCredentials: () => void
  readonly review: { list(bookId: string, options?: ReviewListOptions | undefined): Promise<ReviewListResponse>; single(reviewId: string, options?: ReviewSingleOptions | undefined): Promise<ReviewSingleResponse>; add(input: ReviewAddInput): Promise<ReviewAddResponse>; edit(reviewId: string, content: string, options?: RequestOptions | undefined): Promise<ReviewEditResponse>; delete: (reviewId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; }
  readonly search: { books(keyword: string, options?: SearchOptions | undefined): Promise<SearchResponse>; suggest(keyword: string, options?: SearchSuggestOptions | undefined): Promise<SearchSuggestResponse>; }
  readonly shelf: { sync: (options?: RequestOptions | undefined) => Promise<ShelfSyncResponse>; add: (bookId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; delete: (bookId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; pin: (bookId: string, top?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; setPrivate: (bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; markFinished: (bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MarkFinishedResponse>; markReading: (bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MarkFinishedResponse>; }
}
```

### `MobileApiClientOptions` — dist/api/mobile-client.d.ts

```ts
interface MobileApiClientOptions {
  credentials?: Credentials
  env?: ProcessEnv
  fetchImpl?: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }
  logger?: Partial<Record<"debug" | "error" | "info" | "warn", (message: string) => void>>
  mobileBaseUrl?: string
  mobileTimeoutMs?: number
  onCredentials?: ((credentials: Credentials) => void | Promise<void>)
  profile?: ClientProfile
  resources?: MobileResourceDependencies
  store?: string
}
```

### `MobileCallOptions` — dist/api/mobile.d.ts

```ts
interface MobileCallOptions {
  body?: unknown
  idempotent?: boolean
  query?: Record<string, QueryValue>
  signal?: AbortSignal
}
```

### `MobileClient` — dist/api/mobile.d.ts

```ts
class MobileClient {
  new (options: MobileClientOptions): MobileClient
  call: <T = unknown>(method: string, path: string, options?: MobileCallOptions | undefined) => Promise<MobileResponse<T>>
  callRaw: (method: string, path: string, options?: RawMobileCallOptions | undefined) => Promise<MobileResponse<Uint8Array<ArrayBufferLike>>>
  vid: (signal?: AbortSignal | undefined) => Promise<string>
  // nominal: not assignable from a structurally identical object
}
```

### `MobileClientOptions` — dist/api/mobile.d.ts

```ts
interface MobileClientOptions {
  baseUrl?: string
  fetchImpl?: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }
  logger?: Partial<Record<"debug" | "error" | "info" | "warn", (message: string) => void>>
  profile?: ClientProfile
  timeoutMs?: number
  tokenManager: TokenProvider
}
```

### `MobileDevice` — dist/device-ua.d.ts

```ts
interface MobileDevice {
  appver: string
  baseapi: string
  channelId: string
  deviceName: string
  osver: string
  userAgent: string
  wrbrand: string
}
```

### `MobileResourceDependencies` — dist/api/resources/index.d.ts

```ts
interface MobileResourceDependencies {
  cosUpload?: CosUploader
  env?: ProcessEnv
  sleep?: ((milliseconds: number, signal?: AbortSignal | undefined) => Promise<void>)
}
```

### `MobileResponse` — dist/api/mobile.d.ts

```ts
interface MobileResponse<T> {
  body: T
  headers: Headers
  status: number
}
```

### `MutationSuccessResponse` — dist/api/types.d.ts

```ts
interface MutationSuccessResponse {
  succ?: number
}
```

### `NotebookBook` — dist/api/types.d.ts

```ts
interface NotebookBook {
  book?: { bookId?: string | undefined; title?: string | undefined; author?: string | undefined; cover?: string | undefined; }
  bookId?: string
  bookmarkCount?: number
  markedStatus?: number
  noteCount?: number
  readingProgress?: number
  reviewCount?: number
  sort?: number
}
```

### `NotebooksOptions` — dist/api/types.d.ts

```ts
interface NotebooksOptions extends RequestOptions {
  count?: number
  lastSort?: number
  signal?: AbortSignal
}
```

### `NotebooksResponse` — dist/api/types.d.ts

```ts
interface NotebooksResponse {
  books: NotebookBook[]
  hasMore?: number
  totalBookCount?: number
  totalNoteCount?: number
}
```

### `OpenAccount` — dist/accounts.d.ts

```ts
interface OpenAccount extends AccountSummary {
  account: string
  canonical: CanonicalClient
  client: string
  identity: ClientIdentity
}
```

### `OutputOptions` — dist/cli/output.d.ts

```ts
interface OutputOptions {
  json: boolean
  stdout: OutputWriter
}
```

### `OutputWriter` — dist/cli/output.d.ts

```ts
interface OutputWriter {
  write: (chunk: string) => unknown
}
```

### `PUBLIC_OPERATIONS` — dist/api/operations.d.ts

```ts
const PUBLIC_OPERATIONS: { readonly search: readonly ["books", "suggest"]; readonly book: readonly ["info", "detail", "chapters", "progress"]; readonly shelf: readonly ["sync", "add", "delete", "pin", "setPrivate", "markFinished", "markReading"]; readonly publicAccounts: readonly ["subscriptions", "articles", "resolveArticle", "paidContent", "subscribe", "unsubscribe"]; readonly notes: readonly ["notebooks", "recent", "bookmarks", "mine", "best", "readReviews", "underlines", "addBookmark", "updateBookmark", "removeBookmark"]; readonly review: readonly ["list", "single", "add", "edit", "delete"]; readonly readData: readonly ["detail"]; readonly discover: readonly ["recommend", "similar"]; readonly ai: readonly ["askBook", "suggest"]; readonly import: readonly ["book"]; }
// resolves to:
//   readonly ai: readonly ["askBook", "suggest"]
//   readonly book: readonly ["info", "detail", "chapters", "progress"]
//   readonly discover: readonly ["recommend", "similar"]
//   readonly import: readonly ["book"]
//   readonly notes: readonly ["notebooks", "recent", "bookmarks", "mine", "best", "readReviews", "underlines", "addBookmark", "updateBookmark", "removeBookmark"]
//   readonly publicAccounts: readonly ["subscriptions", "articles", "resolveArticle", "paidContent", "subscribe", "unsubscribe"]
//   readonly readData: readonly ["detail"]
//   readonly review: readonly ["list", "single", "add", "edit", "delete"]
//   readonly search: readonly ["books", "suggest"]
//   readonly shelf: readonly ["sync", "add", "delete", "pin", "setPrivate", "markFinished", "markReading"]
```

### `PaidArticleEntry` — dist/api/types.d.ts

```ts
interface PaidArticleEntry {
  content?: string
  fee?: number
  ispaid?: boolean
  url?: string
}
```

### `PaidArticleResponse` — dist/api/types.d.ts

```ts
interface PaidArticleResponse {
  entries: PaidArticleEntry[]
}
```

### `PollOptions` — dist/auth/qrlogin.d.ts

```ts
interface PollOptions extends AuthRequestOptions {
  deadlineMs?: number
  onStatus?: ((status: LoginStatus) => void | Promise<void>)
  pollDelayMs?: number
  pollTimeoutMs?: number
  profile?: ClientProfile
  signal?: AbortSignal
  timeoutMs?: number
}
```

### `PreferAuthorItem` — dist/api/types.d.ts

```ts
interface PreferAuthorItem {
  authorId?: string
  count?: number
  name?: string
  readTime?: string
  user?: UserSummary
}
```

### `PreferCategoryItem` — dist/api/types.d.ts

```ts
interface PreferCategoryItem {
  categoryId?: number
  categoryTitle?: string
  categoryType?: number
  parentCategoryId?: number
  parentCategoryTitle?: string
  readingCount?: number
  readingTime?: number
  val?: number
}
```

### `PreferCopyrightItem` — dist/api/types.d.ts

```ts
interface PreferCopyrightItem {
  copyrightInfo?: (UserSummary & { role?: number | undefined; })
  count?: number
}
```

### `PreferPublisherItem` — dist/api/types.d.ts

```ts
interface PreferPublisherItem {
  count?: number
  name?: string
}
```

### `PublicAccount` — dist/api/types.d.ts

```ts
interface PublicAccount extends ShelfBook {
  accountId: string
  author?: string
  bookId?: string
  category?: string
  cover?: string
  deepLink?: string
  finishReading?: number
  isTop?: number
  readUpdateTime?: number
  secret?: number
  title?: string
  updateTime?: number
}
```

### `PublicAccountArchiveItem` — dist/api/types.d.ts

```ts
interface PublicAccountArchiveItem {
  accountId: string
  article?: "article.md"
  directory: string
  metadata: "metadata.json"
  mpInfo?: "mp-info.json"
  reviewId: string
  source?: "fallback.html" | "source.html"
  sourceByteLength?: number
  sourceSha256?: string
  sourceUrl?: string
  state: PublicAccountArticleState
}
```

### `PublicAccountArchiveManifest` — dist/api/types.d.ts

```ts
interface PublicAccountArchiveManifest {
  accountId: string
  completeCount: number
  createdAt: string
  cursors: PublicAccountCursor[]
  diagnostics: PublicAccountDiagnostic[]
  itemCount: number
  items: PublicAccountArchiveItem[]
  partialCount: number
  unsupportedCount: number
  version: 1
}
```

### `PublicAccountArchiveOptions` — dist/api/types.d.ts

```ts
interface PublicAccountArchiveOptions extends RequestOptions {
  directory: string
  library?: PublicAccountLibrary
  libraryMode?: PublicAccountLibraryMode
  limit?: number
  signal?: AbortSignal
}
```

### `PublicAccountArchiveResult` — dist/api/types.d.ts

```ts
interface PublicAccountArchiveResult {
  manifest: PublicAccountArchiveManifest
  path: string
}
```

### `PublicAccountArticle` — dist/api/types.d.ts

```ts
interface PublicAccountArticle {
  createTime?: number
  mpInfo?: ArticleMpInfo
  reviewId?: string
  title?: string
}
```

### `PublicAccountArticleResolution` — dist/api/types.d.ts

```ts
interface PublicAccountArticleResolution {
  reviewId: string
  url: string
}
```

### `PublicAccountArticleState` — dist/api/types.d.ts

```ts
type PublicAccountArticleState = "complete" | "partial" | "unsupported"
// resolves to:
//   readonly [key: number]: string
```

### `PublicAccountArticlesOptions` — dist/api/types.d.ts

```ts
interface PublicAccountArticlesOptions extends RequestOptions {
  count?: number
  offset?: number
  signal?: AbortSignal
  synckey?: number
}
```

### `PublicAccountArticlesPage` — dist/api/types.d.ts

```ts
interface PublicAccountArticlesPage {
  accountId: string
  articles: PublicAccountArticle[]
  hasMore?: 0 | 1
  nextOffset?: number
  requestedOffset: number
  returnedCount: number
  synckey?: number
}
```

### `PublicAccountArtifactError` — dist/public-accounts.d.ts

```ts
class PublicAccountArtifactError extends WeReadError {
  new (message: string, info: { code: PublicAccountArtifactErrorCode; path: string; incomplete?: boolean | undefined; cause?: unknown; }): PublicAccountArtifactError
  readonly ambiguous: boolean
  readonly authenticationHint?: string
  readonly code: PublicAccountArtifactErrorCode
  readonly errCode?: number
  readonly incomplete: boolean
  readonly incompletePath?: string
  readonly path: string
  readonly status?: number
  readonly upstreamPath?: string
}
```

### `PublicAccountArtifactErrorCode` — dist/api/types.d.ts

```ts
type PublicAccountArtifactErrorCode = "ARTIFACT_EXISTS" | "ARTIFACT_INCOMPLETE" | "ARTIFACT_PUBLISH_FAILED"
// resolves to:
//   readonly [key: number]: string
```

### `PublicAccountCursor` — dist/api/types.d.ts

```ts
interface PublicAccountCursor {
  accountId: string
  nextOffset?: number
  requestedOffset: number
  terminal: PublicAccountCursorTerminal
}
```

### `PublicAccountCursorTerminal` — dist/api/types.d.ts

```ts
type PublicAccountCursorTerminal = "duplicate_only" | "empty" | "explicit" | "limit" | "missing_cursor" | "repeated_cursor"
// resolves to:
//   readonly [key: number]: string
```

### `PublicAccountDiagnostic` — dist/api/types.d.ts

```ts
interface PublicAccountDiagnostic {
  accountId: string
  ambiguous?: boolean
  code: PublicAccountDiagnosticCode
  errCode?: number
  message: string
  path?: string
  reviewId?: string
  sourceUrl?: string
  status?: number
}
```

### `PublicAccountDiagnosticCode` — dist/api/types.d.ts

```ts
type PublicAccountDiagnosticCode = "ARTICLE_ID_MISSING" | "ARTICLE_UNAVAILABLE" | "SOURCE_CLOUDFLARE_CHALLENGE" | "SOURCE_CONTENT_INSUFFICIENT" | "SOURCE_FALLBACK_USED" | "SOURCE_FETCH_FAILED" | "SOURCE_HTTP_ERROR" | "SOURCE_PAYWALL_PREVIEW" | "SOURCE_REDIRECT_INVALID" | "SOURCE_REDIRECT_LIMIT" | "SOURCE_TIMEOUT" | "SOURCE_TOO_LARGE" | "SOURCE_URL_INVALID" | "SOURCE_WECHAT_CHALLENGE"
// resolves to:
//   readonly [key: number]: string
```

### `PublicAccountFeedFormat` — dist/api/types.d.ts

```ts
type PublicAccountFeedFormat = "atom" | "json" | "rss"
// resolves to:
//   readonly [key: number]: string
```

### `PublicAccountFeedOptions` — dist/api/types.d.ts

```ts
interface PublicAccountFeedOptions extends RequestOptions {
  format: PublicAccountFeedFormat
  library?: PublicAccountLibrary
  libraryMode?: PublicAccountLibraryMode
  limit?: number
  signal?: AbortSignal
}
```

### `PublicAccountFeedResult` — dist/api/types.d.ts

```ts
interface PublicAccountFeedResult {
  content: string
  cursors: PublicAccountCursor[]
  diagnostics: PublicAccountDiagnostic[]
  format: PublicAccountFeedFormat
  itemCount: number
}
```

### `PublicAccountFeedSource` — dist/api/types.d.ts

```ts
type PublicAccountFeedSource = { kind: "account"; accountId: string; } | { kind: "subscriptions"; }
// resolves to:
//   kind: "account" | "subscriptions"
```

### `PublicAccountLibrary` — dist/api/types.d.ts

```ts
interface PublicAccountLibrary {
  getArticle: (reviewId: string) => Promise<StoredArticle | undefined>
  putArticle: (input: PutArticleInput) => Promise<void>
}
```

### `PublicAccountLibraryMode` — dist/api/types.d.ts

```ts
type PublicAccountLibraryMode = "prefer" | "refresh"
// resolves to:
//   readonly [key: number]: string
```

### `PublicAccountReadError` — dist/public-accounts.d.ts

```ts
class PublicAccountReadError extends WeReadError {
  new (result: PublicAccountReadResult): PublicAccountReadError
  readonly result: PublicAccountReadResult
}
```

### `PublicAccountReadOptions` — dist/public-accounts.d.ts

```ts
interface PublicAccountReadOptions {
  library?: PublicAccountLibrary
  libraryMode?: PublicAccountLibraryMode
  signal?: AbortSignal
}
```

### `PublicAccountReadResult` — dist/public-accounts.d.ts

```ts
interface PublicAccountReadResult {
  accountName: string | null
  cachedAt: string | null
  completeness: "partial" | "unavailable" | "unverified"
  contentHtml: string | null
  diagnostics: PublicAccountDiagnostic[]
  fetchedAt: string | null
  fromCache: boolean
  markdown: string | null
  publishedAt: string | null
  readAt: string
  reviewId: string
  sourceSha256: string | null
  sourceUrl: string
  status: "partial" | "readable" | "unavailable"
  title: string | null
}
```

### `PublicAccountSubscriptionsOptions` — dist/api/types.d.ts

```ts
interface PublicAccountSubscriptionsOptions extends RequestOptions {
  count?: number
  offset?: number
  signal?: AbortSignal
}
```

### `PublicAccountSubscriptionsPage` — dist/api/types.d.ts

```ts
interface PublicAccountSubscriptionsPage {
  accounts: PublicAccount[]
  nextOffset?: number
  requestedOffset: number
  returnedCount: number
  totalCount: number
}
```

### `PutArticleInput` — dist/api/types.d.ts

```ts
type PutArticleInput = { reviewId: string; state: StorableArticleState; review: ReviewSingleResponse; accountId?: string | undefined; title?: string | undefined; publicationTime?: number | undefined; sourceUrl?: string | undefined; mpInfo?: ArticleMpInfo | undefined; sourceBytes?: Uint8Array<ArrayBufferLike> | undefined; sourceByteLength?: number | undefined; markdown?: string | undefined; contentHtml?: string | undefined; fallbackHtml?: string | undefined; diagnostics?: PublicAccountDiagnostic[] | undefined; }
// resolves to:
//   accountId?: string
//   contentHtml?: string
//   diagnostics?: PublicAccountDiagnostic[]
//   fallbackHtml?: string
//   markdown?: string
//   mpInfo?: ArticleMpInfo
//   publicationTime?: number
//   review: ReviewSingleResponse
//   reviewId: string
//   sourceByteLength?: number
//   sourceBytes?: Uint8Array<ArrayBufferLike>
//   sourceUrl?: string
//   state: StorableArticleState
//   title?: string
```

### `QrRequest` — dist/auth/qrlogin.d.ts

```ts
interface QrRequest {
  confirmUrl: string
  uuid: string
}
```

### `QueryValue` — dist/api/mobile.d.ts

```ts
type QueryValue = string | number | boolean | undefined
```

### `RawMobileCallOptions` — dist/api/mobile.d.ts

```ts
interface RawMobileCallOptions extends MobileCallOptions {
  body?: unknown
  idempotent?: boolean
  maxResponseBytes?: number
  query?: Record<string, QueryValue>
  signal?: AbortSignal
}
```

### `ReadDataOptions` — dist/api/types.d.ts

```ts
interface ReadDataOptions extends RequestOptions {
  baseTime?: number
  mode?: "annually" | "monthly" | "overall" | "weekly"
  signal?: AbortSignal
}
```

### `ReadDataResponse` — dist/api/types.d.ts

```ts
interface ReadDataResponse {
  authorCount?: number
  baseTime?: number
  compare?: number
  dailyReadTimes?: Record<string, number>
  dayAverageReadTime?: number
  medals?: Record<string, unknown>[]
  preferAuthor?: PreferAuthorItem[]
  preferBooks?: Record<string, unknown>[]
  preferCategory?: PreferCategoryItem[]
  preferCategoryWord?: string
  preferCp?: PreferCopyrightItem[]
  preferPublisher?: PreferPublisherItem[]
  preferTime?: number[]
  preferTimeWord?: string
  rank?: { text?: string | undefined; scheme?: string | undefined; }
  readDays?: number
  readDistributionWord?: string
  readLongest?: ReadLongestItem[]
  readRate?: number
  readRecordsWord?: string
  readStat?: ReadStatItem[]
  readTimeGears?: number[]
  readTimes?: Record<string, number>
  recordReadingTime?: number
  registTime?: number
  styleType?: string
  totalReadTime?: number
  wrListenTime?: number
  wrReadTime?: number
  yearReport?: YearReportItem[]
}
```

### `ReadLongestItem` — dist/api/types.d.ts

```ts
interface ReadLongestItem {
  albumInfo?: { albumId?: string | undefined; name?: string | undefined; authorName?: string | undefined; cover?: string | undefined; trackCount?: number | undefined; finishStatus?: string | undefined; finish?: number | undefined; payType?: number | undefined; intro?: string | undefined; updateTime?: number | undefined; }
  book?: BookInfo
  readTime?: number
  recordReadingTime?: number
  tags?: string[]
}
```

### `ReadReviewPageItem` — dist/api/types.d.ts

```ts
interface ReadReviewPageItem {
  likesCount?: number
  review?: ReviewDetail
  reviewId?: string
}
```

### `ReadReviewQuery` — dist/api/types.d.ts

```ts
interface ReadReviewQuery {
  count?: number
  maxIdx?: number
  range: string
  synckey?: number
}
```

### `ReadReviewRange` — dist/api/types.d.ts

```ts
interface ReadReviewRange extends SyncCursor {
  bookMarkCount?: number
  hasMore?: number
  maxIdx?: number
  pageReviews?: ReadReviewPageItem[]
  range?: string
  synckey?: number
  totalCount?: number
}
```

### `ReadReviewsResponse` — dist/api/types.d.ts

```ts
interface ReadReviewsResponse {
  bookId?: string
  chapterUid?: number
  reviews: ReadReviewRange[]
  vid?: string | number
}
```

### `ReadStatItem` — dist/api/types.d.ts

```ts
interface ReadStatItem {
  counts?: string
  scheme?: string
  stat?: string
}
```

### `RecentNoteItem` — dist/api/types.d.ts

```ts
interface RecentNoteItem {
  bookmark?: Bookmark
  review?: ReviewDetail
  type?: number
}
```

### `RecentNotesOptions` — dist/api/types.d.ts

```ts
interface RecentNotesOptions extends RequestOptions {
  count?: number
  signal?: AbortSignal
}
```

### `RecentNotesResponse` — dist/api/types.d.ts

```ts
interface RecentNotesResponse {
  books: BookInfo[]
  items: RecentNoteItem[]
}
```

### `RecommendBook` — dist/api/types.d.ts

```ts
interface RecommendBook extends BookInfo {
  author?: string
  bookId?: string
  bookStatus?: number
  category?: string
  cover?: string
  deepLink?: string
  finished?: number
  format?: string
  intro?: string
  isbn?: string
  newRating?: number
  newRatingCount?: number
  newRatingDetail?: { title?: string | undefined; }
  payType?: number
  price?: number
  publishTime?: string
  publisher?: string
  readingCount?: number
  reason?: string
  searchIdx?: number
  soldout?: number
  title?: string
  translator?: string
  type?: number
  wordCount?: number
}
```

### `RecommendOptions` — dist/api/types.d.ts

```ts
interface RecommendOptions extends RequestOptions {
  count?: number
  maxIdx?: number
  signal?: AbortSignal
}
```

### `RecommendResponse` — dist/api/types.d.ts

```ts
interface RecommendResponse {
  books: RecommendBook[]
}
```

### `RegisteredClient` — dist/plugin.d.ts

```ts
interface RegisteredClient {
  id: string
  plugin: { name: string; version: string; apiVersion: 1; }
  provider: ClientProvider
}
```

### `RequestOptions` — dist/api/types.d.ts

```ts
interface RequestOptions {
  signal?: AbortSignal
}
```

### `ReviewAddInput` — dist/api/types.d.ts

```ts
interface ReviewAddInput extends RequestOptions {
  abstract?: string
  bookId: string
  chapterUid?: number
  content: string
  range?: string
  signal?: AbortSignal
  star?: StarRating
  type?: number
}
```

### `ReviewAddResponse` — dist/api/types.d.ts

```ts
interface ReviewAddResponse {
  createTime?: number
  reviewId?: string
}
```

### `ReviewAuthor` — dist/api/types.d.ts

```ts
interface ReviewAuthor extends UserSummary {
  avatar?: string
  deepVTitle?: string
  isDeepV?: number
  isV?: number
  name?: string
  signature?: string
  userVid?: string | number
}
```

### `ReviewDetail` — dist/api/types.d.ts

```ts
interface ReviewDetail {
  abstract?: string
  author?: ReviewAuthor
  book?: BookInfo
  bookId?: string
  chapterIdx?: number
  chapterName?: string
  chapterUid?: number
  content?: string
  createTime?: number
  flag?: number
  friendship?: number
  htmlContent?: string
  isDeepV?: number
  isFinish?: number
  isLike?: number
  isPrivate?: number
  isReposted?: number
  mpInfo?: ArticleMpInfo
  range?: string
  reviewId?: string
  star?: number
  title?: string
  type?: number
  userVid?: string | number
}
```

### `ReviewEditResponse` — dist/api/types.d.ts

```ts
interface ReviewEditResponse {
  reviewId?: string
  userEditTime?: number
}
```

### `ReviewItem` — dist/api/types.d.ts

```ts
interface ReviewItem {
  idx?: number
  likesCount?: number
  review?: ReviewDetail
  reviewId?: string
}
```

### `ReviewListOptions` — dist/api/types.d.ts

```ts
interface ReviewListOptions extends SyncOptions {
  count?: number
  listMode?: number
  listType?: number
  maxIdx?: number
  mine?: number
  signal?: AbortSignal
  synckey?: number
}
```

### `ReviewListResponse` — dist/api/types.d.ts

```ts
interface ReviewListResponse extends SyncCursor {
  deepVRecommendInfo?: { title?: string | undefined; subtitle?: string | undefined; }
  deepVRecommendValue?: number
  deepVUniqueCount?: number
  friendCommentCount?: number
  friendCommentUsers?: UserSummary[]
  friendUniqueCount?: number
  hasMore?: number
  recentTotalCnt?: number
  reviews: ReviewItem[]
  reviewsCnt?: number
  reviewsHas1Star?: number
  reviewsHas5Star?: number
  reviewsHasMore?: number
  reviewsHasRecent?: number
  synckey?: number
  totalCount?: number
}
```

### `ReviewSingleOptions` — dist/api/types.d.ts

```ts
interface ReviewSingleOptions extends SyncOptions {
  commentsCount?: number
  commentsDirection?: 0 | 1
  likesCount?: number
  likesDirection?: 0 | 1
  signal?: AbortSignal
  synckey?: number
}
```

### `ReviewSingleResponse` — dist/api/types.d.ts

```ts
interface ReviewSingleResponse extends SyncCursor {
  bookFinderSuccessCount?: number
  dislikeCount?: number
  htmlContent?: string
  review?: ReviewDetail
  reviewId?: string
  synckey?: number
}
```

### `SaveCredentialsOptions` — dist/auth/credentials.d.ts

```ts
interface SaveCredentialsOptions {
  env?: ProcessEnv
  store?: string
}
```

### `SearchAudioResult` — dist/api/types.d.ts

```ts
interface SearchAudioResult {
  albumInfo?: { albumId?: string | undefined; name?: string | undefined; authorName?: string | undefined; cover?: string | undefined; desc?: string | undefined; scheme?: string | undefined; }
  albumInfoNew?: { albumId?: string | undefined; name?: string | undefined; authorName?: string | undefined; cover?: string | undefined; trackCount?: number | undefined; intro?: string | undefined; isPodcast?: number | undefined; payType?: number | undefined; }
}
```

### `SearchAuthorResult` — dist/api/types.d.ts

```ts
interface SearchAuthorResult {
  authorId?: string
  bookCount?: number
  bookId?: string
  recordDesc?: string
  recordType?: number
  role?: number
  title?: string
  word?: string
}
```

### `SearchBookContentResult` — dist/api/types.d.ts

```ts
interface SearchBookContentResult {
  abstract?: string
  chapterIdx?: number
  chapterTitle?: string
  chapterUid?: number
  keyword?: string[]
}
```

### `SearchBooklistResult` — dist/api/types.d.ts

```ts
interface SearchBooklistResult {
  author?: UserSummary
  booklistId?: string
  booklistTitle?: string
  books?: BookInfo[]
  collectCount?: number
  totalCount?: number
}
```

### `SearchOptions` — dist/api/types.d.ts

```ts
interface SearchOptions extends RequestOptions {
  count?: number
  maxIdx?: number
  scope?: SearchScope
  signal?: AbortSignal
}
```

### `SearchResponse` — dist/api/types.d.ts

```ts
interface SearchResponse {
  books: SearchResult[]
  correction?: string
  hasMore?: number
  parts?: string[]
  queryUid?: string
  sid?: string
  totalCount?: number
}
```

### `SearchResult` — dist/api/types.d.ts

```ts
interface SearchResult {
  bookContentInfo?: SearchBookContentResult
  bookInfo?: BookInfo
  booklistInfo?: SearchBooklistResult
  reading?: number
  readingCount?: number
  reason?: string
  recordInfo?: SearchAuthorResult
  scope?: number
  scopeCount?: number
  searchIdx?: number
  tsResultInfo?: SearchAudioResult
  type?: number
}
```

### `SearchScope` — dist/api/types.d.ts

```ts
type SearchScope = 0 | 2 | 4 | 6 | 10 | 12 | 13 | 14 | 16
```

### `SearchSuggestOptions` — dist/api/types.d.ts

```ts
interface SearchSuggestOptions extends RequestOptions {
  count?: number
  signal?: AbortSignal
}
```

### `SearchSuggestResponse` — dist/api/types.d.ts

```ts
interface SearchSuggestResponse {
  keyword?: string
  list: SearchSuggestion[]
  parts: string[]
  records: SearchSuggestion[]
}
```

### `SearchSuggestion` — dist/api/types.d.ts

```ts
interface SearchSuggestion {
  bookId?: string
  categoryId?: string
  totalCount?: number
  type?: number
  word?: string
}
```

### `ShelfAlbum` — dist/api/types.d.ts

```ts
interface ShelfAlbum {
  albumInfo?: { albumId?: string | undefined; name?: string | undefined; authorName?: string | undefined; cover?: string | undefined; trackCount?: number | undefined; finishStatus?: string | undefined; finish?: number | undefined; payType?: number | undefined; intro?: string | undefined; updateTime?: number | undefined; }
  albumInfoExtra?: { secret?: number | undefined; lecturePaid?: number | undefined; lectureReadUpdateTime?: number | undefined; isTop?: number | undefined; }
}
```

### `ShelfArchive` — dist/api/types.d.ts

```ts
interface ShelfArchive {
  bookIds?: string[]
  name?: string
}
```

### `ShelfBook` — dist/api/types.d.ts

```ts
interface ShelfBook {
  author?: string
  bookId?: string
  category?: string
  cover?: string
  deepLink?: string
  finishReading?: number
  isTop?: number
  readUpdateTime?: number
  secret?: number
  title?: string
  updateTime?: number
}
```

### `ShelfSyncResponse` — dist/api/types.d.ts

```ts
interface ShelfSyncResponse {
  albums?: ShelfAlbum[]
  archive?: ShelfArchive[]
  bookCount?: number
  books: ShelfBook[]
  mp?: Record<string, unknown> | null
}
```

### `SimilarOptions` — dist/api/types.d.ts

```ts
interface SimilarOptions extends RequestOptions {
  count?: number
  maxIdx?: number
  sessionId?: string
  signal?: AbortSignal
}
```

### `SimilarResponse` — dist/api/types.d.ts

```ts
interface SimilarResponse {
  booksimilar: { sessionId?: string | undefined; books: { idx?: number | undefined; book?: { bookInfo?: BookInfo | undefined; } | undefined; }[]; }
}
```

### `StarRating` — dist/api/types.d.ts

```ts
type StarRating = 20 | 40 | 60 | 80 | 100
```

### `StorableArticleState` — dist/api/types.d.ts

```ts
type StorableArticleState = "complete" | "partial"
// resolves to:
//   readonly [key: number]: string
```

### `StoredArticle` — dist/api/types.d.ts

```ts
interface StoredArticle {
  accountId?: string
  contentHtml?: string
  diagnostics?: PublicAccountDiagnostic[]
  fallbackHtml?: string
  markdown?: string
  mpInfo?: ArticleMpInfo
  publicationTime?: number
  review: ReviewSingleResponse
  reviewId: string
  sourceByteLength?: number
  sourceBytes?: Uint8Array<ArrayBufferLike>
  sourceSha256?: string
  sourceUrl?: string
  state: StorableArticleState
  storedAt?: string
  title?: string
}
```

### `SuggestInput` — dist/api/types.d.ts

```ts
interface SuggestInput extends RequestOptions {
  bookId: string
  chapterUid?: number
  mpReviewId?: string
  range?: string
  signal?: AbortSignal
  toolbar?: boolean
}
```

### `SuggestPrompt` — dist/api/types.d.ts

```ts
interface SuggestPrompt {
  icon?: string
  intent?: string
  prompt?: string
  title?: string
}
```

### `SuggestQuestionHint` — dist/api/types.d.ts

```ts
interface SuggestQuestionHint {
  hints?: string
  question?: string
}
```

### `SuggestResponse` — dist/api/types.d.ts

```ts
interface SuggestResponse {
  dropOldMsgs?: number
  prompts?: SuggestPrompt[]
  questionHints?: SuggestQuestionHint[]
  questions?: string[]
}
```

### `SyncCursor` — dist/api/types.d.ts

```ts
interface SyncCursor {
  synckey?: number
}
```

### `SyncOptions` — dist/api/types.d.ts

```ts
interface SyncOptions extends RequestOptions {
  signal?: AbortSignal
  synckey?: number
}
```

### `TocBackend` — dist/library/store.d.ts

```ts
type TocBackend = "eink" | "official"
// resolves to:
//   readonly [key: number]: string
```

### `TokenManager` — dist/auth/token.d.ts

```ts
class TokenManager {
  new (credentials: Credentials, options?: TokenManagerOptions): TokenManager
  get: (force?: boolean | undefined, signal?: AbortSignal | undefined) => Promise<AccessToken>
  // nominal: not assignable from a structurally identical object
}
```

### `TokenManagerOptions` — dist/auth/token.d.ts

```ts
interface TokenManagerOptions {
  baseUrl?: string
  fetchImpl?: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }
  logger?: Partial<Record<"debug" | "error" | "info" | "warn", (message: string) => void>>
  onCredentials?: ((credentials: Credentials) => void | Promise<void>)
  profile?: ClientProfile
  timeoutMs?: number
}
```

### `TokenProvider` — dist/api/mobile.d.ts

```ts
interface TokenProvider {
  get: (force?: boolean | undefined, signal?: AbortSignal | undefined) => Promise<AccessToken>
}
```

### `TransportError` — dist/errors.d.ts

```ts
class TransportError extends WeReadError {
  new (message: string, options?: { cause?: unknown; ambiguous?: boolean | undefined; }): TransportError
  readonly ambiguous: boolean
}
```

### `UnderlineItem` — dist/api/types.d.ts

```ts
interface UnderlineItem {
  count?: number
  range?: string
  score?: number
  type?: number
}
```

### `UnderlinesResponse` — dist/api/types.d.ts

```ts
interface UnderlinesResponse extends SyncCursor {
  bookId?: string
  chapterUid?: number
  synckey?: number
  underlines: UnderlineItem[]
}
```

### `UpdateBookmarkInput` — dist/api/types.d.ts

```ts
interface UpdateBookmarkInput extends RequestOptions {
  bookmarkId: string
  colorStyle?: number
  signal?: AbortSignal
  style: number
}
```

### `UserSummary` — dist/api/types.d.ts

```ts
interface UserSummary {
  avatar?: string
  name?: string
  userVid?: string | number
}
```

### `WeReadApiError` — dist/errors.d.ts

```ts
class WeReadApiError extends WeReadError {
  new (message: string, info: { status: number; path: string; errCode?: number | undefined; ambiguous?: boolean | undefined; cause?: unknown; }): WeReadApiError
  readonly ambiguous: boolean
  readonly errCode?: number
  readonly path: string
  readonly status: number
}
```

### `WeReadClient` — dist/api/client.d.ts

```ts
class WeReadClient {
  new (__0: WeReadClientOptions): WeReadClient
  readonly ai: { askBook(input: AskBookInput): Promise<AskBookResult>; suggest(input: SuggestInput): Promise<SuggestResponse>; }
  readonly book: { info: (bookId: string, options?: RequestOptions | undefined) => Promise<BookInfo>; detail: (bookId: string, options?: BookDetailOptions | undefined) => Promise<BookDetailResponse>; chapters: (bookId: string, options?: RequestOptions | undefined) => Promise<ChapterInfoResponse>; progress: (bookId: string, options?: RequestOptions | undefined) => Promise<BookProgress>; }
  readonly discover: { recommend(options?: RecommendOptions | undefined): Promise<RecommendResponse>; similar(bookId: string, options?: SimilarOptions | undefined): Promise<SimilarResponse>; }
  readonly import: { book(input: ImportBookInput): Promise<ImportBookResult>; }
  readonly notes: { notebooks(options?: NotebooksOptions | undefined): Promise<NotebooksResponse>; recent(options?: RecentNotesOptions | undefined): Promise<RecentNotesResponse>; bookmarks(bookId: string, options?: SyncOptions | undefined): Promise<BookmarkListResponse>; mine(bookId: string, options?: MineNotesOptions | undefined): Promise<MineReviewListResponse>; best(bookId: string, options?: BestNotesOptions | undefined): Promise<BestBookmarksResponse>; readReviews(bookId: string, chapterUid: number, reviews: ReadReviewQuery[], options?: RequestOptions | undefined): Promise<ReadReviewsResponse>; underlines(bookId: string, chapterUid: number, options?: SyncOptions | undefined): Promise<UnderlinesResponse>; addBookmark(input: AddBookmarkInput): Promise<MutationSuccessResponse>; updateBookmark(input: UpdateBookmarkInput): Promise<MutationSuccessResponse>; removeBookmark(bookmarkId: string, options?: RequestOptions | undefined): Promise<MutationSuccessResponse>; }
  readonly publicAccounts: { subscriptions(options?: PublicAccountSubscriptionsOptions | undefined): Promise<PublicAccountSubscriptionsPage>; articles(accountId: string, options?: PublicAccountArticlesOptions | undefined): Promise<PublicAccountArticlesPage>; resolveArticle(docUrl: string, options?: RequestOptions | undefined): Promise<PublicAccountArticleResolution>; paidContent(docUrl: string, options?: RequestOptions | undefined): Promise<PaidArticleResponse>; subscribe(accountId: string, options?: RequestOptions | undefined): Promise<MutationSuccessResponse>; unsubscribe(accountId: string, options?: RequestOptions | undefined): Promise<MutationSuccessResponse>; }
  readonly readData: { detail(options?: ReadDataOptions | undefined): Promise<ReadDataResponse>; }
  readonly review: { list(bookId: string, options?: ReviewListOptions | undefined): Promise<ReviewListResponse>; single(reviewId: string, options?: ReviewSingleOptions | undefined): Promise<ReviewSingleResponse>; add(input: ReviewAddInput): Promise<ReviewAddResponse>; edit(reviewId: string, content: string, options?: RequestOptions | undefined): Promise<ReviewEditResponse>; delete: (reviewId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; }
  readonly search: { books(keyword: string, options?: SearchOptions | undefined): Promise<SearchResponse>; suggest(keyword: string, options?: SearchSuggestOptions | undefined): Promise<SearchSuggestResponse>; }
  readonly shelf: { sync: (options?: RequestOptions | undefined) => Promise<ShelfSyncResponse>; add: (bookId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; delete: (bookId: string, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; pin: (bookId: string, top?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; setPrivate: (bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MutationSuccessResponse>; markFinished: (bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MarkFinishedResponse>; markReading: (bookId: string, on?: boolean | undefined, options?: RequestOptions | undefined) => Promise<MarkFinishedResponse>; }
}
```

### `WeReadClientOptions` — dist/api/client.d.ts

```ts
interface WeReadClientOptions {
  eink: MobileApiClient
}
```

### `WeReadError` — dist/errors.d.ts

```ts
class WeReadError extends Error {
  new (message: string, options?: { cause?: unknown; }): WeReadError
}
```

### `YearReportItem` — dist/api/types.d.ts

```ts
interface YearReportItem {
  scheme?: string
  times?: number[]
  year?: number
}
```

### `applyConnectAttemptTimeout` — dist/connect-timeout.d.ts

```ts
function applyConnectAttemptTimeout(env?: ProcessEnv, setAttemptTimeout?: ((milliseconds: number) => void)): number | undefined
```

### `assertCanonicalClient` — dist/plugin.d.ts

```ts
function assertCanonicalClient(value: unknown, label?: string): void
```

### `buildPublicAccountFeed` — dist/public-accounts.d.ts

```ts
function buildPublicAccountFeed(client: PublicAccountClient, source: PublicAccountFeedSource, options: PublicAccountFeedOptions): Promise<PublicAccountFeedResult>
```

### `createEinkClient` — dist/api/mobile-client.d.ts

```ts
const createEinkClient: (options?: EinkClientOptions) => MobileApiClient
```

### `createProgram` — dist/cli.d.ts

```ts
function createProgram<TClient extends CliOperationsClient>(dependencies?: CliDependencies<TClient>): Command
```

### `deviceVersionHeaders` — dist/device-ua.d.ts

```ts
function deviceVersionHeaders(device: MobileDevice): Record<string, string>
```

### `einkDevice` — dist/device-ua.d.ts

```ts
function einkDevice(): MobileDevice
```

### `einkProfile` — dist/profile.d.ts

```ts
function einkProfile(): ClientProfile
```

### `exchange` — dist/auth/qrlogin.d.ts

```ts
function exchange(wxCode: string, deviceId: string, fetchImpl?: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }, options?: AuthRequestOptions): Promise<Credentials>
```

### `exportPublicAccountArchive` — dist/public-accounts.d.ts

```ts
function exportPublicAccountArchive(client: PublicAccountClient, accountId: string, options: PublicAccountArchiveOptions): Promise<PublicAccountArchiveResult>
```

### `integer` — dist/cli/commands.d.ts

```ts
function integer(value: string): number
```

### `isAmbiguousImportOutcome` — dist/api/resources/import.d.ts

```ts
const isAmbiguousImportOutcome: (error: unknown) => boolean
```

### `isMain` — dist/cli.d.ts

```ts
function isMain(moduleUrl?: string, entry?: string): boolean
```

### `libraryRoot` — dist/library/paths.d.ts

```ts
function libraryRoot(env?: ProcessEnv): string
```

### `loadClientPlugins` — dist/plugin.d.ts

```ts
function loadClientPlugins(specifiers: readonly string[]): Promise<ClientPlugin[]>
```

### `loadCredentials` — dist/auth/credentials.d.ts

```ts
function loadCredentials(options?: LoadCredentialsOptions): Credentials
```

### `login` — dist/auth/qrlogin.d.ts

```ts
function login(options?: LoginOptions): Promise<Credentials>
```

### `mintAccessToken` — dist/auth/token.d.ts

```ts
function mintAccessToken(credentials: Credentials, fetchImpl?: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }, options?: MintAccessTokenOptions): Promise<AccessToken>
```

### `output` — dist/cli/output.d.ts

```ts
function output<T>(data: T, options: OutputOptions, humanFormat: (value: T) => string): void
```

### `pluginSpecifiers` — dist/plugin.d.ts

```ts
function pluginSpecifiers(env?: ProcessEnv): string[]
```

### `pollForCode` — dist/auth/qrlogin.d.ts

```ts
function pollForCode(uuid: string, fetchImpl?: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }, options?: PollOptions): Promise<string>
```

### `port` — dist/cli/commands.d.ts

```ts
function port(value: string): number
```

### `printQr` — dist/auth/qr-terminal.d.ts

```ts
function printQr(url: string): Promise<void>
```

### `readPublicAccountArticle` — dist/public-accounts.d.ts

```ts
function readPublicAccountArticle(client: SingleArticleClient, docUrl: string, options?: PublicAccountReadOptions): Promise<PublicAccountReadResult>
```

### `registerClientPlugins` — dist/plugin.d.ts

```ts
function registerClientPlugins(builtins: Readonly<Record<string, ClientProvider>>, plugins: readonly ClientPlugin[]): ReadonlyMap<string, RegisteredClient>
```

### `requestQr` — dist/auth/qrlogin.d.ts

```ts
function requestQr(fetchImpl?: { (input: URL | RequestInfo, init?: RequestInit | undefined): Promise<Response>; (input: string | Request | URL, init?: RequestInit | undefined): Promise<Response>; }, options?: AuthRequestOptions): Promise<QrRequest>
```

### `resolveProfile` — dist/profile.d.ts

```ts
function resolveProfile(options: { profile?: ClientProfile | undefined; }): ClientProfile
```

### `runAccountCli` — dist/cli.d.ts

```ts
function runAccountCli(argv: string[] | undefined, dependencies: AccountCliDependencies): Promise<number>
```

### `runCli` — dist/cli.d.ts

```ts
function runCli<TClient extends CliOperationsClient>(argv?: string[], dependencies?: CliDependencies<TClient>): Promise<number>
```

### `saveCredentials` — dist/auth/credentials.d.ts

```ts
function saveCredentials(credentials: Credentials, options?: SaveCredentialsOptions): void
```

### `storePath` — dist/auth/credentials.d.ts

```ts
function storePath(env?: ProcessEnv, store?: string): string
```

### `toTransportError` — dist/errors.d.ts

```ts
function toTransportError(error: unknown, label: string, options?: { ambiguous?: boolean | undefined; }): TransportError
```

### `validateClientPlugin` — dist/plugin.d.ts

```ts
function validateClientPlugin(value: unknown, source?: string): ClientPlugin
```

### `withContentLibrary` — dist/library/cached-client.d.ts

```ts
function withContentLibrary(client: CanonicalClient, options: LibraryClientOptions): CanonicalClient
```
