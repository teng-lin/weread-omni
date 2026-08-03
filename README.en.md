# weread-omni

[简体中文](README.md) | English

[Changelog](CHANGELOG.md) | [Security policy](SECURITY.md)

weread-omni is a full-coverage agent skill and unofficial SDK for WeRead. Sign in by QR code and you get 40 read-and-write operations, far beyond the 6 read-only capabilities the official Skill provides.

Those 40 operations have one implementation behind three entry points: the `weread` CLI, where every command can emit JSON; a fully typed TypeScript SDK; and the agent skill bundled in this repo.

This project is not affiliated with, endorsed by, or supported by Tencent or WeRead.

## Compared to the official Skill

WeRead published an official Agent Skill in May 2026. Accessed with an API key, it covers six capabilities: shelf, book search, reading statistics, book details, notes and highlights, and recommendations. weread-omni covers all of those and adds the following.

| | Official Skill | weread-omni |
| --- | :---: | :---: |
| Shelf, search, stats, book details, notes and highlights, recommendations | ✅ | ✅ |
| Create, edit, and delete your own highlights and reviews | ❌ | ✅ |
| Import EPUB, PDF, MOBI, TXT, AZW3 | ❌ | ✅ |
| Public accounts and articles | ❌ | ✅ |
| WeRead AI | ❌ | ✅ |

## Quickstart

You need Node.js `>=22.13.0` and a WeChat account with working WeRead access.

```bash
npm install --global weread-omni
weread login --json
weread doctor --json
weread search books "The Three-Body Problem" --json
```

`weread login` presents a single E-Ink QR code — scan it once with your WeRead account.

QR codes and progress go to stderr. On success, the JSON written to stdout contains only the account alias, client ID, `vid`, and device ID—never tokens. `weread doctor` checks the active installation, authentication, and one read-only request.

### Accounts and credentials

The first login without `--account` creates the `default` account. Name additional accounts explicitly:

```bash
weread --account work login --json
weread accounts --json
weread accounts use work --json
weread --account default shelf sync --json
```

An alias must start with a lowercase letter or digit. The remaining characters may be lowercase letters, digits, `-`, or `_`, for a maximum length of 64. If a command omits `--account`, the only configured account is selected automatically. With multiple accounts, `WEREAD_ACCOUNT` takes precedence over the default saved by `weread accounts use <alias>`. If neither selects an account, the CLI asks you to be explicit.

Credentials live under `~/.config/weread/accounts/<alias>/` by default. Directories use mode `0700`, and files use `0600`. Set `WEREAD_CONFIG_DIR` to move the configuration root. Every `WEREAD_*` variable read by the project is documented in [`.env.example`](https://github.com/teng-lin/weread-omni/blob/v0.1.0/.env.example).

### Install the agent skill

The bundled `weread` skill teaches an agent to check authentication, call the JSON CLI, follow the correct pagination cursor, and ask before writing. It does not install the `weread` command, so complete the Quickstart first.

Install it with the [skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add teng-lin/weread-omni --skill weread
```

To install globally for Codex and Claude Code without prompts:

```bash
npx skills add teng-lin/weread-omni --skill weread --global --agent codex --agent claude-code --yes
```

Inspect or update a project installation with:

```bash
npx skills list
npx skills update weread
```

Add `--global` to those two commands for a global installation.

## Closing writes

Writes are enabled by default. Set `WEREAD_READONLY` to `1`, `true`, or `yes` to close every one of them; reads are never affected.

| Variable | Operations governed | Default |
| --- | --- | --- |
| `WEREAD_READONLY` | `shelf.add`, `shelf.delete`, `shelf.pin`, `shelf.setPrivate`, `shelf.markFinished`, `shelf.markReading`, `publicAccounts.subscribe`, `publicAccounts.unsubscribe`, `review.add`, `review.edit`, `review.delete`, `notes.addBookmark`, `notes.updateBookmark`, `notes.removeBookmark`, `import.book` | writes open |

Unset, empty, and whitespace-only values leave writes open, and so does any unrecognized value — the switch only ever closes them. It is read once at process startup. In JSON or non-interactive mode, `shelf delete`, `public-accounts unsubscribe`, `notes remove-bookmark`, and `review delete` also require `--yes`.

## Common commands

Every command supports `--json`. Agents should always request JSON output. Run `weread <command> --help` for the authoritative options.

### Search and read

```bash
weread search books "The Three-Body Problem" --json
weread book info BOOK_ID --json
weread book chapters BOOK_ID --json
weread notes bookmarks BOOK_ID --json
weread read-data detail --mode annually --json
weread discover similar BOOK_ID --json
weread ai ask-book BOOK_ID "What is this book's central argument?" --json
```

`book chapters` returns the `chapterUid` used by later commands.

### Shelf, highlights, and reviews

```bash
weread shelf sync --count 50 --json
weread shelf add BOOK_ID --json
weread shelf mark-reading BOOK_ID --json

weread notes add-bookmark BOOK_ID CHAPTER_UID "1-20" "text to highlight" --json
weread review add BOOK_ID "My thoughts after reading" --star 80 --json
```

`shelf pin`, `set-private`, `mark-finished`, and `mark-reading` perform the positive action by default. Use `--no-top`, `--no-secret`, `--no-finished`, or `--no-reading` to reverse it. Review ratings must be one of `20`, `40`, `60`, `80`, or `100`.

### Public-account feeds and exports

Search first and verify the exact `MP_WXS_<digits>` ID before subscribing:

```bash
weread search books "PUBLIC_ACCOUNT_NAME" --scope 2 --json
weread public-accounts subscribe MP_WXS_1234567890 --json
weread public-accounts articles MP_WXS_1234567890 --count 20 --json

weread public-accounts feed MP_WXS_1234567890 --format json --out ./account.feed.json --limit 50 --json
weread public-accounts feed subscriptions --format rss --out ./subscriptions.xml --limit 50 --json
weread public-accounts export MP_WXS_1234567890 --out ./account-archive --limit 100 --json
```

Feeds and exports process 20 articles by default, with a maximum `--limit` of 100. They never overwrite an existing file or directory. Article bodies are fetched only from validated HTTPS `mp.weixin.qq.com/s` URLs. JavaScript challenges and CAPTCHAs are reported in diagnostics, not bypassed.

The protected-article endpoint is wired up, but the recorded live check returned `-2012`; it has not yet produced an article body. An error from `public-accounts paid-content` does not imply that the same account's other tokens have expired.

### Import a personal book

```bash
weread import book ./my-book.epub --json
```

EPUB, PDF, MOBI, TXT, and AZW3 are supported. The default size limit is 200 MiB; override it with `WEREAD_MAX_UPLOAD_BYTES`.

## Local content library

The CLI stores book metadata, tables of contents, and downloaded public-account articles locally by default. A later request for the same content uses the local copy.

```bash
weread library path --json
weread library status --json
weread library verify --json
```

| Option | Effect |
| --- | --- |
| `--refresh` | Fetch again and update the local copy |
| `--no-library` | Do not read or write the library for this invocation |

The default root is `$XDG_DATA_HOME/weread/library`, or `~/.local/share/weread/library` when `XDG_DATA_HOME` is unset. Override it with `WEREAD_LIBRARY_DIR`. Indexes are account-scoped, identical payloads are stored once, and nothing is removed automatically.

The library contains unencrypted reading material, not credentials; treat it as sensitive data. It requires SQLite WAL support. If the filesystem cannot provide it, the CLI warns and continues without the library. Set `WEREAD_LIBRARY_ALLOW_UNSAFE=1` to bypass the check only when you are certain there is a single writer.

## CLI reference

This is a command index. All commands accept the global options below; each subcommand's `--help` output is authoritative for parameters, defaults, and ranges.

| Global option | Effect |
| --- | --- |
| `-V, --version` | Print the installed version |
| `--json` | Write raw JSON |
| `--account <name>` | Select an account |
| `--no-library` | Do not use the local content library |
| `--refresh` | Ignore stored content and fetch it again |

### Account and local management

| Command | Purpose |
| --- | --- |
| `weread login` | Log in or re-authenticate the selected account |
| `weread accounts` | List accounts and client IDs |
| `weread accounts use <alias>` | Save the account used when `--account` is omitted |
| `weread whoami` | Show the selected account's redacted identity |
| `weread doctor` | Check installation, authentication, and connectivity |
| `weread library path` | Print the local-library path |
| `weread library status` | Summarize stored content |
| `weread library verify` | Check the database and stored payloads |

### Books and shelf

| Command | Purpose |
| --- | --- |
| `weread search books <keyword> [--scope <n>] [--count <n>] [--max-idx <n>]` | Search the catalog; ebooks by default |
| `weread search suggest <keyword> [--count <n>]` | Return search autocomplete candidates |
| `weread book info <bookId>` | Get book metadata |
| `weread book detail <bookId> [--count <n>]` | Get cover artwork and bounded author, publisher, rightsholder, and category catalogs |
| `weread book chapters <bookId>` | List the table of contents |
| `weread book progress <bookId>` | Get reading progress |
| `weread shelf sync [--count <n>] [--offset <n>] [--full]` | Page through the compact shelf; `--full` returns the raw response |
| `weread shelf add <bookId>` | Add a book to the shelf |
| `weread shelf delete <bookId> [-y, --yes]` | Remove a book from the shelf |
| `weread shelf pin <bookId> [--no-top]` | Pin or unpin a book |
| `weread shelf set-private <bookId> [--no-secret]` | Make a book private or public |
| `weread shelf mark-finished <bookId> [--no-finished]` | Mark a book finished or undo it |
| `weread shelf mark-reading <bookId> [--no-reading]` | Mark a book as reading or undo it |

### Public accounts

| Command | Purpose |
| --- | --- |
| `weread public-accounts subscriptions [--count <n>] [--offset <n>]` | Page through subscribed public accounts |
| `weread public-accounts articles <accountId> [--count <n>] [--synckey <n>] [--offset <n>]` | Page through articles; `--synckey` starts a delta refresh and conflicts with `--offset` |
| `weread public-accounts resolve-article <docUrl>` | Resolve an article URL to its WeRead review ID |
| `weread public-accounts paid-content <docUrl>` | Attempt to fetch an entitled protected article |
| `weread public-accounts subscribe <accountId>` | Subscribe to a public account |
| `weread public-accounts unsubscribe <accountId> [-y, --yes]` | Unsubscribe from a public account |
| `weread public-accounts feed <accountId\|subscriptions> --format <rss\|atom\|json> --out <file> [--limit <n>]` | Create a feed file |
| `weread public-accounts export <accountId> --out <directory> [--limit <n>]` | Create an article export directory |

### Notes and reviews

| Command | Purpose |
| --- | --- |
| `weread notes notebooks [--count <n>] [--last-sort <n>]` | List books with notes |
| `weread notes recent [--count <n>]` | List recent notes and highlights |
| `weread notes bookmarks <bookId> [--synckey <n>]` | List your highlights with their text |
| `weread notes mine <bookId> [--synckey <n>] [--count <n>]` | List your notes for a book |
| `weread notes best <bookId> [--synckey <n>] [--count <n>] [--max-idx <n>] [--chapter-uid <n>]` | List popular highlights |
| `weread notes read-reviews <bookId> <chapterUid> --reviews <json>` | Read thoughts under popular-highlight ranges |
| `weread notes underlines <bookId> <chapterUid> [--synckey <n>]` | Get per-chapter highlight statistics without text |
| `weread notes add-bookmark <bookId> <chapterUid> <range> <markText> [--type <n>] [--style <n>] [--color-style <n>] [--book-version <n>] [--chapter-name <name>] [--context-abstract <text>]` | Add a highlight |
| `weread notes update-bookmark <bookmarkId> --style <n> [--color-style <n>]` | Change a highlight's style |
| `weread notes remove-bookmark <bookmarkId> [-y, --yes]` | Remove one of your highlights |
| `weread review list <bookId> [--list-type <n>] [--list-mode <n>] [--mine <n>] [--synckey <n>] [--count <n>] [--max-idx <n>]` | List reviews |
| `weread review single <reviewId> [--comments-count <n>] [--comments-direction <n>] [--likes-count <n>] [--likes-direction <n>] [--synckey <n>]` | Get one thought or review |
| `weread review add <bookId> <content> [--star <n>] [--type <n>] [--range <range>] [--abstract <text>] [--chapter-uid <n>]` | Post a review or thought |
| `weread review edit <reviewId> <content>` | Edit one of your reviews or thoughts |
| `weread review delete <reviewId> [-y, --yes]` | Delete a review |

### Statistics, discovery, AI, and import

| Command | Purpose |
| --- | --- |
| `weread read-data detail [--mode <mode>] [--base-time <n>]` | Get reading statistics |
| `weread discover recommend [--count <n>] [--max-idx <n>]` | Get book recommendations |
| `weread discover similar <bookId> [--count <n>] [--max-idx <n>] [--session-id <id>]` | Find similar books |
| `weread ai ask-book <bookId> <query> [--intent <intent>] [--max-polls <n>] [--delay-cap-ms <ms>]` | Ask WeRead AI about a book |
| `weread ai suggest <bookId> [--chapter-uid <n>] [--toolbar] [--range <range>] [--mp-review-id <id>]` | Get suggested questions |
| `weread import book <path>` | Import a personal book |

### Search scopes and paging

`search books --scope` accepts `0` everything, `10` ebooks (default), `16` web fiction, `14` audio, `6` authors, `12` full text, `13` booklists, `2` public accounts, and `4` articles.

| Command | Next page |
| --- | --- |
| `search books` | When `hasMore=1`, pass the last item's `searchIdx` to `--max-idx` |
| `shelf sync`, `public-accounts subscriptions` | Pass the returned `nextOffset` to `--offset` |
| `public-accounts articles` | Start without `--offset`, or pass a previous `synckey` as `--synckey` for a delta refresh; then page with each returned `nextOffset` |
| `notes notebooks` | Pass the last item's `sort` to `--last-sort` |
| `notes best`, `review list` | Increase `--max-idx` by the number of returned items |

`synckey` is an incremental-refresh cursor, not a page number. `book detail --count` defaults to 6 and accepts 1–12.

## TypeScript SDK

Log in through the CLI, then open the account with `AccountManager`:

```ts
import { AccountManager } from "weread-omni";

const account = await new AccountManager().open("default");
const weread = account.canonical;

const search = await weread.search.books("The Three-Body Problem");
const notes = await weread.notes.mine("BOOK_ID", { count: 20 });
```

The table lists operation entry points and omits shared request options. The package's TypeScript declarations are authoritative for exact signatures.

| Resource | Methods |
| --- | --- |
| `search` | `books(keyword, options?)`, `suggest(keyword, options?)` |
| `book` | `info(bookId)`, `detail(bookId, options?)`, `chapters(bookId)`, `progress(bookId)` |
| `shelf` | `sync()`, `add(bookId)`, `delete(bookId)`, `pin(bookId, top?)`, `setPrivate(bookId, secret?)`, `markFinished(bookId, finished?)`, `markReading(bookId, reading?)` |
| `publicAccounts` | `subscriptions(options?)`, `articles(accountId, options?)`, `resolveArticle(docUrl, options?)`, `paidContent(docUrl, options?)`, `subscribe(accountId)`, `unsubscribe(accountId)` |
| `notes` | `notebooks(options?)`, `recent(options?)`, `bookmarks(bookId, options?)`, `mine(bookId, options?)`, `best(bookId, options?)`, `readReviews(bookId, chapterUid, reviews, options?)`, `underlines(bookId, chapterUid, options?)`, `addBookmark(input)`, `updateBookmark(input)`, `removeBookmark(bookmarkId, options?)` |
| `review` | `list(bookId, options?)`, `single(reviewId, options?)`, `add(input)`, `edit(reviewId, content, options?)`, `delete(reviewId)` |
| `readData` | `detail(options?)` |
| `discover` | `recommend(options?)`, `similar(bookId, options?)` |
| `ai` | `askBook(input)`, `suggest(input)` |
| `import` | `book({ name, path })` or `book({ name, bytes })` |

The SDK is silent by default. Pass `logger: console` to a client for diagnostic logs. After token expiry, read requests and calls explicitly marked idempotent may be replayed once. Writes are never replayed automatically because the upstream service may already have applied them.

## Limits

- WeRead's private interfaces may change without notice. Risk controls, account permissions, and content entitlements also affect results.
- `-2041` means human verification is required. A headless client cannot complete that challenge; it is not token expiry.
- The project does not execute JavaScript challenges, solve CAPTCHAs, or impersonate browser fingerprints.
- Credentials and locally stored reading material are sensitive. See the [Security policy](SECURITY.md) for handling guidance and private vulnerability reporting.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm test
npm run test:cov
npm run test:e2e
```

Unit and integration tests never contact WeRead. `test:e2e` packs the artifact and smoke-tests it as a consumer would install it.

## Legal

This project is for personal research and automation. Use only your own account and content you are authorized to access, and follow WeRead's terms and applicable law.

Licensed under the [MIT License](LICENSE).
