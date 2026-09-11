export {
  type AccountLoginOptions,
  AccountManager,
  type AccountManagerOptions,
  type AccountSummary,
  type ClientSummary,
  type OpenAccount,
} from "./accounts.js";
export {
  type CanonicalBook,
  type CanonicalClient,
  WeReadClient,
  type WeReadClientOptions,
} from "./api/client.js";
export { ALLOWED_EXT, BookValidationError } from "./api/import-guards.js";
export {
  type MobileCallOptions,
  MobileClient,
  type MobileClientOptions,
  type MobileResponse,
  type QueryValue,
  type RawMobileCallOptions,
  type TokenProvider,
} from "./api/mobile.js";
export {
  type ClientLoginOptions,
  createEinkClient,
  type EinkClientOptions,
  MobileApiClient,
  type MobileApiClientOptions,
} from "./api/mobile-client.js";
export { PUBLIC_OPERATIONS } from "./api/operations.js";
export {
  type ImportFailurePhase,
  ImportPhaseError,
  isAmbiguousImportOutcome,
} from "./api/resources/import.js";
export type { MobileResourceDependencies } from "./api/resources/index.js";
/**
 * The public type surface, enumerated.
 *
 * This was `export type * from "./api/types.js"`, which made every declaration in that module —
 * present and future — a package-level compatibility obligation the moment it was written, with no
 * review step (docs/api-stability-policy.md, "Pin the TypeScript surface"). The list below is the
 * contract instead: what a consumer needs to call the canonical operations (options and inputs), to
 * *hold* what they return (results and their element types), and to supply the dependencies the
 * public option types accept. Adding a public type is now an edit here, on purpose.
 *
 * Deliberately absent: `MobileTransport`, the internal seam `MobileApiClient` uses to hand resource
 * modules a lazily-constructed transport. No public signature mentions it.
 */
export type {
  AddBookmarkInput,
  ArticleMpInfo,
  AskBookInput,
  AskBookResult,
  BestBookmarkItem,
  BestBookmarksResponse,
  BestNotesOptions,
  BookDetailOptions,
  BookDetailResponse,
  BookInfo,
  Bookmark,
  BookmarkListResponse,
  BookProgress,
  ChapterContent,
  ChapterInfo,
  ChapterInfoResponse,
  CosCredentials,
  CosUploader,
  CosUploadInput,
  ImportBookInput,
  ImportBookResult,
  MarkFinishedResponse,
  MineNotesOptions,
  MineReviewItem,
  MineReviewListResponse,
  MutationSuccessResponse,
  NotebookBook,
  NotebooksOptions,
  NotebooksResponse,
  PaidArticleEntry,
  PaidArticleResponse,
  PreferAuthorItem,
  PreferCategoryItem,
  PreferCopyrightItem,
  PreferPublisherItem,
  PublicAccount,
  PublicAccountArchiveItem,
  PublicAccountArchiveManifest,
  PublicAccountArchiveOptions,
  PublicAccountArchiveResult,
  PublicAccountArticle,
  PublicAccountArticleResolution,
  PublicAccountArticleState,
  PublicAccountArticlesOptions,
  PublicAccountArticlesPage,
  PublicAccountArtifactErrorCode,
  PublicAccountCursor,
  PublicAccountCursorTerminal,
  PublicAccountDiagnostic,
  PublicAccountDiagnosticCode,
  PublicAccountFeedFormat,
  PublicAccountFeedOptions,
  PublicAccountFeedResult,
  PublicAccountFeedSource,
  PublicAccountLibrary,
  PublicAccountLibraryMode,
  PublicAccountSubscriptionsOptions,
  PublicAccountSubscriptionsPage,
  PutArticleInput,
  ReadDataOptions,
  ReadDataResponse,
  ReadLongestItem,
  ReadReviewPageItem,
  ReadReviewQuery,
  ReadReviewRange,
  ReadReviewsResponse,
  ReadStatItem,
  RecentNoteItem,
  RecentNotesOptions,
  RecentNotesResponse,
  RecommendBook,
  RecommendOptions,
  RecommendResponse,
  RequestOptions,
  ReviewAddInput,
  ReviewAddResponse,
  ReviewAuthor,
  ReviewDetail,
  ReviewEditResponse,
  ReviewItem,
  ReviewListOptions,
  ReviewListResponse,
  ReviewSingleOptions,
  ReviewSingleResponse,
  SearchAudioResult,
  SearchAuthorResult,
  SearchBookContentResult,
  SearchBooklistResult,
  SearchOptions,
  SearchResponse,
  SearchResult,
  SearchScope,
  SearchSuggestion,
  SearchSuggestOptions,
  SearchSuggestResponse,
  ShelfAlbum,
  ShelfArchive,
  ShelfBook,
  ShelfSyncResponse,
  SimilarOptions,
  SimilarResponse,
  StarRating,
  StorableArticleState,
  StoredArticle,
  SuggestInput,
  SuggestPrompt,
  SuggestQuestionHint,
  SuggestResponse,
  SyncCursor,
  SyncOptions,
  UnderlineItem,
  UnderlinesResponse,
  UpdateBookmarkInput,
  UserSummary,
  YearReportItem,
} from "./api/types.js";
export {
  type Credentials,
  type LoadCredentialsOptions,
  loadCredentials,
  type SaveCredentialsOptions,
  saveCredentials,
  storePath,
} from "./auth/credentials.js";
export {
  type AuthRequestOptions,
  exchange,
  type LoginOptions,
  type LoginStatus,
  login,
  type PollOptions,
  pollForCode,
  type QrRequest,
  requestQr,
} from "./auth/qrlogin.js";
export {
  type AccessToken,
  type MintAccessTokenOptions,
  mintAccessToken,
  TokenManager,
  type TokenManagerOptions,
} from "./auth/token.js";
export { applyConnectAttemptTimeout } from "./connect-timeout.js";
export { deviceVersionHeaders, einkDevice, type MobileDevice } from "./device-ua.js";
export { AuthError, TransportError, toTransportError, WeReadApiError, WeReadError } from "./errors.js";
// The local content library. Deliberately narrow: the store, the decorator that puts it in front
// of a client, the root resolver, and the typed failures. Row shapes stay internal until a
// consumer needs them, because every name here is a permanent contract.
export {
  type ChapterMetadata,
  ContentLibrary,
  type ContentLibraryOptions,
  type LibraryClientOptions,
  LibraryError,
  type LibraryMode,
  type LibraryStats,
  LibraryStoreError,
  LibraryUnsupportedError,
  LibraryVersionError,
  libraryRoot,
  type TocBackend,
  withContentLibrary,
} from "./library/index.js";
export type { Logger } from "./logger.js";
export { type ClientProfile, einkProfile, resolveProfile } from "./profile.js";
export {
  buildPublicAccountFeed,
  exportPublicAccountArchive,
  PublicAccountArtifactError,
  PublicAccountReadError,
  type PublicAccountReadOptions,
  type PublicAccountReadResult,
  readPublicAccountArticle,
} from "./public-accounts.js";
