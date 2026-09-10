import { basename, resolve } from "node:path";
import { type Command, InvalidArgumentError, Option } from "commander";
import type { CanonicalClient } from "../api/client.js";
import type { MobileApiClient } from "../api/mobile-client.js";
import {
  assertOperationParameter,
  assertReadReviewQueries,
  type IntegerParameter,
  OPERATIONS,
  type OperationParameter,
  parameterHelp,
  READ_DATA_MODES,
} from "../api/operation-spec.js";
import { PUBLIC_OPERATIONS } from "../api/operations.js";
import type {
  AddBookmarkInput,
  PublicAccountFeedFormat,
  PublicAccountLibrary,
  PublicAccountLibraryMode,
  ReadDataOptions,
  ReadReviewQuery,
  SearchScope,
  StarRating,
  UpdateBookmarkInput,
} from "../api/types.js";
import {
  buildPublicAccountFeed,
  exportPublicAccountArchive,
  PublicAccountReadError,
  publishPublicAccountFeed,
  readPublicAccountArticle,
} from "../public-accounts.js";
import { shelfView } from "../shelf-view.js";
import { type OutputWriter, output } from "./output.js";

export interface CommandContext<TClient extends CliOperationsClient = MobileApiClient> {
  getClient: () => TClient;
  stdout: OutputWriter;
  confirm: (message: string) => Promise<boolean>;
  isTTY: boolean;
  signal?: AbortSignal;
}

type CliResource = keyof typeof PUBLIC_OPERATIONS;
type CliMethod<Resource extends CliResource> = Extract<
  (typeof PUBLIC_OPERATIONS)[Resource][number],
  keyof CanonicalClient[Resource]
>;

export type CliOperation = {
  [Resource in CliResource]: `${Resource & string}.${CliMethod<Resource> & string}`;
}[CliResource];

/** Canonical operations a programmatic CLI store may implement. */
export type CliOperationsClient = {
  readonly [Resource in CliResource]?: {
    readonly [Method in CliMethod<Resource>]?: CanonicalClient[Resource][Method];
  };
};

type ClientForOne<Operation extends CliOperation> = Operation extends `${infer Resource}.${infer Method}`
  ? Resource extends CliResource
    ? Method extends CliMethod<Resource>
      ? { readonly [Key in Resource]: { readonly [Action in Method]: CanonicalClient[Resource][Action] } }
      : never
    : never
  : never;

type UnionToIntersection<Value> = (Value extends unknown ? (argument: Value) => void : never) extends (
  argument: infer Intersection,
) => void
  ? Intersection
  : never;

export type CliClientFor<Operation extends CliOperation> = UnionToIntersection<ClientForOne<Operation>>;

export const CLI_OPERATIONS: readonly CliOperation[] = Object.freeze(
  Object.entries(PUBLIC_OPERATIONS).flatMap(([resource, methods]) =>
    methods.map((method) => `${resource}.${method}` as CliOperation),
  ),
);

interface BuiltinCommandContext {
  getClientFor<const Operations extends readonly [CliOperation, ...CliOperation[]]>(
    ...operations: Operations
  ): CliClientFor<Operations[number]>;
  /** Artifact helpers need both public-account pages and review detail. */
  getFullClientFor?: (...operations: CliOperation[]) => Pick<CanonicalClient, "publicAccounts" | "review">;
  /**
   * The content library, when one is open.
   *
   * Threaded explicitly rather than reached through the client: article bodies come from
   * mp.weixin.qq.com through module-private helpers, so the client decorator cannot see them.
   */
  library?: PublicAccountLibrary;
  /** Whether stored articles are read. `--refresh` still writes; it only declines to read. */
  libraryMode?: PublicAccountLibraryMode;
  stdout: OutputWriter;
  confirm: (message: string) => Promise<boolean>;
  isTTY: boolean;
  signal?: AbortSignal;
}

const kebab = (value: string): string => value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** Remove canonical leaves that no configured store and active gate can execute. */
export function retainCliOperations(program: Command, operations: ReadonlySet<CliOperation>): void {
  if (
    !["publicAccounts.resolveArticle", "publicAccounts.paidContent", "review.single"].every((operation) =>
      operations.has(operation as CliOperation),
    )
  ) {
    const resource = program.commands.find((command) => command.name() === "public-accounts");
    const index = resource?.commands.findIndex((command) => command.name() === "read-article") ?? -1;
    if (resource && index >= 0) (resource.commands as Command[]).splice(index, 1);
  }
  for (const operation of CLI_OPERATIONS) {
    if (operations.has(operation)) continue;
    const [resourceName, actionName] = operation.split(".") as [string, string];
    const resource = program.commands.find((command) => command.name() === kebab(resourceName));
    if (!resource) continue;
    const action = resource.commands.findIndex((command) => command.name() === kebab(actionName));
    if (action >= 0) (resource.commands as Command[]).splice(action, 1);
  }
  for (const resourceName of Object.keys(PUBLIC_OPERATIONS).map(kebab)) {
    const index = program.commands.findIndex(
      (command) => command.name() === resourceName && command.commands.length === 0,
    );
    if (index >= 0) (program.commands as Command[]).splice(index, 1);
  }
}

export function integer(value: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new InvalidArgumentError("expected an integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError("expected an integer");
  }
  return parsed;
}

function checkedNumber(name: string, parameter: OperationParameter, value: string): number {
  const parsed = integer(value);
  try {
    assertOperationParameter(name, parameter, parsed);
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : `invalid ${name}`);
  }
  return parsed;
}

const integerFor =
  (name: string, parameter: IntegerParameter) =>
  (value: string): number =>
    checkedNumber(name, parameter, value);

function rating(value: string): StarRating {
  return checkedNumber("star", OPERATIONS.reviewAdd.parameters.star, value) as StarRating;
}

function scope(value: string): SearchScope {
  return checkedNumber("scope", OPERATIONS.searchBooks.parameters.scope, value) as SearchScope;
}

function publicAccountId(value: string): string {
  try {
    assertOperationParameter("accountId", OPERATIONS.publicAccountsArticles.parameters.accountId, value);
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : "invalid public-account ID");
  }
  return value;
}

function publicAccountSource(value: string): string {
  return value === "subscriptions" ? value : publicAccountId(value);
}

function artifactLimit(value: string): number {
  const parsed = integer(value);
  if (parsed < 1 || parsed > 100) throw new InvalidArgumentError("limit must be from 1 to 100");
  return parsed;
}

function artifactPath(value: string): string {
  if (!value.trim()) throw new InvalidArgumentError("output path must not be blank");
  return value;
}

function reviewQueries(value: string): ReadReviewQuery[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidArgumentError("expected a JSON array of review range queries");
  }
  try {
    assertReadReviewQueries(parsed);
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : "invalid review range queries");
  }
  return parsed;
}

export function port(value: string): number {
  const parsed = integer(value);
  if (parsed < 0 || parsed > 65_535) {
    throw new InvalidArgumentError("expected a TCP port between 0 and 65535");
  }
  return parsed;
}

function resource(program: Command, name: string, description: string): Command {
  return program.commands.find((command) => command.name() === name) ?? program.command(name).description(description);
}

/** @internal Shared so lifecycle commands print exactly like operation commands do. */
export const human = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2) ?? "null";
};

async function emit(
  command: Command,
  context: Pick<BuiltinCommandContext, "stdout">,
  result: Promise<unknown>,
): Promise<void> {
  emitValue(command, context, await result);
}

function emitValue(command: Command, context: Pick<BuiltinCommandContext, "stdout">, value: unknown): void {
  output(value, { json: Boolean(command.optsWithGlobals().json), stdout: context.stdout }, human);
}

interface SyncCliOptions {
  synckey?: number;
}

interface NotebooksCliOptions {
  count?: number;
  lastSort?: number;
}

interface RecentNotesCliOptions {
  count?: number;
}

interface ShelfCliOptions {
  count?: number;
  offset?: number;
  full?: boolean;
}

interface PublicAccountPageCliOptions extends SyncCliOptions {
  count?: number;
  offset?: number;
}

interface PublicAccountFeedCliOptions {
  format: PublicAccountFeedFormat;
  out: string;
  limit?: number;
}

interface PublicAccountExportCliOptions {
  out: string;
  limit?: number;
}

interface NotesCliOptions extends SyncCliOptions {
  count?: number;
  maxIdx?: number;
  chapterUid?: number;
}

interface ReviewListCliOptions extends SyncCliOptions {
  listType?: number;
  listMode?: number;
  mine?: number;
  count?: number;
  maxIdx?: number;
}

interface SearchCliOptions {
  scope?: SearchScope;
  count?: number;
  maxIdx?: number;
}

interface ReviewSingleCliOptions extends SyncCliOptions {
  commentsCount?: number;
  commentsDirection?: 0 | 1;
  likesCount?: number;
  likesDirection?: 0 | 1;
}

interface PageCliOptions {
  count?: number;
  maxIdx?: number;
  sessionId?: string;
}

interface AskBookCliOptions {
  intent?: string;
  maxPolls?: number;
  delayCapMs?: number;
}

interface SuggestCliOptions {
  chapterUid?: number;
  toolbar: boolean;
  range?: string;
  mpReviewId?: string;
}

interface ConfirmCliOptions {
  yes?: boolean;
}

interface ReviewAddCliOptions {
  star?: StarRating;
  type?: number;
  range?: string;
  abstract?: string;
  chapterUid?: number;
}

interface AddBookmarkCliOptions {
  type?: number;
  style?: number;
  colorStyle?: number;
  bookVersion?: number;
  chapterName?: string;
  contextAbstract?: string;
}

interface UpdateBookmarkCliOptions {
  style: number;
  colorStyle?: number;
}

export function registerReadCommands(program: Command, context: BuiltinCommandContext): void {
  const search = resource(program, "search", "Search the WeRead catalog");
  search
    .command("books <keyword>")
    .description("Search any WeRead catalog tab (ebooks by default)")
    .option("--scope <number>", parameterHelp(OPERATIONS.searchBooks.parameters.scope), scope)
    .option(
      "--count <number>",
      parameterHelp(OPERATIONS.searchBooks.parameters.count),
      integerFor("count", OPERATIONS.searchBooks.parameters.count),
    )
    .option(
      "--max-idx <number>",
      parameterHelp(OPERATIONS.searchBooks.parameters.maxIdx),
      integerFor("maxIdx", OPERATIONS.searchBooks.parameters.maxIdx),
    )
    .action((keyword: string, options: SearchCliOptions, command: Command) =>
      emit(command, context, context.getClientFor("search.books").search.books(keyword, options)),
    );
  search
    .command("suggest <keyword>")
    .description("Suggest search completions")
    .option(
      "--count <number>",
      parameterHelp(OPERATIONS.searchSuggest.parameters.count),
      integerFor("count", OPERATIONS.searchSuggest.parameters.count),
    )
    .action((keyword: string, options: SearchCliOptions, command: Command) =>
      emit(command, context, context.getClientFor("search.suggest").search.suggest(keyword, options)),
    );

  const book = resource(program, "book", "Inspect books");
  const bookDescriptions = {
    info: "Get a book's metadata",
    detail: "Get a book's images and related catalogs",
    chapters: "List a book's chapters",
    progress: "Get reading progress for a book",
  } as const;
  for (const action of ["info", "detail", "chapters", "progress"] as const) {
    const command = book.command(`${action} <bookId>`).description(bookDescriptions[action]);
    if (action === "detail") {
      command
        .option(
          "--count <number>",
          parameterHelp(OPERATIONS.bookDetail.parameters.count),
          integerFor("count", OPERATIONS.bookDetail.parameters.count),
        )
        .action((bookId: string, options: PageCliOptions, actionCommand: Command) =>
          emit(actionCommand, context, context.getClientFor("book.detail").book.detail(bookId, options)),
        );
    } else {
      command.action((bookId: string, _options: unknown, actionCommand: Command) =>
        emit(actionCommand, context, context.getClientFor(`book.${action}`).book[action](bookId)),
      );
    }
  }

  resource(program, "shelf", "Manage the bookshelf")
    .command("sync")
    .description("List the active bookshelf")
    .addOption(
      new Option("--count <number>", parameterHelp(OPERATIONS.shelfSync.parameters.count))
        .argParser(integerFor("count", OPERATIONS.shelfSync.parameters.count))
        .conflicts("full"),
    )
    .addOption(
      new Option("--offset <number>", parameterHelp(OPERATIONS.shelfSync.parameters.offset))
        .argParser(integerFor("offset", OPERATIONS.shelfSync.parameters.offset))
        .conflicts("full"),
    )
    .addOption(new Option("--full", "return the complete upstream shelf sync payload").conflicts(["count", "offset"]))
    .action((options: ShelfCliOptions, command: Command) => {
      const raw = context.getClientFor("shelf.sync").shelf.sync();
      return emit(command, context, options.full ? raw : raw.then((response) => shelfView(response, options)));
    });

  const publicAccounts = resource(program, "public-accounts", "Discover and archive public accounts");
  publicAccounts
    .command("subscriptions")
    .description("List subscribed public accounts")
    .option(
      "--count <number>",
      parameterHelp(OPERATIONS.publicAccountsSubscriptions.parameters.count),
      integerFor("count", OPERATIONS.publicAccountsSubscriptions.parameters.count),
    )
    .option(
      "--offset <number>",
      parameterHelp(OPERATIONS.publicAccountsSubscriptions.parameters.offset),
      integerFor("offset", OPERATIONS.publicAccountsSubscriptions.parameters.offset),
    )
    .action((options: PublicAccountPageCliOptions, command: Command) =>
      emit(
        command,
        context,
        context.getClientFor("publicAccounts.subscriptions").publicAccounts.subscriptions({
          count: options.count,
          offset: options.offset,
          ...(context.signal ? { signal: context.signal } : {}),
        }),
      ),
    );
  publicAccounts
    .command("articles")
    .description("List a public account's article history")
    .argument("<accountId>", "public-account ID", publicAccountId)
    .option(
      "--count <number>",
      parameterHelp(OPERATIONS.publicAccountsArticles.parameters.count),
      integerFor("count", OPERATIONS.publicAccountsArticles.parameters.count),
    )
    .addOption(
      new Option("--synckey <number>", parameterHelp(OPERATIONS.publicAccountsArticles.parameters.synckey))
        .argParser(integerFor("synckey", OPERATIONS.publicAccountsArticles.parameters.synckey))
        .conflicts("offset"),
    )
    .addOption(
      new Option("--offset <number>", parameterHelp(OPERATIONS.publicAccountsArticles.parameters.offset))
        .argParser(integerFor("offset", OPERATIONS.publicAccountsArticles.parameters.offset))
        .conflicts("synckey"),
    )
    .action((accountId: string, options: PublicAccountPageCliOptions, command: Command) =>
      emit(
        command,
        context,
        context.getClientFor("publicAccounts.articles").publicAccounts.articles(accountId, {
          count: options.count,
          ...(options.synckey === undefined ? {} : { synckey: options.synckey }),
          offset: options.offset,
          ...(context.signal ? { signal: context.signal } : {}),
        }),
      ),
    );
  publicAccounts
    .command("resolve-article <docUrl>")
    .description("Resolve a public article URL to its WeRead review ID")
    .action((docUrl: string, _options: unknown, command: Command) =>
      emit(
        command,
        context,
        context.getClientFor("publicAccounts.resolveArticle").publicAccounts.resolveArticle(docUrl, {
          ...(context.signal ? { signal: context.signal } : {}),
        }),
      ),
    );
  publicAccounts
    .command("read-article <docUrl>")
    .description("Read one public article as Markdown, with source and cache status")
    .action(async (docUrl: string, _options: unknown, command: Command) => {
      const client = context.getClientFor(
        "publicAccounts.resolveArticle",
        "publicAccounts.paidContent",
        "review.single",
      );
      const result = await readPublicAccountArticle(client, docUrl, {
        signal: context.signal,
        library: context.library,
        libraryMode: context.libraryMode,
      });
      if (result.status === "unavailable") throw new PublicAccountReadError(result);
      output(result, { json: command.optsWithGlobals().json === true, stdout: context.stdout }, (article) =>
        [
          article.title,
          article.sourceUrl,
          article.fromCache ? `Cached: ${article.cachedAt ?? "unknown"}` : `Fetched: ${article.fetchedAt ?? "unknown"}`,
          article.status === "partial"
            ? "Partial content (preview)."
            : "Readable content; full-text completeness is unverified.",
          "",
          article.markdown ?? article.contentHtml,
        ]
          .filter((line) => line !== null)
          .join("\n"),
      );
    });
  if (context.getFullClientFor) {
    const getFullClientFor = context.getFullClientFor;
    publicAccounts
      .command("feed")
      .description("Build a private public-account feed")
      .argument("<accountId|subscriptions>", "public-account ID or all subscriptions", publicAccountSource)
      .addOption(new Option("--format <format>", "feed format").choices(["rss", "atom", "json"]).makeOptionMandatory())
      .requiredOption("--out <file>", "exclusive output file", artifactPath)
      .option("--limit <number>", "maximum items (default: 20, max: 100)", artifactLimit)
      .action(async (source: string, options: PublicAccountFeedCliOptions, command: Command) => {
        const client =
          source === "subscriptions"
            ? getFullClientFor(
                "publicAccounts.subscriptions",
                "publicAccounts.articles",
                "publicAccounts.paidContent",
                "review.single",
              )
            : getFullClientFor("publicAccounts.articles", "publicAccounts.paidContent", "review.single");
        const result = await buildPublicAccountFeed(
          client,
          source === "subscriptions" ? { kind: "subscriptions" } : { kind: "account", accountId: source },
          {
            format: options.format,
            limit: options.limit,
            signal: context.signal,
            library: context.library,
            libraryMode: context.libraryMode,
          },
        );
        const path = resolve(options.out);
        await publishPublicAccountFeed(path, result.content);
        emitValue(command, context, { path, format: result.format, itemCount: result.itemCount });
      });
    publicAccounts
      .command("export")
      .description("Export a private lossless public-account archive")
      .argument("<accountId>", "public-account ID", publicAccountId)
      .requiredOption("--out <directory>", "exclusive archive directory", artifactPath)
      .option("--limit <number>", "maximum articles (default: 20, max: 100)", artifactLimit)
      .action(async (accountId: string, options: PublicAccountExportCliOptions, command: Command) => {
        const result = await exportPublicAccountArchive(
          getFullClientFor("publicAccounts.articles", "publicAccounts.paidContent", "review.single"),
          accountId,
          {
            directory: options.out,
            limit: options.limit,
            signal: context.signal,
            library: context.library,
            libraryMode: context.libraryMode,
          },
        );
        const { manifest } = result;
        emitValue(command, context, {
          path: result.path,
          accountId,
          itemCount: manifest.itemCount,
          completeCount: manifest.completeCount,
          partialCount: manifest.partialCount,
          unsupportedCount: manifest.unsupportedCount,
        });
      });
  }

  const notes = resource(program, "notes", "Read notes and highlights");
  notes
    .command("notebooks")
    .description("List notebooks that have highlights or notes")
    .option(
      "--count <number>",
      parameterHelp(OPERATIONS.notesNotebooks.parameters.count),
      integerFor("count", OPERATIONS.notesNotebooks.parameters.count),
    )
    .option(
      "--last-sort <number>",
      parameterHelp(OPERATIONS.notesNotebooks.parameters.lastSort),
      integerFor("lastSort", OPERATIONS.notesNotebooks.parameters.lastSort),
    )
    .action((options: NotebooksCliOptions, command: Command) =>
      emit(command, context, context.getClientFor("notes.notebooks").notes.notebooks(options)),
    );
  notes
    .command("recent")
    .description("List recent notes and highlights across the account")
    .option(
      "--count <number>",
      parameterHelp(OPERATIONS.notesRecent.parameters.count),
      integerFor("count", OPERATIONS.notesRecent.parameters.count),
    )
    .action((options: RecentNotesCliOptions, command: Command) =>
      emit(command, context, context.getClientFor("notes.recent").notes.recent(options)),
    );
  notes
    .command("bookmarks <bookId>")
    .description("List a book's highlights with their text")
    .option(
      "--synckey <number>",
      parameterHelp(OPERATIONS.notesBookmarks.parameters.synckey),
      integerFor("synckey", OPERATIONS.notesBookmarks.parameters.synckey),
    )
    .action((bookId: string, options: SyncCliOptions, command: Command) =>
      emit(command, context, context.getClientFor("notes.bookmarks").notes.bookmarks(bookId, options)),
    );
  notes
    .command("mine <bookId>")
    .description("List the user's own notes and reviews for a book")
    .option(
      "--synckey <number>",
      parameterHelp(OPERATIONS.notesMine.parameters.synckey),
      integerFor("synckey", OPERATIONS.notesMine.parameters.synckey),
    )
    .option(
      "--count <number>",
      parameterHelp(OPERATIONS.notesMine.parameters.count),
      integerFor("count", OPERATIONS.notesMine.parameters.count),
    )
    .action((bookId: string, options: NotesCliOptions, command: Command) =>
      emit(command, context, context.getClientFor("notes.mine").notes.mine(bookId, options)),
    );
  notes
    .command("best <bookId>")
    .description("List a book's most-popular highlights")
    .option(
      "--synckey <number>",
      parameterHelp(OPERATIONS.notesBest.parameters.synckey),
      integerFor("synckey", OPERATIONS.notesBest.parameters.synckey),
    )
    .option(
      "--count <number>",
      parameterHelp(OPERATIONS.notesBest.parameters.count),
      integerFor("count", OPERATIONS.notesBest.parameters.count),
    )
    .option(
      "--max-idx <number>",
      parameterHelp(OPERATIONS.notesBest.parameters.maxIdx),
      integerFor("maxIdx", OPERATIONS.notesBest.parameters.maxIdx),
    )
    .option(
      "--chapter-uid <number>",
      parameterHelp(OPERATIONS.notesBest.parameters.chapterUid),
      integerFor("chapterUid", OPERATIONS.notesBest.parameters.chapterUid),
    )
    .action((bookId: string, options: NotesCliOptions, command: Command) =>
      emit(command, context, context.getClientFor("notes.best").notes.best(bookId, options)),
    );
  notes
    .command("read-reviews <bookId> <chapterUid>")
    .description("Read thoughts attached to popular-highlight ranges")
    .requiredOption("--reviews <json>", "JSON array of {range,count?,maxIdx?,synckey?}", reviewQueries)
    .action((bookId: string, chapterUid: string, options: { reviews: ReadReviewQuery[] }, command: Command) =>
      emit(
        command,
        context,
        context
          .getClientFor("notes.readReviews")
          .notes.readReviews(
            bookId,
            checkedNumber("chapterUid", OPERATIONS.notesReadReviews.parameters.chapterUid, chapterUid),
            options.reviews,
          ),
      ),
    );
  notes
    .command("underlines <bookId> <chapterUid>")
    .description("Show per-chapter highlight statistics")
    .option(
      "--synckey <number>",
      parameterHelp(OPERATIONS.notesUnderlines.parameters.synckey),
      integerFor("synckey", OPERATIONS.notesUnderlines.parameters.synckey),
    )
    .action((bookId: string, chapterUid: string, options: SyncCliOptions, command: Command) =>
      emit(
        command,
        context,
        context
          .getClientFor("notes.underlines")
          .notes.underlines(
            bookId,
            checkedNumber("chapterUid", OPERATIONS.notesUnderlines.parameters.chapterUid, chapterUid),
            options,
          ),
      ),
    );

  const review = resource(program, "review", "Read and manage reviews");
  review
    .command("list <bookId>")
    .description("List reviews for a book")
    .option(
      "--list-type <number>",
      parameterHelp(OPERATIONS.reviewList.parameters.listType),
      integerFor("listType", OPERATIONS.reviewList.parameters.listType),
    )
    .option(
      "--list-mode <number>",
      parameterHelp(OPERATIONS.reviewList.parameters.listMode),
      integerFor("listMode", OPERATIONS.reviewList.parameters.listMode),
    )
    .option(
      "--mine <number>",
      parameterHelp(OPERATIONS.reviewList.parameters.mine),
      integerFor("mine", OPERATIONS.reviewList.parameters.mine),
    )
    .option(
      "--synckey <number>",
      parameterHelp(OPERATIONS.reviewList.parameters.synckey),
      integerFor("synckey", OPERATIONS.reviewList.parameters.synckey),
    )
    .option(
      "--count <number>",
      parameterHelp(OPERATIONS.reviewList.parameters.count),
      integerFor("count", OPERATIONS.reviewList.parameters.count),
    )
    .option(
      "--max-idx <number>",
      parameterHelp(OPERATIONS.reviewList.parameters.maxIdx),
      integerFor("maxIdx", OPERATIONS.reviewList.parameters.maxIdx),
    )
    .action((bookId: string, options: ReviewListCliOptions, command: Command) =>
      emit(
        command,
        context,
        context.getClientFor("review.list").review.list(bookId, {
          listType: options.listType,
          listMode: options.listMode,
          mine: options.mine,
          synckey: options.synckey,
          count: options.count,
          maxIdx: options.maxIdx,
        }),
      ),
    );
  review
    .command("single <reviewId>")
    .description("Get one thought or review")
    .option(
      "--comments-count <number>",
      parameterHelp(OPERATIONS.reviewSingle.parameters.commentsCount),
      integerFor("commentsCount", OPERATIONS.reviewSingle.parameters.commentsCount),
    )
    .option(
      "--comments-direction <number>",
      parameterHelp(OPERATIONS.reviewSingle.parameters.commentsDirection),
      integerFor("commentsDirection", OPERATIONS.reviewSingle.parameters.commentsDirection),
    )
    .option(
      "--likes-count <number>",
      parameterHelp(OPERATIONS.reviewSingle.parameters.likesCount),
      integerFor("likesCount", OPERATIONS.reviewSingle.parameters.likesCount),
    )
    .option(
      "--likes-direction <number>",
      parameterHelp(OPERATIONS.reviewSingle.parameters.likesDirection),
      integerFor("likesDirection", OPERATIONS.reviewSingle.parameters.likesDirection),
    )
    .option(
      "--synckey <number>",
      parameterHelp(OPERATIONS.reviewSingle.parameters.synckey),
      integerFor("synckey", OPERATIONS.reviewSingle.parameters.synckey),
    )
    .action((reviewId: string, options: ReviewSingleCliOptions, command: Command) =>
      emit(command, context, context.getClientFor("review.single").review.single(reviewId, options)),
    );

  resource(program, "read-data", "Inspect reading statistics")
    .command("detail")
    .description("Get aggregated reading statistics")
    .addOption(
      new Option("--mode <mode>", parameterHelp(OPERATIONS.readDataDetail.parameters.mode)).choices([
        ...READ_DATA_MODES,
      ]),
    )
    .option(
      "--base-time <number>",
      parameterHelp(OPERATIONS.readDataDetail.parameters.baseTime),
      integerFor("baseTime", OPERATIONS.readDataDetail.parameters.baseTime),
    )
    .action((options: { mode?: ReadDataOptions["mode"]; baseTime?: number }, command: Command) =>
      emit(command, context, context.getClientFor("readData.detail").readData.detail(options)),
    );

  const discover = resource(program, "discover", "Discover books");
  discover
    .command("recommend")
    .description("Get recommended books")
    .option(
      "--count <number>",
      parameterHelp(OPERATIONS.discoverRecommend.parameters.count),
      integerFor("count", OPERATIONS.discoverRecommend.parameters.count),
    )
    .option(
      "--max-idx <number>",
      parameterHelp(OPERATIONS.discoverRecommend.parameters.maxIdx),
      integerFor("maxIdx", OPERATIONS.discoverRecommend.parameters.maxIdx),
    )
    .action((options: PageCliOptions, command: Command) =>
      emit(command, context, context.getClientFor("discover.recommend").discover.recommend(options)),
    );
  discover
    .command("similar <bookId>")
    .description("Find books similar to a book")
    .option(
      "--count <number>",
      parameterHelp(OPERATIONS.discoverSimilar.parameters.count),
      integerFor("count", OPERATIONS.discoverSimilar.parameters.count),
    )
    .option(
      "--max-idx <number>",
      parameterHelp(OPERATIONS.discoverSimilar.parameters.maxIdx),
      integerFor("maxIdx", OPERATIONS.discoverSimilar.parameters.maxIdx),
    )
    .option("--session-id <id>", "recommendation session")
    .action((bookId: string, options: PageCliOptions, command: Command) =>
      emit(command, context, context.getClientFor("discover.similar").discover.similar(bookId, options)),
    );

  const ai = resource(program, "ai", "Ask WeRead AI");
  ai.command("ask-book <bookId> <query>")
    .description("Ask WeRead AI a question about a book")
    .option("--intent <intent>", "prompt intent")
    .option(
      "--max-polls <number>",
      parameterHelp(OPERATIONS.aiAskBook.parameters.maxPolls),
      integerFor("maxPolls", OPERATIONS.aiAskBook.parameters.maxPolls),
    )
    .option(
      "--delay-cap-ms <milliseconds>",
      parameterHelp(OPERATIONS.aiAskBook.parameters.delayCapMs),
      integerFor("delayCapMs", OPERATIONS.aiAskBook.parameters.delayCapMs),
    )
    .action((bookId: string, query: string, options: AskBookCliOptions, command: Command) =>
      emit(
        command,
        context,
        context.getClientFor("ai.askBook").ai.askBook({
          bookId,
          query,
          intent: options.intent,
          maxPolls: options.maxPolls,
          delayCapMs: options.delayCapMs,
        }),
      ),
    );
  ai.command("suggest <bookId>")
    .description("Get suggested questions for a book")
    .option(
      "--chapter-uid <number>",
      parameterHelp(OPERATIONS.aiSuggest.parameters.chapterUid),
      integerFor("chapterUid", OPERATIONS.aiSuggest.parameters.chapterUid),
    )
    .option("--toolbar", "request toolbar prompts")
    .option("--range <range>", "text range")
    .option("--mp-review-id <id>", "review id")
    .action((bookId: string, options: SuggestCliOptions, command: Command) =>
      emit(
        command,
        context,
        context.getClientFor("ai.suggest").ai.suggest({
          bookId,
          chapterUid: options.chapterUid,
          toolbar: Boolean(options.toolbar),
          range: options.range,
          mpReviewId: options.mpReviewId,
        }),
      ),
    );
}

async function destructive(
  command: Command,
  options: ConfirmCliOptions,
  context: BuiltinCommandContext,
  message: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const json = Boolean(command.optsWithGlobals().json);
  if (!options.yes) {
    if (json || !context.isTTY) {
      throw new Error(`${message} requires --yes in JSON or non-interactive mode`);
    }
    if (!(await context.confirm(`${message}?`))) {
      output({ cancelled: true }, { json: false, stdout: context.stdout }, () => "Cancelled.");
      return;
    }
  }
  await emit(command, context, action());
}

export function registerWriteCommands(program: Command, context: BuiltinCommandContext): void {
  const shelf = resource(program, "shelf", "Manage the bookshelf");
  shelf
    .command("add <bookId>")
    .description("Add a book to the shelf")
    .action((bookId: string, _options: unknown, command: Command) =>
      emit(command, context, context.getClientFor("shelf.add").shelf.add(bookId)),
    );
  shelf
    .command("delete <bookId>")
    .description("Remove a book from the shelf")
    .option("-y, --yes", "skip confirmation")
    .action((bookId: string, options: ConfirmCliOptions, command: Command) =>
      destructive(command, options, context, "Deleting this book", () =>
        context.getClientFor("shelf.delete").shelf.delete(bookId),
      ),
    );
  shelf
    .command("pin <bookId>")
    .description("Pin or unpin a book on the shelf")
    .option("--no-top", "unpin the book")
    .action((bookId: string, options: { top: boolean }, command: Command) =>
      emit(command, context, context.getClientFor("shelf.pin").shelf.pin(bookId, options.top)),
    );
  shelf
    .command("set-private <bookId>")
    .description("Make a book private or public")
    .option("--no-secret", "make the book public")
    .action((bookId: string, options: { secret: boolean }, command: Command) =>
      emit(command, context, context.getClientFor("shelf.setPrivate").shelf.setPrivate(bookId, options.secret)),
    );
  shelf
    .command("mark-finished <bookId>")
    .description("Mark a book finished or unread")
    .option("--no-finished", "mark the book unread")
    .action((bookId: string, options: { finished: boolean }, command: Command) =>
      emit(command, context, context.getClientFor("shelf.markFinished").shelf.markFinished(bookId, options.finished)),
    );
  shelf
    .command("mark-reading <bookId>")
    .description("Mark a book as reading or clear the reading status")
    .option("--no-reading", "clear the reading status")
    .action((bookId: string, options: { reading: boolean }, command: Command) =>
      emit(command, context, context.getClientFor("shelf.markReading").shelf.markReading(bookId, options.reading)),
    );

  const publicAccounts = resource(program, "public-accounts", "Discover and archive public accounts");
  publicAccounts
    .command("paid-content")
    .description("Fetch an entitled paid public-account article body")
    .argument("<docUrl>", "article URL from the review's mpInfo.doc_url")
    .action((docUrl: string, _options: unknown, command: Command) =>
      emit(
        command,
        context,
        context.getClientFor("publicAccounts.paidContent").publicAccounts.paidContent(docUrl, {
          ...(context.signal ? { signal: context.signal } : {}),
        }),
      ),
    );
  publicAccounts
    .command("subscribe")
    .description("Subscribe to a public account")
    .argument("<accountId>", "public-account ID", publicAccountId)
    .action((accountId: string, _options: unknown, command: Command) =>
      emit(
        command,
        context,
        context.signal
          ? context.getClientFor("publicAccounts.subscribe").publicAccounts.subscribe(accountId, {
              signal: context.signal,
            })
          : context.getClientFor("publicAccounts.subscribe").publicAccounts.subscribe(accountId),
      ),
    );
  publicAccounts
    .command("unsubscribe")
    .description("Unsubscribe from a public account")
    .argument("<accountId>", "public-account ID", publicAccountId)
    .option("-y, --yes", "skip confirmation")
    .action((accountId: string, options: ConfirmCliOptions, command: Command) =>
      destructive(command, options, context, "Unsubscribing from this public account", () =>
        context.signal
          ? context.getClientFor("publicAccounts.unsubscribe").publicAccounts.unsubscribe(accountId, {
              signal: context.signal,
            })
          : context.getClientFor("publicAccounts.unsubscribe").publicAccounts.unsubscribe(accountId),
      ),
    );

  const review = resource(program, "review", "Read and manage reviews");
  review
    .command("add <bookId> <content>")
    .description("Add a review to a book")
    .option("--star <number>", parameterHelp(OPERATIONS.reviewAdd.parameters.star), rating)
    .option(
      "--type <number>",
      parameterHelp(OPERATIONS.reviewAdd.parameters.type),
      integerFor("type", OPERATIONS.reviewAdd.parameters.type),
    )
    .option("--range <range>", "text range")
    .option("--abstract <text>", "quoted text")
    .option(
      "--chapter-uid <number>",
      parameterHelp(OPERATIONS.reviewAdd.parameters.chapterUid),
      integerFor("chapterUid", OPERATIONS.reviewAdd.parameters.chapterUid),
    )
    .action((bookId: string, content: string, options: ReviewAddCliOptions, command: Command) =>
      emit(command, context, context.getClientFor("review.add").review.add({ bookId, content, ...options })),
    );
  review
    .command("edit <reviewId> <content>")
    .description("Edit one of your reviews or thoughts")
    .action((reviewId: string, content: string, _options: unknown, command: Command) =>
      emit(
        command,
        context,
        context.signal
          ? context.getClientFor("review.edit").review.edit(reviewId, content, { signal: context.signal })
          : context.getClientFor("review.edit").review.edit(reviewId, content),
      ),
    );
  review
    .command("delete <reviewId>")
    .description("Delete a review")
    .option("-y, --yes", "skip confirmation")
    .action((reviewId: string, options: ConfirmCliOptions, command: Command) =>
      destructive(command, options, context, "Deleting this review", () =>
        context.getClientFor("review.delete").review.delete(reviewId),
      ),
    );

  const notes = resource(program, "notes", "Read notes and highlights");
  notes
    .command("add-bookmark <bookId> <chapterUid> <range> <markText>")
    .description("Add a highlight to a book")
    .option(
      "--type <number>",
      parameterHelp(OPERATIONS.notesAddBookmark.parameters.type),
      integerFor("type", OPERATIONS.notesAddBookmark.parameters.type),
    )
    .option(
      "--style <number>",
      parameterHelp(OPERATIONS.notesAddBookmark.parameters.style),
      integerFor("style", OPERATIONS.notesAddBookmark.parameters.style),
    )
    .option(
      "--color-style <number>",
      parameterHelp(OPERATIONS.notesAddBookmark.parameters.colorStyle),
      integerFor("colorStyle", OPERATIONS.notesAddBookmark.parameters.colorStyle),
    )
    .option(
      "--book-version <number>",
      parameterHelp(OPERATIONS.notesAddBookmark.parameters.bookVersion),
      integerFor("bookVersion", OPERATIONS.notesAddBookmark.parameters.bookVersion),
    )
    .option("--chapter-name <name>", "chapter name")
    .option("--context-abstract <text>", "surrounding context text")
    .action(
      (
        bookId: string,
        chapterUid: string,
        range: string,
        markText: string,
        options: AddBookmarkCliOptions,
        command: Command,
      ) => {
        const input: AddBookmarkInput = {
          bookId,
          chapterUid: checkedNumber("chapterUid", OPERATIONS.notesAddBookmark.parameters.chapterUid, chapterUid),
          range,
          markText,
          ...options,
        };
        return emit(command, context, context.getClientFor("notes.addBookmark").notes.addBookmark(input));
      },
    );
  notes
    .command("update-bookmark <bookmarkId>")
    .description("Change a highlight's style and color")
    .requiredOption(
      "--style <number>",
      parameterHelp(OPERATIONS.notesUpdateBookmark.parameters.style),
      integerFor("style", OPERATIONS.notesUpdateBookmark.parameters.style),
    )
    .option(
      "--color-style <number>",
      parameterHelp(OPERATIONS.notesUpdateBookmark.parameters.colorStyle),
      integerFor("colorStyle", OPERATIONS.notesUpdateBookmark.parameters.colorStyle),
    )
    .action((bookmarkId: string, options: UpdateBookmarkCliOptions, command: Command) => {
      const input: UpdateBookmarkInput = {
        bookmarkId,
        ...options,
        ...(context.signal ? { signal: context.signal } : {}),
      };
      return emit(command, context, context.getClientFor("notes.updateBookmark").notes.updateBookmark(input));
    });
  notes
    .command("remove-bookmark <bookmarkId>")
    .description("Delete one of your highlights")
    .option("-y, --yes", "skip confirmation")
    .action((bookmarkId: string, options: ConfirmCliOptions, command: Command) =>
      destructive(command, options, context, "Deleting this highlight", () =>
        context.signal
          ? context.getClientFor("notes.removeBookmark").notes.removeBookmark(bookmarkId, {
              signal: context.signal,
            })
          : context.getClientFor("notes.removeBookmark").notes.removeBookmark(bookmarkId),
      ),
    );
  resource(program, "import", "Import personal books")
    .command("book <path>")
    .description("Import a personal book file")
    .action((path: string, _options: unknown, command: Command) =>
      emit(command, context, context.getClientFor("import.book").import.book({ name: basename(path), path })),
    );
}
