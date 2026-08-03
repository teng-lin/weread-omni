# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
Before `0.3.0` the TypeScript SDK core is the compatibility boundary, while the
CLI surface is **experimental** and may change in a minor release.

## [Unreleased]

## [0.1.1]

### Changed

- **The CLI command is now `weread-omni`.** The official WeRead Agent Skill
  installs a `weread` command, so shipping our own meant whichever package was
  installed second silently won the name. Anyone who installed `0.1.0` should
  reinstall; the old `weread` binary is not removed by upgrading.
- Recovery hints name the new command, so a copied suggestion works as printed.

Credential and library locations are untouched: `~/.config/weread/` and
`~/.local/share/weread/library` keep an existing login and cached content. The
projected tool names, the upstream host, and the bundled skill are unchanged.

## [0.1.0]

First public release.

### Added

- **One surface of 40 canonical operations.** The TypeScript SDK, JSON CLI, and
  packaged agent skill cover search, book metadata and progress, shelf
  management, public-account subscriptions and articles, notes, reviews,
  reading statistics, discovery, WeRead AI, and book import.
  The surface includes `notes.recent`, `notes.updateBookmark`,
  `notes.removeBookmark`, `review.edit`, and
  `publicAccounts.resolveArticle`; the three writes use the existing
  notes/review gates, and highlight removal requires CLI confirmation.
- **TypeScript SDK.** `MobileApiClient` and `WeReadClient` provide typed inputs,
  outputs, error classes, normalized pagination, bounded validation,
  configurable client profiles, and opt-in redacted logging. The SDK is silent
  by default.
- **Local content library.** Chapter listings, book metadata, and
  public-account articles are stored on first read and served from disk.
  Chapter bodies are stored the same way, but only when the configured client
  serves them. The library is on by default; `--refresh` refetches and
  `--no-library` opts out per command.
  `weread-omni library path|status|verify` inspect it. Records live in SQLite under
  `WEREAD_LIBRARY_DIR` (default `~/.local/share/weread/library`) and payloads in
  a content-addressed file store beside it. Failed article retrievals are not
  stored, and locked chapter previews read as misses so they can be refetched.
- **CLI** (`weread-omni`). Every SDK operation has human-readable and JSON output.
  `weread-omni doctor` validates the installed package and selected credentials;
  `weread-omni login` stores credentials at mode `0600`.
- **Agent skill.** The packaged skill under `skills/` drives the JSON CLI,
  checks login state, follows operation-specific pagination, and asks before
  writes.
- **Multiple accounts and plugins.** CLI calls select one named account, with a
  recorded default for when none is named. The versioned
  `weread-omni/plugin` contract lets providers own their login protocol,
  persistent state, identity, and full canonical client. The stock launcher
  discovers providers from `WEREAD_PLUGINS`; plugins may supply full Android or
  iOS clients without exposing their tokens. Profiles live under
  `~/.config/weread/accounts/<account>/`.
- **Public-account feeds and archives.** Scoped search, subscriptions, article
  history, RSS, Atom, JSON Feed, and no-overwrite directory exports include
  completeness diagnostics and strict source-URL validation.
  `publicAccounts.paidContent` (`weread-omni public-accounts paid-content`) asks the
  entitlement endpoint for protected article bodies. Feed and export use it for
  `payType` 2, follow upstream substitute URLs for unentitled accounts, and
  fall back to the public URL with a diagnostic when lookup fails.
- **Write policy.** Every operation is permitted by default; setting
  `WEREAD_READONLY` to `1` closes every write at once. Reads are never gated.
- **Book import.** `weread-omni import book` uploads EPUB, PDF, MOBI, TXT, and AZW3
  files to the shelf, checking extension and size first.
  WeRead's upstream import protocol ultimately sends a completed import to
  Tencent COS; Tencent COS is not the upload service's configurable backend.

### Behavior

- Requires Node.js `>=22.13.0`. The local content library uses `node:sqlite`,
  which sits behind `--experimental-sqlite` on earlier releases.
- `WeReadClient` is the canonical client: all 40 operations run on the E-Ink
  backend, and a failed request never falls back to a second one.
- `weread-omni login` runs the E-Ink QR flow and creates an account on the built-in
  `eink` client. Accounts are prepared with the CLI; there is no login tool.
- `createEinkClient()` returns the same `MobileApiClient` the built-in client
  uses. Android, iOS, and browser-session implementations can be supplied as
  plugins without adding plugin-specific CLI entry points.
- Responses are normalized to canonical search and review shapes while
  preserving upstream fields and cursors. `notes.notebooks` enforces the
  requested result limit. `notes.best` slices only its initial snapshot;
  incremental deltas remain complete.
- Credentials in the durable credential file stay authoritative after
  environment bootstrap, refreshes are written atomically, and authentication
  failures include actionable recovery hints without tokens.
- Token-expired reads retry once; writes are never replayed when their outcome
  may be ambiguous.
- Snapshot endpoints normalize pagination even when the upstream service ignores
  cursors or returns cumulative prefixes.
- Optional upstream arrays such as shelf albums and community highlights are
  accepted when absent or null rather than turning healthy responses into client
  errors.
- CLI JSON mode returns one structured error, handles early-closing pipelines
  without an `EPIPE` stack trace, and keeps help output distinct from success.
- The CLI launcher provides a configurable connection-attempt timeout while
  preserving dual-stack failover.

### Security

- Credentials, cookies, authorization headers, signing keys, and token-shaped
  fields are redacted from logs and errors.
- Book import enforces file types and a byte ceiling before reading a file.
- Account state is written atomically at mode `0600` under directories created
  at mode `0700`.
- Mobile tokens never appear in account discovery or login JSON
  output.
- One authorization covers every selected account.

### Release engineering

- Hermetic CI exercises the supported Node boundaries, package contents,
  packed consumer behavior, coverage, and a source-built container.
- The candidate/publish pipeline retains one commit-bound tarball and publishes
  only that digest-verified artifact with npm provenance.
- Stable and numbered alpha, beta, and release-candidate versions use explicit
  npm channels.
- [`docs/releasing.md`](docs/releasing.md) documents the first-publish
  credential cleanup, Trusted Publishing migration, and public artifact
  verification. [`SECURITY.md`](SECURITY.md) provides a private reporting
  channel.

### Notes

- This is an unofficial client. It is not affiliated with, endorsed by, or
  supported by Tencent or WeRead. See the legal section of the README.

[Unreleased]: https://github.com/teng-lin/weread-omni/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/teng-lin/weread-omni/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/teng-lin/weread-omni/releases/tag/v0.1.0
