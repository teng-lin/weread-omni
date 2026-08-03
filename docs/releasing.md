# Releasing

This runbook covers stable and prerelease npm releases and the one-time
migration to GitHub OIDC Trusted Publishing.

Every external mutation needs a separate approval: push, merge, repository
visibility, the credential-backed live probe, environment configuration,
candidate dispatch, tag creation, bootstrap credential creation, npm publish,
Trusted Publishing, and GitHub Release
creation. On a retry, reconcile the existing GitHub and npm objects
first and obtain a new approval. Never replace a published version, move its
tag, or print/store secret or account data.

The commands below are exercised on Node 22.14.0 and npm 11.15.0; that is the
maintainer's pinned local toolchain, not the package's supported floor, which is
`engines.node >=22.13.0`. They also need `git`, `gh`,
`jq`, and an authenticated maintainer shell. Start from a clean checkout and set only public
identifiers:

```bash
set -euo pipefail
repo=teng-lin/weread-omni
package=weread-omni
release_version=0.1.0
release_tag=v0.1.0
```

Both READMEs link `.env.example` at a tag, because the tarball excludes that
file and a relative link is dead on npmjs.com. Nothing rewrites those links
automatically, so retarget them whenever the version changes — including for a
prerelease, whose tag is the prerelease version, not the eventual stable one:

```bash
sed -i "s|/blob/v[^/]*/\.env\.example|/blob/$release_tag/.env.example|g" README.md README.en.md
git diff --stat README.md README.en.md
```

The local release gate derives the expected link from the manifest version, so
forgetting this step fails `npm test` rather than shipping a broken link.

## Alpha, beta, and release-candidate versions

Use standard SemVer prereleases: `MAJOR.MINOR.PATCH-alpha.N`, `-beta.N`, and
`-rc.N`, where `N` starts at 1. Keep the same target version while promoting
it, for example:
`0.2.0-alpha.1` → `0.2.0-alpha.2` → `0.2.0-beta.1` → `0.2.0-rc.1` → `0.2.0`.

Before running the local gate, update both npm manifests without creating a tag
and keep all prerelease notes under the eventual stable changelog heading
(`## [0.2.0]` in this example):

```bash
release_version=0.2.0-alpha.1
release_tag=v$release_version
npm version "$release_version" --no-git-tag-version
sed -i "s|/blob/v[^/]*/\.env\.example|/blob/$release_tag/.env.example|g" README.md README.en.md
```

Use the same candidate and release handoff below. The publish workflow assigns
`alpha`, `beta`, or `rc` as the npm dist-tag, so an ordinary
`npm install weread-omni` remains on `latest`; opt-in users install
`weread-omni@alpha`, `@beta`, `@rc`, or an exact version. The final
`MAJOR.MINOR.PATCH` release moves `latest`.

The final GitHub Release step derives the stable changelog heading and marks
alpha, beta, and RC versions as prereleases automatically.

## Local release gate

Run the complete gate before any external mutation. The live test must skip in
the first invocation; it is run against the exact release commit only after a
separate credential-use approval.

```bash
npm ci --engine-strict --ignore-scripts
npm run lint
npm run typecheck
npm run build
npm test
npm run test:cov
npm pack --dry-run --json --ignore-scripts

release_tmp=$(mktemp -d)
trap 'rm -rf -- "$release_tmp"' EXIT
release_name=$(npm pack --silent --pack-destination "$release_tmp")
WEREAD_PACKED_TARBALL="$release_tmp/$release_name" npm run test:e2e
env -u WEREAD_LIVE npm run test:live
git diff --check
rm -rf -- "$release_tmp"
trap - EXIT
```

Review the dry-run file list. The READMEs and `docs/releasing.md` must be
present. `.env.example` must be absent; the packed READMEs link to its
tagged repository copies instead.

After approved review and merge, inventory everything that would become visible
when the repository is made public. Fetch all remote heads and tags, storing the
tags in a dedicated audit namespace so local release tags are untouched. List
the remote refs, inspect unique author and committer identities across their
histories, and print each tag's target, tagger identity, and message:

```bash
git fetch --prune origin \
  '+refs/heads/*:refs/remotes/origin/*' \
  '+refs/tags/*:refs/audit/origin-tags/*'
git ls-remote --heads --tags origin
git log --remotes=origin --glob='refs/audit/origin-tags/*' \
  --format='%an <%ae>%n%cn <%ce>' | sort -u
git for-each-ref refs/audit/origin-tags \
  --format='%(refname:strip=3)%09%(objecttype)%09%(objectname)%09%(taggername) %(taggeremail)%09%(contents)'
```

Stop until every remote head and tag is intended for public view and the
maintainer has explicitly accepted the displayed names, email addresses, tag
targets, tag messages, and host-generated identities or separately approved a
history rewrite. Deleting remote refs and rewriting history are independent
mutations and are not release-runbook defaults.

Bind every later check to the exact main SHA and identify exactly one `CI` push
run for that commit. At this point the run may have failed before starting
because of an Actions billing or quota restriction; record its stable ID rather
than treating that platform result as a code failure:

```bash
release_sha=$(gh api "repos/$repo/branches/main" --jq .commit.sha)
test "${#release_sha}" -eq 40
ci_runs=$(gh run list --repo "$repo" --workflow CI --event push \
  --branch main --commit "$release_sha" --limit 100 \
  --json databaseId,headBranch,headSha,status,conclusion,url)
ci_run_id=$(jq -er --arg sha "$release_sha" '
  [.[] | select(.headSha == $sha and .headBranch == "main")] |
  if length == 1 then .[0].databaseId
  else error("expected exactly one main-push CI run for the release SHA")
  end
' <<<"$ci_runs")
```

After separate approval, make the repository public, keep Issues enabled, and
enable private vulnerability reporting. Verify the reporting setting through
the authenticated API, then verify the repository and Issues from an anonymous
browser/session:

```bash
gh repo edit "$repo" --visibility public --accept-visibility-change-consequences
gh api --method PUT "repos/$repo/private-vulnerability-reporting" >/dev/null
gh repo view "$repo" --json visibility,hasIssuesEnabled,url
gh api "repos/$repo/private-vulnerability-reporting" --jq .enabled
curl --fail --silent --show-error "https://github.com/$repo" >/dev/null
curl --fail --silent --show-error "https://github.com/$repo/issues" >/dev/null
```

GitHub requires sign-in to open a private vulnerability report, including for
public repositories. Do not use an anonymous advisory-form request as the
enablement check; it redirects to the sign-in page. If the form itself needs a
manual UX check, use a separately authenticated ordinary GitHub account.

Now use public Actions capacity for the previously identified exact run. If it
is already successful, watching it is a no-op; otherwise rerun that same run ID.
Do not create a fresh commit or use a recent-run lookup.

```bash
ci_run=$(gh api "repos/$repo/actions/runs/$ci_run_id")
if test "$(jq -r .status <<<"$ci_run")" = completed &&
   test "$(jq -r .conclusion <<<"$ci_run")" != success; then
  gh run rerun "$ci_run_id" --repo "$repo"
fi
gh run watch "$ci_run_id" --repo "$repo" --exit-status
ci_run=$(gh api "repos/$repo/actions/runs/$ci_run_id")
test "$(jq -r .path <<<"$ci_run")" = ".github/workflows/ci.yml"
test "$(jq -r .event <<<"$ci_run")" = push
test "$(jq -r .head_branch <<<"$ci_run")" = main
test "$(jq -r .head_sha <<<"$ci_run")" = "$release_sha"
test "$(jq -r .status <<<"$ci_run")" = completed
test "$(jq -r .conclusion <<<"$ci_run")" = success
```

From a clean checkout whose `HEAD` equals `release_sha`, obtain separate
approval to use the writable account credentials, then run the read-only
probe. A skip is a failure at this gate; do not capture its account data.

```bash
test "$(git rev-parse HEAD)" = "$release_sha"
WEREAD_LIVE=1 npm run test:live
```

Set `WEREAD_LIVE_PUBLIC_ACCOUNT_ID=MP_WXS_<digits>` on that command to include
the opt-in read-only article listing and resolution probe.

The subscription mutation probe is deliberately separate from the release
gate. It requires a dedicated account ID that is absent before the run,
reconciles ambiguous writes without retrying, and restores absence in
`finally`:

```bash
WEREAD_LIVE_PUBLIC_ACCOUNT_MUTATION=1 \
WEREAD_LIVE_MUTATION_PUBLIC_ACCOUNT_ID=MP_WXS_123 \
npm run test:live:mutation
```

## First publish

The package must exist before npm can create a Trusted Publisher, so `0.1.0`
uses a one-day bootstrap token. First, after separate approval, configure the
GitHub environment `npm-publish` with required reviewers, prevent self-approval,
and restrict deployments to the protected release ref. Verify the live settings;
do not assume the workflow's `environment:` line is an approval boundary by
itself.

```bash
gh api "repos/$repo/environments/npm-publish" \
  --jq '{protection_rules,deployment_branch_policy}'
```

After separate candidate approval, dispatch the exact main SHA. Record the run
ID returned by GitHub and require its `headSha`, workflow path, status, and
conclusion to match before using its artifact.

```bash
candidate_dispatch=$(
  jq -n --arg ref main --arg commit "$release_sha" '{
    ref: $ref,
    inputs: {commit: $commit},
    return_run_details: true
  }' |
    gh api --method POST \
      --header "X-GitHub-Api-Version: 2022-11-28" \
      "repos/$repo/actions/workflows/release-candidate.yml/dispatches" \
      --input -
)
candidate_run_id=$(jq -er .workflow_run_id <<<"$candidate_dispatch")
candidate_run_url=$(jq -er .html_url <<<"$candidate_dispatch")
test "$candidate_run_url" = "https://github.com/$repo/actions/runs/$candidate_run_id"
gh run watch "$candidate_run_id" --repo "$repo" --exit-status
candidate_run=$(gh api "repos/$repo/actions/runs/$candidate_run_id")
test "$(jq -r .path <<<"$candidate_run")" = ".github/workflows/release-candidate.yml"
test "$(jq -r .head_sha <<<"$candidate_run")" = "$release_sha"
test "$(jq -r .status <<<"$candidate_run")" = completed
test "$(jq -r .conclusion <<<"$candidate_run")" = success

artifact_name="weread-omni-candidate-$release_sha"
candidate_dir=$(mktemp -d)
gh run download "$candidate_run_id" --repo "$repo" \
  --name "$artifact_name" --dir "$candidate_dir"
jq '{artifactName,commit,runId,tarball,name,version,sha512,sri}' \
  "$candidate_dir/candidate-metadata.json"
test "$(jq -r .artifactName "$candidate_dir/candidate-metadata.json")" = "$artifact_name"
test "$(jq -r .commit "$candidate_dir/candidate-metadata.json")" = "$release_sha"
test "$(jq -r .runId "$candidate_dir/candidate-metadata.json")" = "$candidate_run_id"
test "$(jq -r .name "$candidate_dir/candidate-metadata.json")" = "$package"
test "$(jq -r .version "$candidate_dir/candidate-metadata.json")" = "$release_version"
candidate_sri=$(jq -er .sri "$candidate_dir/candidate-metadata.json")
rm -rf -- "$candidate_dir"
```

Stop for a separate approval before creating and pushing the immutable tag.
Confirm both local and GitHub resolution before proceeding:

```bash
git tag -a "$release_tag" "$release_sha" -m "$release_tag"
git push origin "refs/tags/$release_tag"
test "$(git rev-list -n 1 "refs/tags/$release_tag")" = "$release_sha"
test "$(gh api "repos/$repo/commits/$release_tag" --jq .sha)" = "$release_sha"
```

After separate bootstrap-credential approval, create a uniquely named one-day
granular token with no organization access. npm cannot scope a token to a
package before that package exists, so the first publication unavoidably uses
all-package read/write access. This broader bootstrap is for the first publish
only: create it when publication is imminent, install it immediately before the
dispatch, and keep its lifetime as short as possible. Keep the token value only
in shell memory, discover its non-secret key by exact name, and feed the value
to GitHub over stdin:

```bash
token_name="weread-omni-$release_tag-bootstrap-$(date -u +%s)-$$"
bootstrap_token_id=
test "$(gh secret list --repo "$repo" --env npm-publish --json name |
  jq '[.[] | select(.name == "NPM_TOKEN")] | length')" -eq 0
test "$(npm token list --json |
  jq --arg name "$token_name" '[.[] | select(.name == $name)] | length')" -eq 0
bootstrap_cleanup_armed=1

cleanup_bootstrap() {
  test "$bootstrap_cleanup_armed" -eq 1 || return 0
  cleanup_failed=0

  gh secret delete NPM_TOKEN --repo "$repo" --env npm-publish \
    >/dev/null 2>&1 || true

  token_list=
  if token_list="$(npm token list --json 2>/dev/null)"; then
    if test -z "$bootstrap_token_id"; then
      token_matches="$(
        jq -c --arg name "$token_name" \
          '[.[] | select(.name == $name)]' <<<"$token_list"
      )"
      test "$(jq 'length' <<<"$token_matches")" -le 1 || cleanup_failed=1
      bootstrap_token_id="$(jq -r '.[0].key // empty' <<<"$token_matches")"
    fi
  else
    cleanup_failed=1
  fi

  if test -n "$bootstrap_token_id"; then
    npm token revoke "$bootstrap_token_id" >/dev/null 2>&1 || true
  fi

  if ! gh secret list --repo "$repo" --env npm-publish --json name |
    jq -e 'all(.[]; .name != "NPM_TOKEN")' >/dev/null; then
    cleanup_failed=1
  fi
  if ! npm token list --json |
    jq -e --arg id "$bootstrap_token_id" --arg name "$token_name" \
      'all(.[]; .key != $id and .name != $name)' >/dev/null; then
    cleanup_failed=1
  fi

  if test "$cleanup_failed" -ne 0; then
    printf '%s\n' "BOOTSTRAP CLEANUP REQUIRES MANUAL ACTION" >&2
    return 1
  fi
  bootstrap_cleanup_armed=0
}

trap 'cleanup_bootstrap || exit 1' EXIT
trap 'exit 130' HUP INT TERM

token_json="$(npm token create --json \
  --name="$token_name" \
  --token-description="one-time first public release" \
  --expires=1 \
  --packages-all \
  --packages-and-scopes-permission=read-write \
  --orgs-permission=no-access \
  --bypass-2fa)"
npm_bootstrap_token=$(jq -er .token <<<"$token_json")
token_matches="$(npm token list --json |
  jq -c --arg name "$token_name" '[.[] | select(.name == $name)]')"
test "$(jq 'length' <<<"$token_matches")" -eq 1
bootstrap_token_id=$(jq -er '.[0].key' <<<"$token_matches")

printf '%s' "$npm_bootstrap_token" | gh secret set NPM_TOKEN \
  --repo "$repo" --env npm-publish
unset npm_bootstrap_token token_json token_matches
gh secret list --repo "$repo" --env npm-publish --json name
```

Keep this shell open. Run the reconciliation and publish commands below in the
same shell so the armed trap survives until explicit cleanup.

Require exactly one `NPM_TOKEN` name. If publication is not approved promptly,
delete the environment secret and revoke this token; create a fresh one later.

Before any publish or retry, reconcile npm first:

```bash
if npm view "$package@$release_version" version --json >/dev/null 2>&1; then
  printf '%s\n' "already published; do not dispatch again" >&2
  exit 1
fi
```

Obtain separate publish approval. Dispatch only the recorded candidate values,
then record and watch the new release run. Do not use "latest" to substitute a
candidate or retry an ambiguous publication.

```bash
release_dispatch=$(
  jq -n \
    --arg ref "$release_tag" \
    --arg tag "$release_tag" \
    --arg candidate_run_id "$candidate_run_id" \
    --arg artifact_name "$artifact_name" \
    --arg commit "$release_sha" \
    --arg expected_sha512 "$candidate_sri" '{
      ref: $ref,
      inputs: {
        tag: $tag,
        candidate_run_id: $candidate_run_id,
        artifact_name: $artifact_name,
        commit: $commit,
        expected_sha512: $expected_sha512
      },
      return_run_details: true
    }' |
    gh api --method POST \
      --header "X-GitHub-Api-Version: 2022-11-28" \
      "repos/$repo/actions/workflows/release.yml/dispatches" \
      --input -
)
release_run_id=$(jq -er .workflow_run_id <<<"$release_dispatch")
release_run_url=$(jq -er .html_url <<<"$release_dispatch")
test "$release_run_url" = "https://github.com/$repo/actions/runs/$release_run_id"
release_status=0
gh run watch "$release_run_id" --repo "$repo" --exit-status || release_status=$?
cleanup_bootstrap
trap - EXIT HUP INT TERM
release_run=$(gh api "repos/$repo/actions/runs/$release_run_id")
test "$(jq -r .path <<<"$release_run")" = ".github/workflows/release.yml"
test "$(jq -r .head_sha <<<"$release_run")" = "$release_sha"
test "$(jq -r .status <<<"$release_run")" = completed
test "$(jq -r .conclusion <<<"$release_run")" = success
test "$release_status" -eq 0
```

Require `.path == ".github/workflows/release.yml"`, `head_sha == release_sha`,
and a completed successful result. If the run is missing, failed, or ambiguous,
check `npm view` and the named run before considering a separately approved
retry. npm versions are immutable: an existing `0.1.0` is success to reconcile,
never permission to publish again.

## Remove the bootstrap credential

The armed trap removes both bootstrap copies immediately after the first publish
attempt, including a failed workflow or interrupted shell. Run these commands
manually if the fail-safe reports an error, then verify both absences:

```bash
manual_cleanup_failed=0
gh secret delete NPM_TOKEN --repo "$repo" --env npm-publish || true
if test -n "${bootstrap_token_id:-}"; then
  npm token revoke "$bootstrap_token_id" || true
fi
gh secret list --repo "$repo" --env npm-publish --json name |
  jq -e 'all(.[]; .name != "NPM_TOKEN")' >/dev/null || manual_cleanup_failed=1
npm token list --json |
  jq -e --arg id "${bootstrap_token_id:-}" --arg name "${token_name:-}" \
    'all(.[]; .key != $id and .name != $name)' >/dev/null || manual_cleanup_failed=1
test "$manual_cleanup_failed" -eq 0
```

Do not continue until both absence checks pass. A failed cleanup is a release
incident, not a warning.

## Verify the public package

Use an empty npm configuration so local authentication cannot hide a public
access problem. Require the registry integrity to equal `candidate_sri`, a
provenance attestation URL, successful signature verification, and imports of
all three exports.

```bash
verify_dir=$(mktemp -d)
verify_npmrc="$verify_dir/npmrc"
: >"$verify_npmrc"
chmod 600 "$verify_npmrc"
NPM_CONFIG_USERCONFIG="$verify_npmrc" npm view "$package@$release_version" \
  name version repository dist.integrity dist.attestations --json \
  >"$verify_dir/metadata.json"
test "$(jq -r .name "$verify_dir/metadata.json")" = "$package"
test "$(jq -r .version "$verify_dir/metadata.json")" = "$release_version"
test "$(jq -r .dist.integrity "$verify_dir/metadata.json")" = "$candidate_sri"
jq -e '.dist.attestations.url' "$verify_dir/metadata.json" >/dev/null
NPM_CONFIG_USERCONFIG="$verify_npmrc" npm install \
  --prefix "$verify_dir/install" --ignore-scripts --no-fund \
  "$package@$release_version"
(cd "$verify_dir/install" && node --input-type=module -e \
  "await Promise.all([import('$package'), import('$package/cli'), import('$package/plugin')])")
NPM_CONFIG_USERCONFIG="$verify_npmrc" npm --prefix "$verify_dir/install" \
  audit signatures --include-attestations
rm -rf -- "$verify_dir"
```

Also inspect the provenance statement and require repository
`https://github.com/teng-lin/weread-omni`, workflow
`.github/workflows/release.yml`, tag ref, release run, release SHA, package
version, and SHA-512 digest all to match the recorded candidate.

## Trusted Publishing

Trusted Publishing configuration needs another separate approval and starts
only after the package exists and bootstrap cleanup is proven. The sole expected
relationship is:

```yaml
repository: teng-lin/weread-omni
workflow: release.yml
environment: npm-publish
createPackage: true
```

Reconcile first: zero relationships may be created; one exact match may be
reused; any mismatch or duplicate is a stop.

```bash
npm install --global npm@11.15.0
npm trust list "$package" --json
npm trust github "$package" \
  --file release.yml \
  --repository "$repo" \
  --environment npm-publish \
  --allow-publish \
  --yes
npm trust list "$package" --json
```

Require exactly one GitHub relationship whose repository, file, environment,
and `createPackage` permission match the block above. Then open a reviewed
follow-up PR that removes `npm whoami`, `NPM_TOKEN`, and `NODE_AUTH_TOKEN` from
`.github/workflows/release.yml`; keep `id-token: write`, the protected
`npm-publish` environment, and all candidate identity/digest checks. Merge only
after CI passes and verify the exact merged workflow contains no token fallback.

## GitHub Release

After npm verification and Trusted Publishing configuration, obtain separate
approval before creating the GitHub Release. Use the existing immutable tag and
the matching changelog section; do not attach a newly built package.

```bash
changelog_version=${release_version%%-*}
awk -v version="$changelog_version" '
  BEGIN { target = "## [" version "]" }
  $0 == target || index($0, target " - ") == 1 {
    found = 1
    emit = 1
  }
  emit && /^## \[/ && !($0 == target || index($0, target " - ") == 1) {
    exit
  }
  emit && /^\[[^]]+\]: / {
    exit
  }
  emit {
    print
  }
  END {
    if (!found) exit 1
  }
' CHANGELOG.md >release-notes.md
test -s release-notes.md
release_flags=()
case "$release_version" in
  *-*) release_flags+=(--prerelease) ;;
esac
gh release create "$release_tag" --repo "$repo" --verify-tag \
  "${release_flags[@]}" --title "$release_tag" --notes-file release-notes.md
gh release view "$release_tag" --repo "$repo" \
  --json tagName,targetCommitish,url,isDraft,isPrerelease
rm release-notes.md
```

Require the tag, target SHA, version, npm integrity/provenance, and release URL
to agree before declaring the release complete.

## Live suites

`npm run test:live` and `npm run test:live:mutation` talk to WeRead with real credentials, so they
are opt-in and are not described in `.env.example` — that file documents what an installed copy
reads, and these only matter to someone running the suites from a checkout.

| Variable | Effect |
| --- | --- |
| `WEREAD_LIVE=1` | Enables the read-only live suite. Without it the suite skips. |
| `WEREAD_LIVE_PUBLIC_ACCOUNT_ID` | An exact `MP_WXS_<digits>` id. Set it and the read-only suite also lists and resolves one article. |
| `WEREAD_LIVE_PUBLIC_ACCOUNT_MUTATION=1` | Enables the destructive suite. |
| `WEREAD_LIVE_MUTATION_PUBLIC_ACCOUNT_ID` | Required with the mutation probe. The account MUST NOT be subscribed before the run: the probe subscribes once, reconciles an ambiguous outcome without retrying, and restores absence in `finally`. |

Run the mutation probe only through `npm run test:live:mutation`, never as part of the ordinary
suites.
