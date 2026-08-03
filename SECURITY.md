# Security policy


## The content library

`weread` keeps downloaded content under `WEREAD_LIBRARY_DIR` (default
`~/.local/share/weread/library`), separate from the credential directory. The
database and every stored payload are written `0600` inside a `0700` directory,
matching the rest of the package.

Treat it as sensitive even though it holds no credentials. It is a durable,
unencrypted record of what you have read: book text, article bodies, and the
titles and identifiers around them. It is also unbounded and long-lived, so it
is far likelier than a small configuration file to be swept into a backup or a
synchronised folder.

Nothing is deleted automatically. There is no retention policy and no eviction:
removing stored content means deleting the directory. `weread library verify`
reports damage but never removes anything.

## Supported versions

This project is pre-`1.0.0`. Only the latest published release receives security
fixes; there are no maintained backport branches.

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |
| < 0.1.0 | ❌ |

Fixes ship in a patch release where possible. Per
[`docs/api-stability-policy.md`](docs/api-stability-policy.md), an emergency
security or data-loss fix may break an interface in a patch release; when that
happens it is called out prominently in [`CHANGELOG.md`](CHANGELOG.md).

## Reporting a vulnerability

**Do not open a public issue for a security report.**

Use GitHub's private vulnerability reporting:
<https://github.com/teng-lin/weread-omni/security/advisories/new>. The report
stays private to you and the maintainer until an advisory is published.

Please include, as far as you can determine them:

- The affected version or commit, and the surface (SDK or CLI).
- The configuration that reaches the bug — whether `WEREAD_READONLY` is set, and
  which account client is in use.
- Reproduction steps and the observed versus expected behavior.
- Your assessment of impact.

Redact real credentials from anything you attach. Account files may contain
mobile access and refresh tokens and device identifiers. The direct-SDK
variables `WEREAD_VID`, `WEREAD_ACCESS_TOKEN`, `WEREAD_REFRESH_TOKEN`, and
`WEREAD_DEVICE_ID` are also live secrets. None of
these values should appear in account discovery, diagnostics, logs, or error
output.

Expect an acknowledgement within 7 days. This is a single-maintainer project, so
please allow up to 90 days for a fix before public disclosure, and coordinate the
disclosure date through the advisory thread.

## Scope

In scope: anything in this repository — the SDK, CLI, and agent skill.
Vulnerabilities worth reporting include credential disclosure (including through
logs or error output), write-gate bypass, SSRF, path traversal, and injection.

Out of scope:

- **The WeRead service itself.** This is an unofficial client, not affiliated
  with, endorsed by, or supported by Tencent or WeRead. Report a flaw in the
  upstream service to Tencent, not here.
- Findings that only restate a documented design decision — for example that
  write gates are permitted by default, or that `weread import book` reads the
  local path it is given.
- Consequences of running the CLI as a different user, or of copying an account
  profile out of `WEREAD_CONFIG_DIR`. Those files are the operator's risk.
- Dependency advisories with no demonstrated path to exploitation here. A pull
  request bumping the dependency is welcome as an ordinary public issue.

## Handling credentials and plugins

Stock account state lives under
`$WEREAD_CONFIG_DIR/accounts/<account>/` (default
`~/.config/weread/accounts/<account>/`). Direct `MobileApiClient` credentials
and `config.json` live beside the `accounts` directory. Secret files are
written atomically at mode `0600` under directories created at mode `0700`.
Treat the whole configuration directory, backups of it, and any environment
file containing secrets as you would an SSH private key.

Account names and provider IDs are safe to list, but provider state is opaque
and must never be returned by discovery commands.

Modules named by `WEREAD_PLUGINS` execute in the CLI process with the same
filesystem and network access as the user running it. Load plugins only from
operator-controlled paths or packages, pin their versions, and review updates
before deployment. The plugin API validates descriptors and account state; it
is not a sandbox.
