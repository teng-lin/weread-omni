/**
 * A shelf listing a caller can actually read.
 *
 * `/shelf/sync` answers with the app's own sync payload: 48 fields per book, most of them store and
 * DRM plumbing (`maxFreeInfo`, `otherType`, `payType`, `blockSaveImg`, …), plus a parallel
 * `bookProgress` array keyed only by id. Large shelves serialize to hundreds of kilobytes, and
 * because `bookProgress` is emitted before `books`, whatever truncates such a response first keeps
 * the one block with no titles in it — a listing with nothing to list.
 *
 * So the tool projects. Two things beyond dropping fields:
 *
 * * progress is JOINED onto its book rather than left as a separate id-keyed array, which is what
 *   made it useless on its own;
 * * the result is PAGED, because projection alone does not scale on a tool whose whole job is
 *   listing.
 *
 * The full payload stays available on the SDK and through CLI `shelf sync --full`; agent-facing
 * CLI listings use this projection by default.
 */

/** The page size and its ceiling are declared with the rest of `shelf.sync`'s projected parameters
 * in the operation spec, so the advertised schema and the code that enforces them cannot drift.
 * Re-exported here because this module is where callers already look for them. */
import { DEFAULT_SHELF_COUNT, MAX_SHELF_COUNT } from "./api/operation-spec.js";

export { DEFAULT_SHELF_COUNT, MAX_SHELF_COUNT };

interface RawBook {
  bookId?: unknown;
  title?: unknown;
  author?: unknown;
  translator?: unknown;
  category?: unknown;
  format?: unknown;
  finishReading?: unknown;
  finished?: unknown;
  deepLink?: unknown;
  secret?: unknown;
  isTop?: unknown;
  [key: string]: unknown;
}

interface RawAlbum {
  albumInfo?: {
    albumId?: unknown;
    name?: unknown;
    authorName?: unknown;
    trackCount?: unknown;
    finishStatus?: unknown;
  };
  albumInfoExtra?: { secret?: unknown; isTop?: unknown };
}

interface RawProgress {
  bookId?: unknown;
  progress?: unknown;
  readingTime?: unknown;
  updateTime?: unknown;
  [key: string]: unknown;
}

export interface ShelfBookView {
  bookId: string;
  title?: string;
  author?: string;
  translator?: string;
  category?: string;
  format?: string;
  finished?: boolean;
  deepLink?: string;
  secret?: boolean;
  isTop?: boolean;
  /** Percent read, when the account has opened the book. */
  progress?: number;
  /** Seconds spent reading, when the account has opened the book. */
  readingTime?: number;
}

export interface ShelfAlbumView {
  albumId: string;
  name?: string;
  authorName?: string;
  trackCount?: number;
  finishStatus?: string;
  secret?: boolean;
  isTop?: boolean;
}

export interface ShelfView {
  /** Electronic/imported books only, matching the upstream `bookCount`. */
  bookCount: number;
  albumCount: number;
  /** books + albums + the article-collection entry when present. */
  totalCount: number;
  publicCount: number;
  privateCount: number;
  /** Number of shelf entries in this page. */
  returnedCount: number;
  offset: number;
  /** Absent when the last shelf entry has been returned — its presence is the "call again" signal. */
  nextOffset?: number;
  books: ShelfBookView[];
  albums: ShelfAlbumView[];
  /** The article-collection directory is one private visible shelf entry. */
  mp?: true;
  note: string;
}

const text = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const numeric = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** WeRead uses 0/1 ints for booleans here. */
const bool = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (value === 1) return true;
  if (value === 0) return false;
  return undefined;
};

const positiveInt = (value: unknown, fallback: number): number => {
  const parsed = numeric(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * Narrow a raw `/shelf/sync` body to the fields a listing needs, joining reading progress onto each
 * book and returning one page.
 */
export function shelfView(raw: unknown, options: { count?: unknown; offset?: unknown } = {}): ShelfView {
  const body = (raw ?? {}) as {
    books?: unknown;
    albums?: unknown;
    mp?: unknown;
    bookProgress?: unknown;
    bookCount?: unknown;
  };
  const books = Array.isArray(body.books) ? (body.books as RawBook[]) : [];
  const rawAlbums = Array.isArray(body.albums) ? (body.albums as RawAlbum[]) : [];
  const hasMp =
    body.mp !== null && typeof body.mp === "object" && !Array.isArray(body.mp) && Object.keys(body.mp).length > 0;

  const albums: ShelfAlbumView[] = rawAlbums.map(({ albumInfo = {}, albumInfoExtra = {} }) => ({
    albumId: text(albumInfo.albumId) ?? "",
    ...(text(albumInfo.name) ? { name: text(albumInfo.name) as string } : {}),
    ...(text(albumInfo.authorName) ? { authorName: text(albumInfo.authorName) as string } : {}),
    ...(numeric(albumInfo.trackCount) !== undefined ? { trackCount: numeric(albumInfo.trackCount) as number } : {}),
    ...(text(albumInfo.finishStatus) ? { finishStatus: text(albumInfo.finishStatus) as string } : {}),
    ...(bool(albumInfoExtra.secret) !== undefined ? { secret: bool(albumInfoExtra.secret) as boolean } : {}),
    ...(bool(albumInfoExtra.isTop) !== undefined ? { isTop: bool(albumInfoExtra.isTop) as boolean } : {}),
  }));
  const publicCount =
    books.filter((book) => bool(book.secret) === false).length +
    rawAlbums.filter((album) => bool(album.albumInfoExtra?.secret) === false).length;
  const privateCount =
    books.filter((book) => bool(book.secret) === true).length +
    rawAlbums.filter((album) => bool(album.albumInfoExtra?.secret) === true).length +
    (hasMp ? 1 : 0);
  const totalCount = books.length + albums.length + (hasMp ? 1 : 0);

  const progressById = new Map<string, RawProgress>();
  if (Array.isArray(body.bookProgress)) {
    for (const entry of body.bookProgress as RawProgress[]) {
      const id = text(entry?.bookId);
      if (id) progressById.set(id, entry);
    }
  }

  const project = (book: RawBook): ShelfBookView => {
    const bookId = text(book.bookId) ?? "";
    const progress = progressById.get(bookId);
    const finished = bool(book.finishReading) ?? bool(book.finished);
    // Omit rather than emit nulls: on a large shelf an absent-but-present key costs more than it says.
    return {
      bookId,
      ...(text(book.title) ? { title: text(book.title) as string } : {}),
      ...(text(book.author) ? { author: text(book.author) as string } : {}),
      ...(text(book.translator) ? { translator: text(book.translator) as string } : {}),
      ...(text(book.category) ? { category: text(book.category) as string } : {}),
      ...(text(book.format) ? { format: text(book.format) as string } : {}),
      ...(finished !== undefined ? { finished } : {}),
      ...(text(book.deepLink) ? { deepLink: text(book.deepLink) as string } : {}),
      ...(bool(book.secret) !== undefined ? { secret: bool(book.secret) as boolean } : {}),
      ...(bool(book.isTop) !== undefined ? { isTop: bool(book.isTop) as boolean } : {}),
      ...(numeric(progress?.progress) !== undefined ? { progress: numeric(progress?.progress) as number } : {}),
      ...(numeric(progress?.readingTime) !== undefined
        ? { readingTime: numeric(progress?.readingTime) as number }
        : {}),
    };
  };

  type ShelfEntry = { kind: "book"; value: ShelfBookView } | { kind: "album"; value: ShelfAlbumView } | { kind: "mp" };
  const allEntries: ShelfEntry[] = [
    ...books.map((book): ShelfEntry => ({ kind: "book", value: project(book) })),
    ...albums.map((album): ShelfEntry => ({ kind: "album", value: album })),
    ...(hasMp ? ([{ kind: "mp" }] as const) : []),
  ];
  const requested = positiveInt(options.count, DEFAULT_SHELF_COUNT);
  const count = Math.min(Math.max(requested, 1), MAX_SHELF_COUNT);
  const offset = Math.min(positiveInt(options.offset, 0), allEntries.length);
  const page = allEntries.slice(offset, offset + count);

  const render = (entries: ShelfEntry[]): ShelfView => {
    const end = offset + entries.length;
    const more = end < allEntries.length;
    const pageBooks = entries.flatMap((entry) => (entry.kind === "book" ? [entry.value] : []));
    const pageAlbums = entries.flatMap((entry) => (entry.kind === "album" ? [entry.value] : []));
    const pageHasMp = entries.some((entry) => entry.kind === "mp");
    return {
      bookCount: numeric(body.bookCount) ?? books.length,
      albumCount: albums.length,
      totalCount,
      publicCount,
      privateCount,
      returnedCount: entries.length,
      offset,
      ...(more ? { nextOffset: end } : {}),
      books: pageBooks,
      albums: pageAlbums,
      ...(pageHasMp ? { mp: true as const } : {}),
      note:
        entries.length === 0
          ? `Showing 0 of ${totalCount} shelf entries.`
          : more
            ? `Showing ${offset + 1}-${end} of ${totalCount} shelf entries. Call again with offset=${end} for the rest.`
            : `Showing ${offset + 1}-${end} of ${totalCount} shelf entries.`,
    };
  };

  return render(page);
}
