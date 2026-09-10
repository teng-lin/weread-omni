---
name: weread
description: Search WeRead, inspect books and reading data, manage the bookshelf, public-account subscriptions and reviews, read and write highlights and notes, build private article feeds and archives, ask WeRead AI, or import a personal book through the installed `weread-omni` JSON CLI. Use for requests involving 微信读书, WeChat Reading, a user's WeRead shelf, public accounts, articles, highlights, notes, reviews, reading statistics, recommendations, or book lookup.
---

# WeRead

Use the installed CLI as the only interface. Always pass `--json`, parse
successful stdout as JSON, and summarize the result for the user. On a non-zero
exit, parse the JSON error from stderr. Never expose credentials or paste raw
tokens.

## Account selection

Choose exactly one account for the session and preserve it through every CLI
call. Use the alias supplied by the user or operator. If none was supplied,
`weread-omni accounts --json` must show exactly one configured account. In the
examples below, `$ACCOUNT` means that alias. Do not switch accounts after a
failure.

Writes are permitted unless the operator has set `WEREAD_READONLY`. A refused
write fails with `disabled by WEREAD_READONLY`; report that limit as policy, and
never unset it or retry against another account on the user's behalf.

## Session preflight

Before the first authenticated operation, run:

```bash
weread-omni --account "$ACCOUNT" doctor --json
```

Proceed only when the result has `ok: true`, `cli.package:
"weread-omni"`, and `auth.status: "authenticated"`. On an authentication
error, require the same `cli.package` in the JSON error before following its
`hint`. Do not start QR login without user confirmation. Follow the returned
account-specific hint; malformed or unreadable state must be corrected or
removed first. Retry `doctor` once with the same account. If it returns
non-JSON or names another
package, stop and report the path from `command -v weread-omni`; do not guess
another command.

## Read workflow

Start with the narrowest read that answers the request. Preserve `bookId`
values from search or shelf results for follow-up commands.

Book metadata, chapter listings, and downloaded public-account articles are
served from a local library after the first read, so a repeated read can return
a stored copy rather than a fresh one. If a result looks out of date, say so and
offer `--refresh` to refetch and replace it; `--no-library` skips the library
entirely for one command. Never present stored content as freshly fetched.

```bash
weread-omni --account "$ACCOUNT" public-accounts read-article 'https://mp.weixin.qq.com/s/ARTICLE' --json
weread-omni --account "$ACCOUNT" search books "三体" --json
weread-omni --account "$ACCOUNT" search books "刘慈欣" --scope 6 --json
weread-omni --account "$ACCOUNT" book info BOOK_ID --json
weread-omni --account "$ACCOUNT" shelf sync --count 20 --json
weread-omni --account "$ACCOUNT" public-accounts subscriptions --count 20 --json
weread-omni --account "$ACCOUNT" public-accounts articles MP_WXS_123 --count 20 --json
weread-omni --account "$ACCOUNT" public-accounts resolve-article 'https://mp.weixin.qq.com/s/ARTICLE' --json
weread-omni --account "$ACCOUNT" notes notebooks --count 10 --json
weread-omni --account "$ACCOUNT" notes recent --count 10 --json
weread-omni --account "$ACCOUNT" notes mine BOOK_ID --count 10 --json
weread-omni --account "$ACCOUNT" notes underlines BOOK_ID CHAPTER_UID --json
weread-omni --account "$ACCOUNT" notes read-reviews BOOK_ID CHAPTER_UID --reviews '[{"range":"393-401","count":10}]' --json
weread-omni --account "$ACCOUNT" review single REVIEW_ID --json
weread-omni --account "$ACCOUNT" read-data detail --mode weekly --json
weread-omni --account "$ACCOUNT" discover recommend --count 10 --json
weread-omni --account "$ACCOUNT" ai ask-book BOOK_ID "Summarize the central argument" --json
```

`search books` defaults to `--scope 10` for ebooks. Choose the scope from the
request: `0` all, `10` ebooks, `16` web fiction, `14` audio, `6` authors, `12`
full text, `13` booklists, `2` public accounts, or `4` articles. Do not use
scope 10 for every intent. When `hasMore` is 1, pass the last result's
`searchIdx` as `--max-idx`; a page is not the complete result set.

Use only the cursor that belongs to the command:

- For `shelf sync`, pass `nextOffset` as `--offset`.
- For `public-accounts articles`, omit `--offset` on the first call, or pass a
  previous `synckey` as `--synckey` for a delta refresh. Never combine the two.
  If the response has `nextOffset`, pass it as `--offset`; stop when it is absent.
- For `notes notebooks`, pass the final book's `sort` as `--last-sort`.
- `notes recent` is a bounded account-wide snapshot; it has no page cursor.
- For `notes best` and `review list`, add the returned item count to the
  previous `--max-idx`.
- Use `synckey` only to refresh previously fetched data. It is not a page
  cursor.

Preserve every upstream `hasMore` and cursor exactly; do not infer completion
from a short result or from a missing `hasMore`.

`shelf sync` returns a compact page by default. Use `--full` only when the user
needs exact upstream sync fields; it cannot be combined with `--count` or
`--offset`.

Use `book detail` for product images and other books by the same author or
rightsholder. It returns six entries per related catalog by default; use
`--count` (1-12) when a smaller result is enough. Use `book chapters` or
`book progress` for those specific views.
`book chapters` returns the table of contents, where each
entry carries the `chapterUid` that the notes and review commands use to address
a position in a book. Use `notes bookmarks`, `notes best`, or `notes underlines`
for those note types. To read thoughts under a popular highlight, take its
`chapterUid` and `range` from `notes best`, call `notes read-reviews`, then use
`review single` when the user wants one thought in full. Use `review list`,
`discover similar`, and `ai suggest` for reviews, related books, and suggested
questions.

For a supplied article URL, use `public-accounts read-article URL --json` directly;
no public-account search or subscription is needed. `resolve-article` only returns
an ID and `review single` may only contain metadata or an abstract.
Use the returned `markdown` or `contentHtml`, and cite `sourceUrl`. A cache hit is
marked `fromCache: true`, with `cachedAt` and a null `fetchedAt`. `status: readable`
does not independently establish completeness (`completeness: unverified`);
inspect the article structure and ending when completeness matters. `partial`
means only a preview was obtained. An unavailable body exits nonzero with JSON
diagnostics on stderr; never summarize its metadata as though it were the body.

For public-account discovery and subscription, follow this sequence:

1. Search with `weread-omni --account "$ACCOUNT" search books KEYWORD --scope 2 --json`.
2. Show the matches and have the user choose the exact `MP_WXS_<digits>` ID.
   Never auto-select or auto-subscribe the first fuzzy match.
3. Subscribe only when requested, then use `public-accounts subscriptions`,
   `articles`, `feed`, or `export`.
4. Unsubscribe only after confirming the exact account.

```bash
weread-omni --account "$ACCOUNT" public-accounts subscribe MP_WXS_123 --json
weread-omni --account "$ACCOUNT" public-accounts feed MP_WXS_123 --format rss --out /private/path/feed.xml --json
weread-omni --account "$ACCOUNT" public-accounts feed subscriptions --format json --out /private/path/feed.json --json
weread-omni --account "$ACCOUNT" public-accounts export MP_WXS_123 --out /private/path/archive --json
weread-omni --account "$ACCOUNT" public-accounts unsubscribe MP_WXS_123 --yes --json
```

Feed and export outputs contain at most 20 items by default and 100 maximum.
For aggregate feeds, this is a final output limit; collection may retrieve up
to that many candidates per account. CLI output paths are never overwritten.
An export is complete only when `manifest.json` exists; report an incomplete
path rather than deleting it.
Article retrieval makes one bounded direct retrieval attempt from a validated
HTTPS `mp.weixin.qq.com/s` source URL using WeRead's E-Ink `User-Agent`. The
attempt may follow at most three validated redirects and sends no WeRead
authentication headers to that host. If a diagnostic reports
`SOURCE_CLOUDFLARE_CHALLENGE` or `SOURCE_WECHAT_CHALLENGE`, tell the user to
open its `sourceUrl` in a browser. Do not claim the archive is complete or
imply that the CLI can execute JavaScript challenges or solve CAPTCHAs.

For a question about a book's substance, prefer `ai ask-book`: the server
answers it directly, with no need to pull anything down first.

## Account changes

Run a write only when the user explicitly requests that change. State the
target before acting. Do not infer consent from a prior read.

```bash
weread-omni --account "$ACCOUNT" shelf add BOOK_ID --json
weread-omni --account "$ACCOUNT" review add BOOK_ID "A concise review" --star 100 --json
weread-omni --account "$ACCOUNT" review edit REVIEW_ID "Replacement text" --json
weread-omni --account "$ACCOUNT" import book /absolute/path/to/book.epub --json
```

`import book` accepts an EPUB, PDF, MOBI, TXT, or AZW3 file the user already
has; it uploads that file to the user's own WeRead account.

Shelf state changes use the positive state by default and a negated option for
the reverse:

```bash
weread-omni --account "$ACCOUNT" shelf pin BOOK_ID --json
weread-omni --account "$ACCOUNT" shelf pin BOOK_ID --no-top --json
weread-omni --account "$ACCOUNT" shelf set-private BOOK_ID --json
weread-omni --account "$ACCOUNT" shelf set-private BOOK_ID --no-secret --json
weread-omni --account "$ACCOUNT" shelf mark-finished BOOK_ID --json
weread-omni --account "$ACCOUNT" shelf mark-finished BOOK_ID --no-finished --json
weread-omni --account "$ACCOUNT" shelf mark-reading BOOK_ID --json
weread-omni --account "$ACCOUNT" shelf mark-reading BOOK_ID --no-reading --json
```

Review ratings use the protocol scale `20`, `40`, `60`, `80`, or `100`.

Add a highlight (划线) with the chapter, character range, and highlighted text:

```bash
weread-omni --account "$ACCOUNT" notes add-bookmark BOOK_ID CHAPTER_UID "777-778" "the highlighted text" --json
weread-omni --account "$ACCOUNT" notes update-bookmark BOOKMARK_ID --style 2 --color-style 5 --json
```

Deletion is destructive. Confirm the exact target with the user, then include
`--yes`; never retry a failed write blindly.

```bash
weread-omni --account "$ACCOUNT" shelf delete BOOK_ID --yes --json
weread-omni --account "$ACCOUNT" notes remove-bookmark BOOKMARK_ID --yes --json
weread-omni --account "$ACCOUNT" review delete REVIEW_ID --yes --json
weread-omni --account "$ACCOUNT" public-accounts unsubscribe MP_WXS_123 --yes --json
```

## Result handling

- On success, report the useful fields and retain relevant IDs for follow-ups.
- A response may omit fields or return fewer items than requested. Use only
  values actually returned; do not synthesize a missing field or describe it as
  zero/empty.
- Use `totalCount` from the compact shelf response. In a `--full` response, the
  total is `books.length + albums.length + (non-empty mp ? 1 : 0)`. Do not
  answer from `bookCount` alone.
- A notebook's total notes are `reviewCount + noteCount + bookmarkCount`.
  `noteCount` is highlights only, and `reviewCount` already includes personal
  thoughts/reviews. Exportable content requires both `notes bookmarks` and
  `notes mine`; highlight text is returned, but type-0 bookmark text is not.
- Treat every reading-duration field as seconds except
  `preferAuthor[].readTime`, which is already formatted text. Reading progress
  is an integer percentage: `1` means 1%, and only `100` means finished.
- Public review ratings use `20`, `40`, `60`, `80`, `100` for one through five
  stars. Personal-note review ratings may instead be `0`-`5` or `-1` for none.
- Use a returned `deepLink` directly as the open link. Never construct one when
  the response omits it. Convert Unix timestamps to dates before presenting
  them.
- On `{ "error": ... }`, explain the error without guessing or silently
  switching commands.
- `errCode` `-2010` and `-2013` are the server's own rate-limit and entitlement
  decisions. Report them as such rather than retrying in a loop or trying a
  different command to work around them.
- Paginate only when the user needs more results. Continue only when the
  backend returns the required next-page signal (`hasMore=1`, `nextOffset`, or
  the command's documented cursor). If the response omits a completion
  signal, report that the available page is bounded rather than claiming it is
  the complete result set.
- Keep source data in Chinese when appropriate; translate or summarize only
  when requested.
- Write Chinese responses as original Chinese, not as sentence-by-sentence
  translations from English. Prefer short, concrete, idiomatic wording; state
  what the user can do before commands and constraints; retain established
  technical names when they are clearer; and remove translationese or generic
  AI marketing language before replying.
