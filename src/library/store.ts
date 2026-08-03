import { mkdirSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type {
  ArticleMpInfo,
  BookInfo,
  ChapterContent,
  ChapterInfoResponse,
  PublicAccountDiagnostic,
  PutArticleInput,
  ReviewSingleResponse,
  StorableArticleState,
  StoredArticle,
} from "../api/types.js";
import { emitLog, type Logger } from "../logger.js";
import { type BlobRef, BlobStore } from "./blobs.js";
import { openDatabase, transact, withRetry } from "./database.js";
import { LibraryStoreError } from "./errors.js";
import { blobsDirectory, checkedChapterUid, checkedIdentifier, databasePath, libraryRoot } from "./paths.js";

const DIRECTORY_MODE = 0o700;

/** Any tag-like construct. An XHTML chapter body always has one; a preview has none. */
const MARKUP = /<[a-zA-Z!?/]/;

/**
 * Does this look like a paywall preview rather than a chapter?
 *
 * A locked chapter comes back as HTTP 200 in the same shape a real one uses: a short plain-text
 * excerpt, the opening paragraphs followed by an ellipsis. Nothing downstream distinguishes it, so
 * without this the library stores the excerpt as the chapter body -- permanently, since content is
 * never re-fetched once stored, and `verify` reports it clean because the bytes match their digest.
 *
 * The test is structural rather than length-based. An `epub` chapter body is an XHTML document and
 * a preview carries no markup at all; measured across one book's 41 chapters every real body
 * contains a tag and every preview contains none. Length would misfire in both directions -- a
 * copyright page is legitimately ~120 characters, the same size as a preview. `txt` chapters are
 * exempt because plain text is their correct shape, and there is no known preview in that format.
 */
export function isPaywallPreview(content: ChapterContent): boolean {
  return content.format === "epub" && !MARKUP.test(content.html ?? "");
}

/** Which backend produced a chapter listing. Synckey spaces differ, so they never compare. */
export type TocBackend = "official" | "eink";

export interface ContentLibraryOptions {
  /** WeRead account identity. Content is entitlement-scoped, so rows are per account. */
  vid: string;
  env?: NodeJS.ProcessEnv;
  /** Overrides the environment-resolved root. */
  root?: string;
  logger?: Logger;
}

export interface ChapterMetadata {
  origin?: string;
  tocSynckey?: number;
  chapterIdx?: number;
  title?: string;
}

export interface LibraryStats {
  chapters: number;
  /** Stored chapter listings. Counted separately: a book can have an index but no bodies yet. */
  chapterIndexes: number;
  /**
   * Payloads retained because a refresh displaced them.
   *
   * Reported because nothing reclaims them. Retention is deliberate -- a refetch that returns a
   * challenge page must not erase good content -- but growth that cannot be measured is
   * indistinguishable from a leak.
   */
  supersededVersions: number;
  books: number;
  articles: number;
  blobs: number;
  blobBytes: number;
}

interface ChapterRow {
  format: "epub" | "txt";
  html_sha256: string;
  css_sha256: string | null;
  text_sha256: string | null;
}

interface ArticleRow {
  mp_account_id: string | null;
  title: string | null;
  publication_time: number | null;
  source_url: string | null;
  state: StorableArticleState;
  source_sha256: string | null;
  source_byte_length: number | null;
  markdown_sha256: string | null;
  content_html_sha256: string | null;
  fallback_html_sha256: string | null;
  mp_info_json: string | null;
  review_json: string;
  diagnostics_json: string | null;
}

/** Stored JSON that will not parse is damage, and damage on a read path is a miss. */
function parseJson<T>(text: string, logger: Logger | undefined, label: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    emitLog(logger, "warn", `stored ${label} is not valid JSON`);
    return undefined;
  }
}

/**
 * Every digest one account's rows point at.
 *
 * Takes the account id once; the parameter is reused across the union by name so the caller binds
 * a single value.
 */
const REFERENCED_DIGESTS = `
  SELECT html_sha256 FROM chapter WHERE account_id = :account
  UNION SELECT css_sha256 FROM chapter WHERE account_id = :account AND css_sha256 IS NOT NULL
  UNION SELECT text_sha256 FROM chapter WHERE account_id = :account AND text_sha256 IS NOT NULL
  UNION SELECT source_sha256 FROM article WHERE account_id = :account AND source_sha256 IS NOT NULL
  UNION SELECT markdown_sha256 FROM article WHERE account_id = :account AND markdown_sha256 IS NOT NULL
  UNION SELECT content_html_sha256 FROM article WHERE account_id = :account AND content_html_sha256 IS NOT NULL
  UNION SELECT fallback_html_sha256 FROM article WHERE account_id = :account AND fallback_html_sha256 IS NOT NULL
  UNION SELECT sha256 FROM content_version WHERE account_id = :account
`;

interface BlobRow {
  sha256: string;
  byte_length: number;
  media_type: string | null;
}

/**
 * Local store of downloaded content.
 *
 * Records and indexes live in SQLite; payload bytes live in the content-addressed blob store. The
 * split is deliberate: identity lookups want an index, and payloads want to be streamable and
 * deduplicated.
 *
 * Read failures degrade to a miss rather than an error, because the caller's remedy is to fetch
 * again. Write failures are surfaced, because silently not storing defeats the entire point.
 */
export class ContentLibrary {
  readonly #database: DatabaseSync;
  readonly #blobs: BlobStore;
  readonly #accountId: number;
  readonly #logger?: Logger;
  readonly #statements = new Map<string, StatementSync>();
  readonly root: string;
  readonly #schemaWasMissing: boolean;

  private constructor(info: {
    database: DatabaseSync;
    blobs: BlobStore;
    accountId: number;
    root: string;
    logger?: Logger;
    schemaWasMissingFromExistingFile: boolean;
  }) {
    this.#database = info.database;
    this.#blobs = info.blobs;
    this.#accountId = info.accountId;
    this.#logger = info.logger;
    this.root = info.root;
    this.#schemaWasMissing = info.schemaWasMissingFromExistingFile;
  }

  static async open(options: ContentLibraryOptions): Promise<ContentLibrary> {
    const vid = checkedIdentifier(options.vid, "vid");
    const root = options.root ?? libraryRoot(options.env);
    mkdirSync(root, { recursive: true, mode: DIRECTORY_MODE });
    await chmod(root, DIRECTORY_MODE);

    const blobs = new BlobStore({ root, logger: options.logger });
    await blobs.prepare();

    const env = options.env ?? process.env;
    const allowUnsafe = /^(?:1|true|yes)$/i.test(env.WEREAD_LIBRARY_ALLOW_UNSAFE ?? "");
    const { database, schemaWasMissingFromExistingFile } = await openDatabase({
      path: databasePath(root),
      logger: options.logger,
      allowUnsafe,
    });

    try {
      const accountId = await withRetry(() =>
        transact(database, () => {
          database.prepare("INSERT OR IGNORE INTO account (vid) VALUES (?)").run(vid);
          const row = database.prepare("SELECT id FROM account WHERE vid = ?").get(vid) as { id: number };
          return row.id;
        }),
      );
      return new ContentLibrary({
        database,
        blobs,
        accountId,
        root,
        logger: options.logger,
        schemaWasMissingFromExistingFile,
      });
    } catch (error) {
      // `openDatabase` guards its own failures, but everything after it ran outside any guard: a
      // busy database here left the connection, its write-ahead log and a read lock open for the
      // rest of the command, throttling the sibling processes that caused the contention.
      database.close();
      throw error;
    }
  }

  close(): void {
    // Checkpoint so a normally-exited process leaves a self-contained main database file rather
    // than one whose content is still only in the write-ahead log.
    try {
      this.#database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // A checkpoint is an optimisation for the next reader, never a correctness requirement.
    }
    this.#database.close();
  }

  #prepared(sql: string): StatementSync {
    let statement = this.#statements.get(sql);
    if (statement === undefined) {
      statement = this.#database.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }

  // ---- chapters ---------------------------------------------------------------------------

  /**
   * Whether a chapter is stored *and* its payload is present.
   *
   * The blob check is not redundant. Rows live in the database and bytes live on disk, so a
   * restored backup, an unmounted volume or a partial copy can leave one without the other. If
   * `has` answered from the row alone it would report content that `get` cannot produce, and a
   * caller that trusts it would emit nothing at all rather than fetching.
   */
  has(bookId: string, chapterUid: number): boolean {
    const row = this.#chapterRow(bookId, chapterUid);
    if (row === undefined) return false;
    return this.#blobsPresent(row) && !this.#storedPaywallPreview(bookId, chapterUid, row);
  }

  #blobsPresent(row: ChapterRow): boolean {
    for (const digest of [row.html_sha256, row.css_sha256, row.text_sha256]) {
      if (digest === null) continue;
      // The recorded length is passed so this cannot disagree with the read path, which rejects a
      // file whose size does not match what the row says.
      const blob = this.#prepared("SELECT byte_length FROM blob WHERE sha256 = ?").get(digest) as
        | { byte_length: number }
        | undefined;
      if (blob === undefined) return false;
      if (!this.#blobs.has({ sha256: digest, byteLength: blob.byte_length })) return false;
    }
    return true;
  }

  #chapterRow(bookId: string, chapterUid: number): ChapterRow | undefined {
    return this.#prepared(
      `SELECT format, html_sha256, css_sha256, text_sha256 FROM chapter
       WHERE account_id = ? AND book_id = ? AND chapter_uid = ?`,
    ).get(this.#accountId, checkedIdentifier(bookId, "bookId"), checkedChapterUid(chapterUid)) as
      | ChapterRow
      | undefined;
  }

  #storedPaywallPreview(bookId: string, chapterUid: number, row: ChapterRow): boolean {
    if (row.format !== "epub") return false;
    const blob = this.#prepared("SELECT byte_length FROM blob WHERE sha256 = ?").get(row.html_sha256) as
      | { byte_length: number }
      | undefined;
    if (blob === undefined) return false;
    const html = this.#blobs.readTextSync({ sha256: row.html_sha256, byteLength: blob.byte_length });
    return html !== undefined && isPaywallPreview({ bookId, chapterUid, format: "epub", html });
  }

  /**
   * Which of `chapterUids` are absent.
   *
   * Optimistic by contract: a later `getChapterContent` miss means fetch, never means the content
   * does not exist. One indexed scan rather than a query per chapter, and no bound-parameter list,
   * which would cap out well before a long serial does.
   */
  missing(bookId: string, chapterUids: readonly number[]): number[] {
    const checkedBookId = checkedIdentifier(bookId, "bookId");
    const stored = new Map(
      (
        this.#prepared(
          `SELECT chapter_uid, format, html_sha256, css_sha256, text_sha256 FROM chapter
           WHERE account_id = ? AND book_id = ?`,
        ).all(this.#accountId, checkedBookId) as unknown as Array<ChapterRow & { chapter_uid: number }>
      ).map((row) => [row.chapter_uid, row]),
    );
    return chapterUids.filter((uid) => {
      const checkedUid = checkedChapterUid(uid);
      const row = stored.get(checkedUid);
      return row === undefined || this.#storedPaywallPreview(checkedBookId, checkedUid, row);
    });
  }

  async getChapterContent(bookId: string, chapterUid: number): Promise<ChapterContent | undefined> {
    const row = this.#chapterRow(bookId, chapterUid);
    if (row === undefined) return undefined;

    const html = await this.#readBlob(row.html_sha256);
    if (html === undefined) return undefined;

    if (row.format === "txt") {
      const text = row.text_sha256 === null ? undefined : await this.#readBlob(row.text_sha256);
      if (text === undefined) return undefined;
      return { bookId, chapterUid, format: "txt", text, html };
    }

    const css = row.css_sha256 === null ? undefined : await this.#readBlob(row.css_sha256);
    // A recorded stylesheet that cannot be read is damage, not an absent stylesheet: returning the
    // chapter without it would silently serve different content than was stored.
    if (row.css_sha256 !== null && css === undefined) return undefined;
    const content: ChapterContent = {
      bookId,
      chapterUid,
      format: "epub",
      html,
      ...(css === undefined ? {} : { css }),
    };
    // Libraries written before previews were refused still hold them. Degrading to a miss here is
    // what lets those self-heal: the caller refetches, and an entitled refetch replaces the row.
    if (isPaywallPreview(content)) {
      emitLog(this.#logger, "warn", `stored chapter ${bookId}/${chapterUid} is a paywall preview; refetching`);
      return undefined;
    }
    return content;
  }

  async #readBlob(sha256: string): Promise<string | undefined> {
    const row = this.#prepared("SELECT sha256, byte_length, media_type FROM blob WHERE sha256 = ?").get(sha256) as
      | BlobRow
      | undefined;
    if (row === undefined) return undefined;
    return this.#blobs.readText({ sha256: row.sha256, byteLength: row.byte_length });
  }

  /**
   * Store one chapter.
   *
   * Blob files are written and made durable first, then a single transaction inserts the blob rows
   * and the chapter row together. A crash between the two leaves an unreferenced file, which costs
   * disk; the reverse order would leave a row pointing at bytes that do not exist, which costs
   * correctness.
   *
   * A paywall preview is refused before any blob is written, so a refusal leaks nothing.
   */
  async putChapterContent(content: ChapterContent, meta: ChapterMetadata = {}): Promise<void> {
    const bookId = checkedIdentifier(content.bookId, "bookId");
    const chapterUid = checkedChapterUid(content.chapterUid);
    if (isPaywallPreview(content)) {
      emitLog(this.#logger, "debug", `declining to store a paywall preview for ${bookId}/${chapterUid}`);
      return;
    }

    const html = await this.#blobs.put(Buffer.from(content.html, "utf8"), { mediaType: "application/xhtml+xml" });
    const css =
      content.format === "epub" && content.css !== undefined && content.css !== ""
        ? await this.#blobs.put(Buffer.from(content.css, "utf8"), { mediaType: "text/css" })
        : undefined;
    const text =
      content.format === "txt"
        ? await this.#blobs.put(Buffer.from(content.text, "utf8"), { mediaType: "text/plain" })
        : undefined;

    const now = new Date().toISOString();
    try {
      await this.#transact(() => {
        for (const ref of [html, css, text]) {
          if (ref !== undefined) this.#insertBlobRow(ref, now);
        }
        this.#supersede("chapter", `${bookId}/${chapterUid}`, bookId, chapterUid, now);
        this.#database
          .prepare(
            `INSERT INTO chapter
               (account_id, book_id, chapter_uid, format, html_sha256, css_sha256, text_sha256,
                toc_synckey, chapter_idx, title, origin, stored_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(account_id, book_id, chapter_uid) DO UPDATE SET
               format = excluded.format, html_sha256 = excluded.html_sha256,
               css_sha256 = excluded.css_sha256, text_sha256 = excluded.text_sha256,
               toc_synckey = excluded.toc_synckey, chapter_idx = excluded.chapter_idx,
               title = excluded.title, origin = excluded.origin, stored_at = excluded.stored_at`,
          )
          .run(
            this.#accountId,
            bookId,
            chapterUid,
            content.format,
            html.sha256,
            css?.sha256 ?? null,
            text?.sha256 ?? null,
            meta.tocSynckey ?? null,
            meta.chapterIdx ?? null,
            meta.title ?? null,
            meta.origin ?? "eink",
            now,
          );
      });
    } catch (error) {
      throw new LibraryStoreError("failed to store chapter content", { cause: error });
    }
  }

  /**
   * Record the digests a chapter is about to stop referencing.
   *
   * Append-only, so a second refresh cannot destroy what the first one displaced. A refetch that
   * returns a challenge page or a truncated body must not be able to erase good content.
   */
  #supersede(kind: "chapter", entityKey: string, bookId: string, chapterUid: number, now: string): void {
    const previous = this.#database
      .prepare(
        `SELECT html_sha256, css_sha256, text_sha256 FROM chapter
         WHERE account_id = ? AND book_id = ? AND chapter_uid = ?`,
      )
      .get(this.#accountId, bookId, chapterUid) as ChapterRow | undefined;
    if (previous === undefined) return;

    const insert = this.#database.prepare(
      `INSERT INTO content_version (account_id, kind, entity_key, role, sha256, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const roles: [string, string | null][] = [
      ["html", previous.html_sha256],
      ["css", previous.css_sha256],
      ["text", previous.text_sha256],
    ];
    for (const [role, sha256] of roles) {
      if (sha256 !== null) insert.run(this.#accountId, kind, entityKey, role, sha256, now);
    }
  }

  /**
   * Retain the payloads an article is about to stop referencing.
   *
   * The chapter path has always done this; articles did not, even though the schema declares the
   * `article` kind. A refetch that returns a challenge page could therefore erase a good body --
   * exactly the case the retention exists to prevent.
   */
  #supersedeArticle(reviewId: string, now: string): void {
    const previous = this.#database
      .prepare(
        `SELECT source_sha256, markdown_sha256, content_html_sha256, fallback_html_sha256
         FROM article WHERE account_id = ? AND review_id = ?`,
      )
      .get(this.#accountId, reviewId) as
      | {
          source_sha256: string | null;
          markdown_sha256: string | null;
          content_html_sha256: string | null;
          fallback_html_sha256: string | null;
        }
      | undefined;
    if (previous === undefined) return;

    const insert = this.#database.prepare(
      `INSERT INTO content_version (account_id, kind, entity_key, role, sha256, superseded_at)
       VALUES (?, 'article', ?, ?, ?, ?)`,
    );
    const roles: [string, string | null][] = [
      ["source", previous.source_sha256],
      ["markdown", previous.markdown_sha256],
      ["html", previous.content_html_sha256],
      ["text", previous.fallback_html_sha256],
    ];
    for (const [role, sha256] of roles) {
      if (sha256 !== null) insert.run(this.#accountId, reviewId, role, sha256, now);
    }
  }

  #insertBlobRow(ref: BlobRef, now: string): void {
    this.#database
      .prepare("INSERT OR IGNORE INTO blob (sha256, byte_length, media_type, stored_at) VALUES (?, ?, ?, ?)")
      .run(ref.sha256, ref.byteLength, ref.mediaType ?? null, now);
  }

  async #transact<T>(work: () => T): Promise<T> {
    return withRetry(() => transact(this.#database, work));
  }

  // ---- book metadata and chapter index ------------------------------------------------------

  getBookInfo(bookId: string): BookInfo | undefined {
    const row = this.#prepared("SELECT info_json FROM book_meta WHERE account_id = ? AND book_id = ?").get(
      this.#accountId,
      checkedIdentifier(bookId, "bookId"),
    ) as { info_json: string } | undefined;
    if (row === undefined) return undefined;
    try {
      return JSON.parse(row.info_json) as BookInfo;
    } catch {
      emitLog(this.#logger, "warn", "stored book metadata is not valid JSON");
      return undefined;
    }
  }

  /**
   * Store book metadata, rejecting the empty response an unguarded upstream cast can produce.
   *
   * `origin` is write-only provenance: nothing reads the column back, it exists so a damaged row can
   * be traced to whatever fetched it. It defaults to this package's only backend; an extension
   * client that fetched the content somewhere else passes its own.
   */
  putBookInfo(bookId: string, info: BookInfo, origin = "eink"): void {
    const identifier = checkedIdentifier(bookId, "bookId");
    if (info.title === undefined && info.author === undefined) {
      emitLog(this.#logger, "debug", "declining to store book metadata with neither title nor author");
      return;
    }
    const now = new Date().toISOString();
    transact(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO book_meta (account_id, book_id, info_json, origin, stored_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(account_id, book_id) DO UPDATE SET
             info_json = excluded.info_json, origin = excluded.origin, stored_at = excluded.stored_at`,
        )
        .run(this.#accountId, identifier, JSON.stringify(info), origin, now);
    });
  }

  getChapterIndex(bookId: string, backend: TocBackend): ChapterInfoResponse | undefined {
    const row = this.#prepared(
      "SELECT synckey, chapter_update_time, chapters_json FROM book_toc WHERE account_id = ? AND book_id = ? AND backend = ?",
    ).get(this.#accountId, checkedIdentifier(bookId, "bookId"), backend) as
      | { synckey: number; chapter_update_time: number | null; chapters_json: string }
      | undefined;
    if (row === undefined) return undefined;
    try {
      return {
        bookId,
        synckey: row.synckey,
        // Restored only when upstream sent it, so a stored listing matches the shape a live one
        // has rather than gaining or losing a key on the way through.
        ...(row.chapter_update_time === null ? {} : { chapterUpdateTime: row.chapter_update_time }),
        chapters: JSON.parse(row.chapters_json),
      };
    } catch {
      emitLog(this.#logger, "warn", "a stored chapter index is not valid JSON");
      return undefined;
    }
  }

  /**
   * Store a chapter listing, keeping whichever synckey is higher.
   *
   * A single statement rather than read-compare-write: the comparison happens inside SQLite, so a
   * concurrent writer cannot land between the read and the write.
   *
   * A listing with no chapters, or with synckey zero, is refused. Upstream returns both as
   * well-formed responses when it is degraded, and storing one would serve an empty book forever.
   */
  putChapterIndex(response: ChapterInfoResponse, backend: TocBackend): void {
    const bookId = checkedIdentifier(response.bookId, "bookId");
    const chapters = response.chapters ?? [];
    if (chapters.length === 0 || !Number.isSafeInteger(response.synckey) || response.synckey <= 0) {
      emitLog(this.#logger, "debug", "declining to store a degraded chapter index");
      return;
    }
    const now = new Date().toISOString();
    transact(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO book_toc
             (account_id, book_id, backend, synckey, chapter_count, chapter_update_time, chapters_json, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, book_id, backend) DO UPDATE SET
             synckey = excluded.synckey, chapter_count = excluded.chapter_count,
             chapter_update_time = excluded.chapter_update_time,
             chapters_json = excluded.chapters_json, fetched_at = excluded.fetched_at
           WHERE excluded.synckey > book_toc.synckey`,
        )
        .run(
          this.#accountId,
          bookId,
          backend,
          response.synckey,
          chapters.length,
          response.chapterUpdateTime ?? null,
          JSON.stringify(chapters),
          now,
        );
    });
  }

  // ---- public-account articles ---------------------------------------------------------------

  /**
   * Read one stored article, or undefined if it is absent or unusable.
   *
   * Every payload the caller might need is loaded here rather than lazily, because the two
   * consumers -- the feed and the archive export -- each need a different subset, and a lazy
   * accessor would make a partially damaged article look complete until whichever field they
   * happened to touch came back empty.
   */
  async getArticle(reviewId: string): Promise<StoredArticle | undefined> {
    const row = this.#prepared(
      `SELECT mp_account_id, title, publication_time, source_url, state,
              source_sha256, source_byte_length, markdown_sha256, content_html_sha256,
              fallback_html_sha256, mp_info_json, review_json, diagnostics_json
       FROM article WHERE account_id = ? AND review_id = ?`,
    ).get(this.#accountId, checkedIdentifier(reviewId, "reviewId")) as ArticleRow | undefined;
    if (row === undefined) return undefined;

    const review = parseJson<ReviewSingleResponse>(row.review_json, this.#logger, "article review");
    if (review === undefined) return undefined;

    const source = row.source_sha256 === null ? undefined : await this.#readBlobBytes(row.source_sha256);
    if (row.source_sha256 !== null && source === undefined) return undefined;
    const markdown = row.markdown_sha256 === null ? undefined : await this.#readBlob(row.markdown_sha256);
    if (row.markdown_sha256 !== null && markdown === undefined) return undefined;
    const contentHtml = row.content_html_sha256 === null ? undefined : await this.#readBlob(row.content_html_sha256);
    if (row.content_html_sha256 !== null && contentHtml === undefined) return undefined;
    const fallbackHtml = row.fallback_html_sha256 === null ? undefined : await this.#readBlob(row.fallback_html_sha256);
    if (row.fallback_html_sha256 !== null && fallbackHtml === undefined) return undefined;

    // Damage here is a miss like everywhere else on this path. Returning the key present but
    // undefined produced a half-article: the archive silently dropped mp-info.json and the
    // manifest entry, with no refetch and no diagnostic.
    const mpInfo =
      row.mp_info_json === null
        ? undefined
        : parseJson<ArticleMpInfo>(row.mp_info_json, this.#logger, "article mpInfo");
    if (row.mp_info_json !== null && mpInfo === undefined) return undefined;

    return {
      reviewId,
      state: row.state,
      review,
      ...(row.mp_account_id === null ? {} : { accountId: row.mp_account_id }),
      ...(row.title === null ? {} : { title: row.title }),
      ...(row.publication_time === null ? {} : { publicationTime: row.publication_time }),
      ...(row.source_url === null ? {} : { sourceUrl: row.source_url }),
      ...(mpInfo === undefined ? {} : { mpInfo }),
      ...(row.diagnostics_json === null
        ? {}
        : {
            diagnostics:
              parseJson<PublicAccountDiagnostic[]>(row.diagnostics_json, this.#logger, "article diagnostics") ?? [],
          }),
      ...(source === undefined ? {} : { sourceBytes: source, sourceSha256: row.source_sha256 ?? undefined }),
      ...(row.source_byte_length === null ? {} : { sourceByteLength: row.source_byte_length }),
      ...(markdown === undefined ? {} : { markdown }),
      ...(contentHtml === undefined ? {} : { contentHtml }),
      ...(fallbackHtml === undefined ? {} : { fallbackHtml }),
    };
  }

  /**
   * Store one article and everything needed to reproduce it.
   *
   * An article with no payload at all is declined rather than stored: it would report as present
   * and then produce nothing, which is worse than a miss.
   */
  async putArticle(input: PutArticleInput): Promise<void> {
    const reviewId = checkedIdentifier(input.reviewId, "reviewId");
    const text = async (value: string | undefined, mediaType: string) =>
      value === undefined || value === "" ? undefined : this.#blobs.put(Buffer.from(value, "utf8"), { mediaType });

    const source =
      input.sourceBytes === undefined || input.sourceBytes.byteLength === 0
        ? undefined
        : await this.#blobs.put(input.sourceBytes, { mediaType: "text/html" });
    const markdown = await text(input.markdown, "text/markdown");
    const contentHtml = await text(input.contentHtml, "text/html");
    const fallbackHtml = await text(input.fallbackHtml, "text/html");

    if (source === undefined && markdown === undefined && contentHtml === undefined && fallbackHtml === undefined) {
      emitLog(this.#logger, "debug", "declining to store an article with no content");
      return;
    }

    const now = new Date().toISOString();
    try {
      await this.#transact(() => {
        for (const ref of [source, markdown, contentHtml, fallbackHtml]) {
          if (ref !== undefined) this.#insertBlobRow(ref, now);
        }
        this.#supersedeArticle(reviewId, now);
        this.#database
          .prepare(
            `INSERT INTO article
               (account_id, review_id, mp_account_id, title, publication_time, source_url, state,
                source_sha256, source_byte_length, markdown_sha256, content_html_sha256,
                fallback_html_sha256, mp_info_json, review_json, diagnostics_json, stored_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(account_id, review_id) DO UPDATE SET
               mp_account_id = excluded.mp_account_id, title = excluded.title,
               publication_time = excluded.publication_time, source_url = excluded.source_url,
               state = excluded.state, source_sha256 = excluded.source_sha256,
               source_byte_length = excluded.source_byte_length,
               markdown_sha256 = excluded.markdown_sha256,
               content_html_sha256 = excluded.content_html_sha256,
               fallback_html_sha256 = excluded.fallback_html_sha256,
               mp_info_json = excluded.mp_info_json, review_json = excluded.review_json,
               diagnostics_json = excluded.diagnostics_json, stored_at = excluded.stored_at`,
          )
          .run(
            this.#accountId,
            reviewId,
            input.accountId ?? null,
            input.title ?? null,
            input.publicationTime ?? null,
            input.sourceUrl ?? null,
            input.state,
            source?.sha256 ?? null,
            input.sourceByteLength ?? source?.byteLength ?? null,
            markdown?.sha256 ?? null,
            contentHtml?.sha256 ?? null,
            fallbackHtml?.sha256 ?? null,
            input.mpInfo === undefined ? null : JSON.stringify(input.mpInfo),
            JSON.stringify(input.review),
            input.diagnostics === undefined || input.diagnostics.length === 0
              ? null
              : JSON.stringify(input.diagnostics),
            now,
          );
      });
    } catch (error) {
      throw new LibraryStoreError("failed to store article", { cause: error });
    }
  }

  async #readBlobBytes(sha256: string): Promise<Uint8Array | undefined> {
    const row = this.#prepared("SELECT sha256, byte_length, media_type FROM blob WHERE sha256 = ?").get(sha256) as
      | BlobRow
      | undefined;
    if (row === undefined) return undefined;
    return this.#blobs.read({ sha256: row.sha256, byteLength: row.byte_length });
  }

  // ---- maintenance -------------------------------------------------------------------------

  stats(): LibraryStats {
    const one = (sql: string): number =>
      (this.#prepared(sql).get(this.#accountId) as { n: number } | undefined)?.n ?? 0;
    // Scoped like every other count here. A global aggregate reported another account's holdings
    // to a caller that owns none of them -- a fresh account showed zero content and a nonzero byte
    // total, which is both incoherent and a small metadata leak across the boundary the rows keep.
    const blobs = this.#prepared(`SELECT COUNT(*) AS n, COALESCE(SUM(byte_length), 0) AS bytes FROM blob
       WHERE sha256 IN (${REFERENCED_DIGESTS})`).get({ account: this.#accountId }) as { n: number; bytes: number };
    return {
      chapters: one("SELECT COUNT(*) AS n FROM chapter WHERE account_id = ?"),
      chapterIndexes: one("SELECT COUNT(*) AS n FROM book_toc WHERE account_id = ?"),
      supersededVersions: one("SELECT COUNT(*) AS n FROM content_version WHERE account_id = ?"),
      books: one("SELECT COUNT(*) AS n FROM book_meta WHERE account_id = ?"),
      articles: one("SELECT COUNT(*) AS n FROM article WHERE account_id = ?"),
      blobs: blobs.n,
      blobBytes: Number(blobs.bytes),
    };
  }

  /**
   * Check the database and every referenced blob.
   *
   * `PRAGMA integrity_check` alone is not enough: it reports a structurally valid database as
   * healthy even when it holds no rows at all, which is exactly what copying `library.db` without
   * its write-ahead log produces.
   */
  /** Whether any payload file exists on disk, without walking the whole tree. */
  async #blobFilesExist(): Promise<boolean> {
    const { opendir } = await import("node:fs/promises");
    try {
      const shards = await opendir(blobsDirectory(this.root));
      try {
        for await (const shard of shards) {
          if (!shard.isDirectory()) continue;
          const entries = await opendir(join(blobsDirectory(this.root), shard.name));
          try {
            for await (const entry of entries) if (entry.isFile()) return true;
          } finally {
            await entries.close().catch(() => undefined);
          }
        }
      } finally {
        await shards.close().catch(() => undefined);
      }
    } catch {
      // No blob directory at all is an empty library, not damage.
    }
    return false;
  }

  async verify(): Promise<{ ok: boolean; problems: string[] }> {
    const problems: string[] = [];
    const integrity = this.#database.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
    if (integrity.integrity_check !== "ok") problems.push(`database integrity: ${integrity.integrity_check}`);

    // `integrity_check` is about page structure and answers "ok" for a row pointing at a digest
    // that no longer has a blob row -- which a damaged restore, or any external write made with
    // foreign keys off, can leave behind. Reads through such a reference fail while the library
    // reports itself healthy.
    const dangling = this.#database.prepare("PRAGMA foreign_key_check").all() as unknown as { table?: string }[];
    for (const violation of dangling) {
      problems.push(`dangling reference in ${violation.table ?? "an unknown table"}`);
    }

    // Payload files with no rows pointing at them is the signature of a lost database -- most
    // often `library.db` copied without its write-ahead log, which is the backup a user actually
    // attempts. Checking for absent tables cannot detect it: `open` runs the migration first and
    // silently rebuilds an empty schema, so by the time this runs the tables always exist.
    if (this.#schemaWasMissing) {
      problems.push("the database file existed but carried no schema; it was probably copied without its -wal file");
    }
    const rows = (this.#prepared("SELECT COUNT(*) AS n FROM blob").get() as { n: number }).n;
    if (rows === 0 && (await this.#blobFilesExist())) {
      problems.push("payload files are present but the database references none of them");
    }

    const blobs = this.#database
      .prepare("SELECT sha256, byte_length, media_type FROM blob")
      .all() as unknown as BlobRow[];
    for (const row of blobs) {
      const bytes = await this.#blobs.read({ sha256: row.sha256, byteLength: row.byte_length });
      if (bytes === undefined) problems.push(`blob ${row.sha256.slice(0, 12)} is missing or unreadable`);
    }
    return { ok: problems.length === 0, problems };
  }
}
