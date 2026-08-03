import { createHash } from "node:crypto";
import { chmod, mkdir, open, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type ExtractionResult, extractFromHtml, htmlToMarkdown } from "@teng-lin/agent-fetch";
import { Feed } from "feed";
import type { CanonicalClient } from "./api/client.js";
import { assertOperationArguments, OPERATIONS } from "./api/operation-spec.js";
import type {
  ArticleMpInfo,
  PublicAccount,
  PublicAccountArchiveItem,
  PublicAccountArchiveManifest,
  PublicAccountArchiveOptions,
  PublicAccountArchiveResult,
  PublicAccountArticle,
  PublicAccountArticleState,
  PublicAccountArtifactErrorCode,
  PublicAccountCursor,
  PublicAccountDiagnostic,
  PublicAccountDiagnosticCode,
  PublicAccountFeedOptions,
  PublicAccountFeedResult,
  PublicAccountFeedSource,
  PublicAccountLibrary,
  PublicAccountLibraryMode,
  ReviewDetail,
  ReviewSingleResponse,
} from "./api/types.js";
import { einkDevice } from "./device-ua.js";
import { AuthError, TransportError, WeReadApiError, WeReadError } from "./errors.js";

type PublicAccountClient = Pick<CanonicalClient, "publicAccounts" | "review">;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const ARTICLE_PAGE_SIZE = 50;
const SOURCE_TIMEOUT_MS = 20_000;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MIN_CONTENT_CHARACTERS = 200;
const SOURCE_USER_AGENT = einkDevice().userAgent;
const BLOCKED_CONTENT = /(?:访问过于频繁|环境异常|异常访问|操作频繁|请在微信客户端打开链接|需要验证|安全验证)/;
const CLOUDFLARE_CONTENT = /(?:cf-chl-|challenge-platform|just a moment|attention required.{0,20}cloudflare)/i;
const PAYWALL_CONTENT = /(?:付费后阅读|购买后阅读|付费内容|试看)/;

export class PublicAccountArtifactError extends WeReadError {
  readonly code: PublicAccountArtifactErrorCode;
  readonly path: string;
  readonly incomplete: boolean;
  readonly incompletePath?: string;
  readonly authenticationHint?: string;
  readonly status?: number;
  readonly upstreamPath?: string;
  readonly errCode?: number;
  readonly ambiguous: boolean;

  constructor(
    message: string,
    info: {
      code: PublicAccountArtifactErrorCode;
      path: string;
      incomplete?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, { cause: info.cause });
    this.code = info.code;
    this.path = info.path;
    this.incomplete = info.incomplete === true;
    if (this.incomplete) this.incompletePath = info.path;

    const cause = info.cause;
    if (cause instanceof AuthError) this.authenticationHint = "Re-authenticate the selected account and retry.";
    if (cause instanceof WeReadApiError) {
      this.status = cause.status;
      this.upstreamPath = cause.path;
      this.errCode = cause.errCode;
      this.ambiguous = cause.ambiguous;
      if (cause.status === 401 || cause.errCode === -2012) {
        this.authenticationHint = "Re-authenticate the selected account and retry.";
      }
    } else {
      this.ambiguous = cause instanceof TransportError && cause.ambiguous;
    }
  }
}

interface ArticleReference {
  accountId: string;
  accountTitle?: string;
  reviewId: string;
  article: PublicAccountArticle;
}

interface CollectedReferences {
  references: ArticleReference[];
  cursors: PublicAccountCursor[];
  diagnostics: PublicAccountDiagnostic[];
}

interface RetrievedSource {
  state: PublicAccountArticleState;
  contentHtml?: string;
  markdown?: string;
  sourceUrl: string;
  nativeBytes?: Uint8Array;
  fallbackHtml?: string;
  sourceSha256?: string;
  sourceByteLength?: number;
  diagnostics: PublicAccountDiagnostic[];
  cacheable?: false;
}

interface ResolvedArticle extends ArticleReference {
  accountName: string;
  response: ReviewSingleResponse;
  review: ReviewDetail;
  mpInfo?: ArticleMpInfo;
  publicationTime: number;
  title: string;
  source?: RetrievedSource;
  state: PublicAccountArticleState;
}

interface CollectedArticles {
  articles: ResolvedArticle[];
  cursors: PublicAccountCursor[];
  diagnostics: PublicAccountDiagnostic[];
}

class SourceFailure extends Error {
  readonly code: PublicAccountDiagnosticCode;
  readonly status?: number;

  constructor(code: PublicAccountDiagnosticCode, message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.status = status;
  }
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function limitOf(value: number | undefined): number {
  const limit = value ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`limit must be a safe integer from 1 to ${MAX_LIMIT}`);
  }
  return limit;
}

function assertAccountId(accountId: string): void {
  assertOperationArguments(OPERATIONS.publicAccountsArticles, { accountId, count: 1, synckey: 0 });
}

function sourceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new SourceFailure("SOURCE_URL_INVALID", "article source URL is invalid", undefined, { cause });
  }
  const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i.exec(value)?.[1] ?? "";
  if (
    value !== value.trim() ||
    authority.includes("@") ||
    url.protocol !== "https:" ||
    url.hostname !== "mp.weixin.qq.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    (url.pathname !== "/s" && !url.pathname.startsWith("/s/"))
  ) {
    throw new SourceFailure(
      "SOURCE_URL_INVALID",
      "article source must be an HTTPS mp.weixin.qq.com/s URL without credentials or a custom port",
    );
  }
  // WeChat appends "#rd" to essentially every article link, and rejecting that turned away every
  // real URL. A fragment is never sent to the server, so it cannot change where the request goes
  // or what it carries -- it is dropped rather than treated as grounds for refusal. The credential,
  // port, scheme, host and path checks above are the ones that matter.
  url.hash = "";
  return url;
}

function diagnostic(
  code: PublicAccountDiagnosticCode,
  message: string,
  reference: Pick<ArticleReference, "accountId"> & Partial<Pick<ArticleReference, "reviewId">>,
  extra: { sourceUrl?: string; status?: number; cause?: unknown } = {},
): PublicAccountDiagnostic {
  const cause = extra.cause;
  return {
    code,
    message,
    accountId: reference.accountId,
    ...(reference.reviewId ? { reviewId: reference.reviewId } : {}),
    ...(extra.sourceUrl ? { sourceUrl: extra.sourceUrl } : {}),
    ...(extra.status === undefined ? {} : { status: extra.status }),
    ...(cause instanceof WeReadApiError
      ? {
          status: cause.status,
          path: cause.path,
          ...(cause.errCode === undefined ? {} : { errCode: cause.errCode }),
          ...(cause.ambiguous ? { ambiguous: true } : {}),
        }
      : cause instanceof TransportError && cause.ambiguous
        ? { ambiguous: true }
        : {}),
  };
}

async function readBytes(response: Response): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_SOURCE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new SourceFailure("SOURCE_TOO_LARGE", `article source exceeds ${MAX_SOURCE_BYTES} bytes`);
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.byteLength > MAX_SOURCE_BYTES - total) {
        await reader.cancel().catch(() => undefined);
        throw new SourceFailure("SOURCE_TOO_LARGE", `article source exceeds ${MAX_SOURCE_BYTES} bytes`);
      }
      chunks.push(next.value);
      total += next.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchBytes(initial: URL, signal: AbortSignal): Promise<{ bytes: Uint8Array; url: URL }> {
  let current = initial;
  let redirects = 0;
  for (;;) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": SOURCE_USER_AGENT,
        },
      });
    } catch (cause) {
      if (signal.aborted) throw cause;
      throw new SourceFailure("SOURCE_FETCH_FAILED", "article source fetch failed", undefined, { cause });
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (redirects >= 3) throw new SourceFailure("SOURCE_REDIRECT_LIMIT", "article source exceeded three redirects");
      if (!location) throw new SourceFailure("SOURCE_REDIRECT_INVALID", "article redirect has no location");
      try {
        const redirectAuthority = /^(?:[a-z][a-z\d+.-]*:)?\/\/([^/?#]*)/i.exec(location)?.[1] ?? "";
        if (location !== location.trim() || location.includes("#") || redirectAuthority.includes("@")) {
          throw new TypeError("redirect contains credentials, whitespace, or a fragment");
        }
        const target = new URL(location, current);
        if (target.hostname === "mp.weixin.qq.com" && target.pathname === "/mp/wappoc_appmsgcaptcha") {
          throw new SourceFailure(
            "SOURCE_WECHAT_CHALLENGE",
            "WeChat blocked direct retrieval; open the article URL in a browser to complete verification",
            response.status,
          );
        }
        current = sourceUrl(target.href);
      } catch (cause) {
        if (cause instanceof SourceFailure && cause.code === "SOURCE_WECHAT_CHALLENGE") throw cause;
        throw new SourceFailure("SOURCE_REDIRECT_INVALID", "article redirect target is not allowed", undefined, {
          cause,
        });
      }
      redirects += 1;
      continue;
    }
    if (!response.ok) {
      const cloudflare = response.headers.has("cf-ray") || /cloudflare/i.test(response.headers.get("server") ?? "");
      await response.body?.cancel().catch(() => undefined);
      if (cloudflare && [403, 429, 503].includes(response.status)) {
        throw new SourceFailure(
          "SOURCE_CLOUDFLARE_CHALLENGE",
          "Cloudflare blocked direct retrieval; open the article URL in a browser to complete the challenge",
          response.status,
        );
      }
      throw new SourceFailure("SOURCE_HTTP_ERROR", `article source returned HTTP ${response.status}`, response.status);
    }
    return { bytes: await readBytes(response), url: current };
  }
}

function extracted(html: string, url: string): ExtractionResult | undefined {
  try {
    return extractFromHtml(html, url) ?? undefined;
  } catch {
    return undefined;
  }
}

function usable(
  result: ExtractionResult | undefined,
  paywall = false,
): result is ExtractionResult & { content: string } {
  if (!result?.content?.trim()) return false;
  const length = result.textContent?.trim().length ?? result.content.replace(/<[^>]+>/g, "").trim().length;
  return length >= MIN_CONTENT_CHARACTERS || ((paywall || result.isAccessibleForFree === false) && length > 0);
}

function retrieved(
  state: "complete" | "partial",
  url: URL,
  bytes: Uint8Array,
  result: ExtractionResult & { content: string },
  diagnostics: PublicAccountDiagnostic[],
  cacheable = true,
): RetrievedSource {
  return {
    state,
    contentHtml: result.content,
    markdown: result.markdown ?? htmlToMarkdown(result.content),
    sourceUrl: url.href,
    nativeBytes: bytes,
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    sourceByteLength: bytes.byteLength,
    diagnostics,
    ...(cacheable ? {} : { cacheable: false }),
  };
}

/** `payType` 2 is the protected-content marker the e-ink client branches on. */
const PAID_ARTICLE_PAY_TYPE = 2;

/**
 * Fetch a protected article body through the entitlement endpoint.
 *
 * Returns the authorized HTML when the account owns it. When it does not, upstream answers with a
 * substitute URL to download instead, which is the ordinary preview path -- so that is handed back
 * as a URL rather than as content, and the caller falls through to its normal download.
 */
async function retrievePaid(
  client: PublicAccountClient,
  docUrl: string,
  signal?: AbortSignal,
): Promise<{ html?: string; previewUrl?: string; fee?: number }> {
  const response = await client.publicAccounts.paidContent(docUrl, { ...(signal ? { signal } : {}) });
  const entry = response.entries[0] ?? {};
  if (entry.ispaid === true && typeof entry.content === "string" && entry.content.length > 0) {
    return { html: entry.content, ...(entry.fee === undefined ? {} : { fee: entry.fee }) };
  }
  return {
    ...(typeof entry.url === "string" && entry.url.length > 0 ? { previewUrl: entry.url } : {}),
    ...(entry.fee === undefined ? {} : { fee: entry.fee }),
  };
}

async function retrieveSource(
  reference: ArticleReference,
  mpInfo: ArticleMpInfo,
  signal?: AbortSignal,
  client?: PublicAccountClient,
): Promise<RetrievedSource> {
  let initial: URL;
  try {
    initial = sourceUrl(mpInfo.doc_url ?? "");
  } catch (cause) {
    const failure = cause as SourceFailure;
    return {
      state: "unsupported",
      sourceUrl: mpInfo.doc_url ?? "",
      diagnostics: [diagnostic(failure.code, failure.message, reference, { sourceUrl: mpInfo.doc_url })],
    };
  }

  const diagnosticsForPaid: PublicAccountDiagnostic[] = [];
  const timeout = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  // A protected article is not readable from its public URL, so the entitlement endpoint is asked
  // first. An entitled account gets the authorized HTML back here and never downloads the page.
  if (client && mpInfo.payType === PAID_ARTICLE_PAY_TYPE) {
    try {
      const paid = await retrievePaid(client, initial.href, combined);
      if (paid.html !== undefined) {
        const bytes = new TextEncoder().encode(paid.html);
        const result = extracted(paid.html, initial.href);
        if (usable(result, true)) {
          return retrieved("complete", initial, bytes, result as ExtractionResult & { content: string }, []);
        }
      } else if (paid.previewUrl !== undefined) {
        try {
          initial = sourceUrl(paid.previewUrl);
        } catch {
          // Upstream offered a substitute the guard refuses; the original URL still stands.
        }
      }
    } catch (cause) {
      // The article is still worth attempting from its public URL, which is what an unentitled
      // reader sees anyway.
      diagnosticsForPaid.push(
        diagnostic("SOURCE_CONTENT_INSUFFICIENT", `paid article lookup failed: ${errorMessage(cause)}`, reference, {
          sourceUrl: initial.href,
          cause,
        }),
      );
    }
  }

  let nativeFailure: SourceFailure;
  let nativeArtifact: { bytes: Uint8Array; url: URL; sha256: string; byteLength: number } | undefined;
  try {
    const native = await fetchBytes(initial, combined);
    const sha256 = createHash("sha256").update(native.bytes).digest("hex");
    nativeArtifact = { ...native, sha256, byteLength: native.bytes.byteLength };
    const html = new TextDecoder().decode(native.bytes);
    const cloudflare = CLOUDFLARE_CONTENT.test(html);
    const result = BLOCKED_CONTENT.test(html) || cloudflare ? undefined : extracted(html, native.url.href);
    const paywall = result?.isAccessibleForFree === false || PAYWALL_CONTENT.test(html) || (mpInfo.payType ?? 0) > 0;
    if (usable(result, paywall)) {
      return retrieved(
        paywall ? "partial" : "complete",
        native.url,
        native.bytes,
        result,
        paywall
          ? [
              ...diagnosticsForPaid,
              diagnostic("SOURCE_PAYWALL_PREVIEW", "article source exposes a paywall preview", reference, {
                sourceUrl: native.url.href,
              }),
            ]
          : diagnosticsForPaid,
        diagnosticsForPaid.length === 0,
      );
    }
    nativeFailure = cloudflare
      ? new SourceFailure(
          "SOURCE_CLOUDFLARE_CHALLENGE",
          "Cloudflare blocked direct retrieval; open the article URL in a browser to complete the challenge",
        )
      : new SourceFailure(
          "SOURCE_CONTENT_INSUFFICIENT",
          BLOCKED_CONTENT.test(html) ? "article source was blocked" : "article source content was insufficient",
        );
  } catch (cause) {
    if (signal?.aborted) throw cause;
    if (timeout.aborted) nativeFailure = new SourceFailure("SOURCE_TIMEOUT", "article source timed out");
    else
      nativeFailure =
        cause instanceof SourceFailure ? cause : new SourceFailure("SOURCE_FETCH_FAILED", errorMessage(cause));
  }

  return {
    state: "unsupported",
    sourceUrl: nativeArtifact?.url.href ?? initial.href,
    ...(nativeArtifact
      ? {
          nativeBytes: nativeArtifact.bytes,
          sourceSha256: nativeArtifact.sha256,
          sourceByteLength: nativeArtifact.byteLength,
        }
      : {}),
    diagnostics: [
      ...diagnosticsForPaid,
      diagnostic(nativeFailure.code, nativeFailure.message, reference, {
        sourceUrl: nativeArtifact?.url.href ?? initial.href,
        status: nativeFailure.status,
      }),
    ],
  };
}

async function collectAccount(
  client: PublicAccountClient,
  account: PublicAccount,
  limit: number,
  signal?: AbortSignal,
): Promise<{ references: ArticleReference[]; cursor: PublicAccountCursor; diagnostics: PublicAccountDiagnostic[] }> {
  const references: ArticleReference[] = [];
  const diagnostics: PublicAccountDiagnostic[] = [];
  const seenReviews = new Set<string>();
  let requestedOffset = 0;

  for (;;) {
    signal?.throwIfAborted();
    const page = await client.publicAccounts.articles(account.accountId, {
      count: Math.min(ARTICLE_PAGE_SIZE, Math.max(1, limit - references.length)),
      // The first request carries no offset, which selects the synckey shape the clients open
      // with. Every later page carries one.
      ...(requestedOffset === 0 ? {} : { offset: requestedOffset }),
      signal,
    });
    if (page.articles.length === 0) {
      return {
        references,
        diagnostics,
        cursor: { accountId: account.accountId, requestedOffset, terminal: "empty" },
      };
    }

    let added = 0;
    for (const article of page.articles) {
      if (references.length >= limit) break;
      if (typeof article.reviewId !== "string" || article.reviewId.length === 0) {
        diagnostics.push(
          diagnostic("ARTICLE_ID_MISSING", "article listing entry has no review ID", {
            accountId: account.accountId,
          }),
        );
        continue;
      }
      if (seenReviews.has(article.reviewId)) continue;
      seenReviews.add(article.reviewId);
      const reference: ArticleReference = {
        accountId: account.accountId,
        accountTitle: account.title,
        reviewId: article.reviewId,
        article,
      };
      references.push(reference);
      added += 1;
    }

    const cursorBase = {
      accountId: account.accountId,
      requestedOffset,
      ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
    };
    if (references.length >= limit) return { references, diagnostics, cursor: { ...cursorBase, terminal: "limit" } };
    if (page.hasMore === 0) return { references, diagnostics, cursor: { ...cursorBase, terminal: "explicit" } };
    if (added === 0) return { references, diagnostics, cursor: { ...cursorBase, terminal: "duplicate_only" } };
    // A short page is how this route says there is nothing further; `nextOffset` is only set when
    // the page came back full.
    if (page.nextOffset === undefined) {
      return { references, diagnostics, cursor: { ...cursorBase, terminal: "missing_cursor" } };
    }
    requestedOffset = page.nextOffset;
  }
}

async function collectReferences(
  client: PublicAccountClient,
  source: PublicAccountFeedSource,
  limit: number,
  signal?: AbortSignal,
): Promise<CollectedReferences> {
  let accounts: PublicAccount[];
  if (source.kind === "account") {
    assertAccountId(source.accountId);
    accounts = [{ accountId: source.accountId, bookId: source.accountId }];
  } else {
    accounts = (
      await client.publicAccounts.subscriptions({
        count: Number.MAX_SAFE_INTEGER,
        offset: 0,
        signal,
      })
    ).accounts;
  }

  const references: ArticleReference[] = [];
  const cursors: PublicAccountCursor[] = [];
  const diagnostics: PublicAccountDiagnostic[] = [];
  const globalReviews = new Set<string>();
  for (const account of accounts) {
    const collected = await collectAccount(client, account, limit, signal);
    cursors.push(collected.cursor);
    diagnostics.push(...collected.diagnostics);
    for (const reference of collected.references) {
      if (globalReviews.has(reference.reviewId)) continue;
      globalReviews.add(reference.reviewId);
      references.push(reference);
    }
  }
  return { references, cursors, diagnostics };
}

/** Rebuild a resolved article from the library, or undefined when it is not held. */
async function resolveFromLibrary(
  library: PublicAccountLibrary,
  reference: ArticleReference,
): Promise<ResolvedArticle | undefined> {
  const stored = await library.getArticle(reference.reviewId);
  if (stored === undefined || stored.review.review === undefined) return undefined;

  const source: RetrievedSource = {
    state: stored.state,
    sourceUrl: stored.sourceUrl ?? "",
    // Replayed, not discarded. A "partial" article whose paywall diagnostic went missing left the
    // second artifact unable to explain its own partialCount.
    diagnostics: stored.diagnostics ?? [],
    ...(stored.contentHtml === undefined ? {} : { contentHtml: stored.contentHtml }),
    ...(stored.markdown === undefined ? {} : { markdown: stored.markdown }),
    ...(stored.sourceBytes === undefined ? {} : { nativeBytes: stored.sourceBytes }),
    ...(stored.fallbackHtml === undefined ? {} : { fallbackHtml: stored.fallbackHtml }),
    ...(stored.sourceSha256 === undefined ? {} : { sourceSha256: stored.sourceSha256 }),
    ...(stored.sourceByteLength === undefined ? {} : { sourceByteLength: stored.sourceByteLength }),
  };

  return {
    ...reference,
    accountName: stored.mpInfo?.mp_name ?? reference.accountTitle ?? reference.accountId,
    response: stored.review,
    review: stored.review.review,
    ...(stored.mpInfo === undefined ? {} : { mpInfo: stored.mpInfo }),
    publicationTime: stored.publicationTime ?? 0,
    title: stored.title ?? reference.reviewId,
    source,
    state: stored.state,
  };
}

/** Store a freshly retrieved article, without letting a storage failure fail the retrieval. */
async function rememberArticle(
  library: PublicAccountLibrary,
  article: ResolvedArticle,
  diagnostics: PublicAccountDiagnostic[],
): Promise<void> {
  // Unsupported bodies and previews reached after a failed entitlement lookup must be retried;
  // storing either would make a transient refusal permanent on the ordinary read path.
  if (article.state === "unsupported" || article.source === undefined || article.source.cacheable === false) return;
  try {
    await library.putArticle({
      reviewId: article.reviewId,
      state: article.state,
      review: article.response,
      accountId: article.accountId,
      title: article.title,
      publicationTime: article.publicationTime,
      sourceUrl: article.source.sourceUrl,
      ...(article.mpInfo === undefined ? {} : { mpInfo: article.mpInfo }),
      ...(article.source.nativeBytes === undefined ? {} : { sourceBytes: article.source.nativeBytes }),
      ...(article.source.sourceByteLength === undefined ? {} : { sourceByteLength: article.source.sourceByteLength }),
      ...(article.source.markdown === undefined ? {} : { markdown: article.source.markdown }),
      ...(article.source.contentHtml === undefined ? {} : { contentHtml: article.source.contentHtml }),
      ...(article.source.fallbackHtml === undefined ? {} : { fallbackHtml: article.source.fallbackHtml }),
      ...(article.source.diagnostics.length === 0 ? {} : { diagnostics: article.source.diagnostics }),
    });
  } catch (cause) {
    diagnostics.push(
      diagnostic(
        "SOURCE_CONTENT_INSUFFICIENT",
        `article could not be stored locally: ${errorMessage(cause)}`,
        article,
        {
          cause,
        },
      ),
    );
  }
}

async function resolveReferences(
  client: PublicAccountClient,
  references: ArticleReference[],
  signal: AbortSignal | undefined,
  diagnostics: PublicAccountDiagnostic[],
  library?: PublicAccountLibrary,
  libraryMode: PublicAccountLibraryMode = "prefer",
): Promise<ResolvedArticle[]> {
  const resolved: ResolvedArticle[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      const reference = references[index];
      if (!reference) return;
      signal?.throwIfAborted();

      if (library && libraryMode === "prefer") {
        // Both requests this skips are expensive: the review detail, and the article body from
        // mp.weixin.qq.com, which rate-limits and serves CAPTCHAs. In "refresh" mode the read is
        // skipped but the write below still happens, so --refresh repairs a stored article rather
        // than bypassing it for one run.
        const stored = await resolveFromLibrary(library, reference).catch(() => undefined);
        if (stored) {
          resolved.push(stored);
          if (stored.source) diagnostics.push(...stored.source.diagnostics);
          continue;
        }
      }

      let response: ReviewSingleResponse;
      try {
        response = await client.review.single(reference.reviewId, { signal });
      } catch (cause) {
        if (signal?.aborted) throw cause;
        if (
          cause instanceof AuthError ||
          (cause instanceof WeReadApiError && (cause.status === 401 || cause.errCode === -2012))
        ) {
          throw cause;
        }
        diagnostics.push(
          diagnostic("ARTICLE_UNAVAILABLE", `article detail is unavailable: ${errorMessage(cause)}`, reference, {
            cause,
          }),
        );
        continue;
      }
      if (!response.review || typeof response.review !== "object") {
        diagnostics.push(diagnostic("ARTICLE_UNAVAILABLE", "article detail has no review", reference));
        continue;
      }

      const mpInfo = response.review.mpInfo;
      const source = mpInfo ? await retrieveSource(reference, mpInfo, signal, client) : undefined;
      if (source) diagnostics.push(...source.diagnostics);
      else diagnostics.push(diagnostic("SOURCE_CONTENT_INSUFFICIENT", "article detail has no mpInfo", reference));
      const publicationTime =
        typeof mpInfo?.time === "number"
          ? mpInfo.time
          : typeof response.review.createTime === "number"
            ? response.review.createTime
            : typeof reference.article.createTime === "number"
              ? reference.article.createTime
              : 0;
      const article: ResolvedArticle = {
        ...reference,
        accountName: mpInfo?.mp_name ?? reference.accountTitle ?? reference.accountId,
        response,
        review: response.review,
        mpInfo,
        publicationTime,
        title: mpInfo?.title ?? reference.article.title ?? response.review.title ?? reference.reviewId,
        source,
        state: source?.state ?? "unsupported",
      };
      resolved.push(article);
      if (library) await rememberArticle(library, article, diagnostics);
    }
  };
  await Promise.all([worker(), worker()]);
  return resolved;
}

async function collectArticles(
  client: PublicAccountClient,
  source: PublicAccountFeedSource,
  limit: number,
  signal?: AbortSignal,
  library?: PublicAccountLibrary,
  libraryMode?: PublicAccountLibraryMode,
): Promise<CollectedArticles> {
  const collected = await collectReferences(client, source, limit, signal);
  const articles = await resolveReferences(
    client,
    collected.references,
    signal,
    collected.diagnostics,
    library,
    libraryMode,
  );
  articles.sort(
    (left, right) =>
      right.publicationTime - left.publicationTime ||
      (left.reviewId < right.reviewId ? -1 : left.reviewId > right.reviewId ? 1 : 0),
  );
  return {
    articles: articles.slice(0, limit),
    cursors: collected.cursors,
    diagnostics: collected.diagnostics,
  };
}

function publicationDate(value: number): Date {
  if (!Number.isFinite(value) || value <= 0) return new Date(0);
  const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function jsonFeed(title: string, articles: ResolvedArticle[]): string {
  return JSON.stringify(
    {
      version: "https://jsonfeed.org/version/1.1",
      title,
      items: articles.map((article) => ({
        id: article.reviewId,
        url: article.source?.sourceUrl,
        title: article.title,
        content_html: article.source?.contentHtml,
        ...(article.publicationTime > 0
          ? { date_published: publicationDate(article.publicationTime).toISOString() }
          : {}),
        authors: [{ name: article.accountName }],
        _weread_account: { id: article.accountId, name: article.accountName },
      })),
    },
    null,
    2,
  );
}

export async function buildPublicAccountFeed(
  client: PublicAccountClient,
  source: PublicAccountFeedSource,
  options: PublicAccountFeedOptions,
): Promise<PublicAccountFeedResult> {
  if (source === null || typeof source !== "object" || (source.kind !== "account" && source.kind !== "subscriptions")) {
    throw new TypeError("invalid feed source");
  }
  if (options.format !== "rss" && options.format !== "atom" && options.format !== "json") {
    throw new TypeError("format must be rss, atom, or json");
  }
  const limit = limitOf(options.limit);
  const collected = await collectArticles(client, source, limit, options.signal, options.library, options.libraryMode);
  const articles = collected.articles.filter(
    (article) =>
      article.state !== "unsupported" && article.source?.contentHtml !== undefined && article.source.sourceUrl !== "",
  );
  const title =
    source.kind === "account"
      ? `${articles[0]?.accountName ?? source.accountId} — WeRead public-account articles`
      : "WeRead public-account subscriptions";

  let content: string;
  if (options.format === "json") {
    content = jsonFeed(title, articles);
  } else {
    const updated = publicationDate(articles[0]?.publicationTime ?? 0);
    const feed = new Feed({
      title,
      id: source.kind === "account" ? `urn:weread:${source.accountId}` : "urn:weread:public-account-subscriptions",
      link: "https://weread.qq.com/",
      updated,
      generator: "weread-omni",
    });
    for (const article of articles) {
      const date = publicationDate(article.publicationTime);
      feed.addItem({
        title: article.title,
        id: `urn:weread:review:${encodeURIComponent(article.reviewId)}`,
        guid: article.reviewId,
        link: article.source?.sourceUrl ?? "",
        date,
        published: date,
        content: article.source?.contentHtml,
        author: [{ name: article.accountName }],
        category: [{ name: article.accountId }],
      });
    }
    content = options.format === "rss" ? feed.rss2() : feed.atom1();
  }
  return {
    format: options.format,
    content,
    itemCount: articles.length,
    cursors: collected.cursors,
    diagnostics: collected.diagnostics,
  };
}

async function writeExclusive(path: string, value: string | Uint8Array): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(value);
  } finally {
    await handle.close();
  }
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function artifactCode(cause: unknown): PublicAccountArtifactErrorCode {
  return (cause as NodeJS.ErrnoException | undefined)?.code === "EEXIST"
    ? "ARTIFACT_EXISTS"
    : "ARTIFACT_PUBLISH_FAILED";
}

export async function publishPublicAccountFeed(path: string, content: string): Promise<void> {
  if (typeof path !== "string" || path.trim() === "") throw new TypeError("path must not be blank");
  const destination = resolve(path);
  let opened = false;
  try {
    const handle = await open(destination, "wx", 0o600);
    opened = true;
    try {
      await handle.chmod(0o600);
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
  } catch (cause) {
    const code = artifactCode(cause);
    throw new PublicAccountArtifactError(`could not publish feed at ${destination}: ${errorMessage(cause)}`, {
      code,
      path: destination,
      incomplete: opened,
      cause,
    });
  }
}

export async function exportPublicAccountArchive(
  client: PublicAccountClient,
  accountId: string,
  options: PublicAccountArchiveOptions,
): Promise<PublicAccountArchiveResult> {
  assertAccountId(accountId);
  const limit = limitOf(options.limit);
  if (typeof options.directory !== "string" || options.directory.trim() === "") {
    throw new TypeError("directory must not be blank");
  }
  options.signal?.throwIfAborted();
  const destination = resolve(options.directory);
  let created = false;
  try {
    await mkdir(destination, { mode: 0o700 });
    created = true;
    await chmod(destination, 0o700);
  } catch (cause) {
    throw new PublicAccountArtifactError(`could not create archive at ${destination}: ${errorMessage(cause)}`, {
      code: artifactCode(cause),
      path: destination,
      incomplete: created,
      cause,
    });
  }

  try {
    const collected = await collectArticles(
      client,
      { kind: "account", accountId },
      limit,
      options.signal,
      options.library,
      options.libraryMode,
    );
    const items: PublicAccountArchiveItem[] = [];
    for (const article of collected.articles) {
      options.signal?.throwIfAborted();
      const directory = `review-${encodeURIComponent(article.reviewId)}`;
      const articleDirectory = join(destination, directory);
      await mkdir(articleDirectory, { mode: 0o700 });
      await chmod(articleDirectory, 0o700);
      await writeExclusive(
        join(articleDirectory, "metadata.json"),
        json({
          accountId: article.accountId,
          article: article.article,
          review: article.response,
        }),
      );

      let mpInfo: "mp-info.json" | undefined;
      if (article.mpInfo) {
        mpInfo = "mp-info.json";
        await writeExclusive(join(articleDirectory, mpInfo), json(article.mpInfo));
      }
      let articleFile: "article.md" | undefined;
      if (article.source?.markdown) {
        articleFile = "article.md";
        await writeExclusive(join(articleDirectory, articleFile), `${article.source.markdown.replace(/\n*$/, "\n")}`);
      }
      let source: "source.html" | "fallback.html" | undefined;
      if (article.source?.nativeBytes) {
        source = "source.html";
        await writeExclusive(join(articleDirectory, source), article.source.nativeBytes);
      } else if (article.source?.fallbackHtml !== undefined) {
        source = "fallback.html";
        await writeExclusive(join(articleDirectory, source), article.source.fallbackHtml);
      }

      items.push({
        accountId: article.accountId,
        reviewId: article.reviewId,
        state: article.state,
        directory,
        metadata: "metadata.json",
        ...(mpInfo ? { mpInfo } : {}),
        ...(articleFile ? { article: articleFile } : {}),
        ...(source ? { source } : {}),
        ...(article.source?.sourceUrl ? { sourceUrl: article.source.sourceUrl } : {}),
        ...(article.source?.sourceSha256 ? { sourceSha256: article.source.sourceSha256 } : {}),
        ...(article.source?.sourceByteLength === undefined
          ? {}
          : { sourceByteLength: article.source.sourceByteLength }),
      });
    }

    const manifest: PublicAccountArchiveManifest = {
      version: 1,
      accountId,
      createdAt: new Date().toISOString(),
      itemCount: items.length,
      completeCount: items.filter((item) => item.state === "complete").length,
      partialCount: items.filter((item) => item.state === "partial").length,
      unsupportedCount: items.filter((item) => item.state === "unsupported").length,
      cursors: collected.cursors,
      diagnostics: collected.diagnostics,
      items,
    };
    try {
      const pendingManifest = join(destination, ".manifest.json.tmp");
      await writeExclusive(pendingManifest, json(manifest));
      await rename(pendingManifest, join(destination, "manifest.json"));
    } catch (cause) {
      throw new PublicAccountArtifactError(`could not publish archive manifest: ${errorMessage(cause)}`, {
        code: "ARTIFACT_PUBLISH_FAILED",
        path: destination,
        incomplete: true,
        cause,
      });
    }
    return { path: destination, manifest };
  } catch (cause) {
    if (cause instanceof PublicAccountArtifactError) throw cause;
    throw new PublicAccountArtifactError(`archive is incomplete at ${destination}: ${errorMessage(cause)}`, {
      code:
        (cause as NodeJS.ErrnoException | undefined)?.code === undefined
          ? "ARTIFACT_INCOMPLETE"
          : "ARTIFACT_PUBLISH_FAILED",
      path: destination,
      incomplete: true,
      cause,
    });
  }
}
