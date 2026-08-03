/** Schema revision written into `PRAGMA user_version`. */
export const LIBRARY_SCHEMA_VERSION = 1;

/**
 * Digest columns are constrained everywhere they appear.
 *
 * `GLOB '[0-9a-f]*'` anchors only the first character, so a 64-character value beginning with one
 * hex digit and continuing with anything at all would pass — including a path-shaped one. The
 * digest names a file on disk, so the negated form is the only correct one.
 */
const digestCheck = (column: string): string => `length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   ) WITHOUT ROWID`,

  `CREATE TABLE account (
     id  INTEGER PRIMARY KEY,
     vid TEXT NOT NULL UNIQUE
   )`,

  `CREATE TABLE blob (
     sha256      TEXT PRIMARY KEY CHECK (${digestCheck("sha256")}),
     byte_length INTEGER NOT NULL CHECK (byte_length > 0),
     media_type  TEXT,
     stored_at   TEXT NOT NULL,
     verified_at TEXT
   ) WITHOUT ROWID`,

  // WITHOUT ROWID: rows are narrow and the primary key is the access path.
  `CREATE TABLE chapter (
     account_id  INTEGER NOT NULL REFERENCES account(id),
     book_id     TEXT    NOT NULL,
     chapter_uid INTEGER NOT NULL,
     format      TEXT    NOT NULL CHECK (format IN ('epub','txt')),
     html_sha256 TEXT    NOT NULL REFERENCES blob(sha256) CHECK (${digestCheck("html_sha256")}),
     css_sha256  TEXT             REFERENCES blob(sha256)
                   CHECK (css_sha256 IS NULL OR (${digestCheck("css_sha256")})),
     text_sha256 TEXT             REFERENCES blob(sha256)
                   CHECK (text_sha256 IS NULL OR (${digestCheck("text_sha256")})),
     toc_synckey INTEGER,
     chapter_idx INTEGER,
     title       TEXT,
     origin      TEXT NOT NULL,
     stored_at   TEXT NOT NULL,
     CHECK ((format = 'epub' AND text_sha256 IS NULL)
         OR (format = 'txt'  AND text_sha256 IS NOT NULL)),
     PRIMARY KEY (account_id, book_id, chapter_uid)
   ) WITHOUT ROWID`,

  // Narrow covering index. Redundant against the primary key in column terms, but `chapter` is
  // WITHOUT ROWID, so the primary key *is* the table and scanning it drags every row's digests and
  // title through the pages. This index carries three columns and is roughly an order of magnitude
  // smaller to scan, which is what makes `missing()` cheap.
  `CREATE INDEX chapter_by_book ON chapter(account_id, book_id, chapter_uid)`,

  // Not WITHOUT ROWID: chapters_json reaches hundreds of KiB for a long serial, and a WITHOUT
  // ROWID row lives inside the B-tree pages every search traverses.
  `CREATE TABLE book_toc (
     account_id    INTEGER NOT NULL REFERENCES account(id),
     book_id       TEXT    NOT NULL,
     backend       TEXT    NOT NULL CHECK (backend IN ('official','eink')),
     synckey       INTEGER NOT NULL CHECK (synckey > 0),
     chapter_count INTEGER NOT NULL CHECK (chapter_count > 0),
     chapter_update_time INTEGER,
     chapters_json TEXT    NOT NULL
                     CHECK (json_valid(chapters_json)
                            AND json_array_length(chapters_json) = chapter_count),
     fetched_at    TEXT NOT NULL,
     PRIMARY KEY (account_id, book_id, backend)
   )`,

  `CREATE TABLE book_meta (
     account_id INTEGER NOT NULL REFERENCES account(id),
     book_id    TEXT    NOT NULL,
     info_json  TEXT    NOT NULL
                  CHECK (json_valid(info_json)
                         AND (json_extract(info_json, '$.title')  IS NOT NULL
                           OR json_extract(info_json, '$.author') IS NOT NULL)),
     origin     TEXT NOT NULL,
     stored_at  TEXT NOT NULL,
     PRIMARY KEY (account_id, book_id)
   )`,

  // 'unsupported' is deliberately absent from the state enum: a failed retrieval is never stored
  // as content, or the user could never retry it.
  //
  // Four separate payload columns rather than one, because the export and the feed consume
  // different ones: the feed renders `contentHtml`, the archive writes `markdown` to article.md
  // and the raw bytes to source.html, and `fallbackHtml` stands in when the raw fetch was
  // refused. Collapsing them would make a stored article reconstruct into a different shape
  // than the one that was fetched.
  `CREATE TABLE article (
     account_id       INTEGER NOT NULL REFERENCES account(id),
     review_id        TEXT    NOT NULL,
     mp_account_id    TEXT,
     title            TEXT,
     publication_time INTEGER,
     source_url       TEXT,
     state            TEXT NOT NULL CHECK (state IN ('complete','partial')),
     source_sha256        TEXT REFERENCES blob(sha256)
                            CHECK (source_sha256 IS NULL OR (${digestCheck("source_sha256")})),
     source_byte_length   INTEGER,
     markdown_sha256      TEXT REFERENCES blob(sha256)
                            CHECK (markdown_sha256 IS NULL OR (${digestCheck("markdown_sha256")})),
     content_html_sha256  TEXT REFERENCES blob(sha256)
                            CHECK (content_html_sha256 IS NULL OR (${digestCheck("content_html_sha256")})),
     fallback_html_sha256 TEXT REFERENCES blob(sha256)
                            CHECK (fallback_html_sha256 IS NULL OR (${digestCheck("fallback_html_sha256")})),
     mp_info_json     TEXT,
     review_json      TEXT NOT NULL,
     -- Why the article is in the state it is. Without them a replayed "partial" article carries no
     -- explanation, and manifest.diagnostics is the only machine-readable account of it.
     diagnostics_json TEXT,
     stored_at        TEXT NOT NULL,
     -- An article with no payload at all is has()-true and get()-empty with no filesystem
     -- involved, so the row is refused rather than stored.
     CHECK (source_sha256 IS NOT NULL
         OR markdown_sha256 IS NOT NULL
         OR content_html_sha256 IS NOT NULL
         OR fallback_html_sha256 IS NOT NULL),
     PRIMARY KEY (account_id, review_id)
   )`,

  `CREATE TABLE article_index (
     account_id    INTEGER NOT NULL REFERENCES account(id),
     mp_account_id TEXT    NOT NULL,
     entries_json  TEXT    NOT NULL CHECK (json_valid(entries_json)),
     entry_count   INTEGER NOT NULL
                     CHECK (entry_count = json_array_length(entries_json)),
     terminal      TEXT    NOT NULL CHECK (terminal IN
                     ('limit','explicit','empty','missing_cursor','repeated_cursor','duplicate_only')),
     fetched_at    TEXT NOT NULL,
     PRIMARY KEY (account_id, mp_account_id)
   )`,

  // Append-only on purpose: many rows per entity, no UNIQUE. A single "previous" slot is destroyed
  // by a second --refresh, which is the expected user action after a bad one.
  `CREATE TABLE content_version (
     id            INTEGER PRIMARY KEY,
     account_id    INTEGER NOT NULL REFERENCES account(id),
     kind          TEXT NOT NULL CHECK (kind IN ('chapter','article')),
     entity_key    TEXT NOT NULL,
     role          TEXT NOT NULL CHECK (role IN ('html','css','text','source','markdown')),
     sha256        TEXT NOT NULL REFERENCES blob(sha256) CHECK (${digestCheck("sha256")}),
     superseded_at TEXT NOT NULL
   )`,

  `CREATE INDEX content_version_by_entity
     ON content_version(account_id, kind, entity_key)`,
];
