import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const text = (path: string): Promise<string> => readFile(new URL(path, `file://${root}/`), "utf8");

// Compose sensitive environment-variable names so negative assertions do not satisfy themselves.
const officialApiCredential = ["WEREAD", "API", "KEY"].join("_");
const officialApiCredentialMap = ["WEREAD", "API", "KEYS"].join("_");

const countOccurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

// YAML lines that actually configure something, so an assertion about a rejected form is not
// satisfied by the comment that explains why it is rejected.
const directives = (yaml: string): string[] =>
  yaml
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

describe("release artifacts", () => {
  it("ships the documented package surfaces", async () => {
    const manifest = JSON.parse(await text("package.json")) as {
      name: string;
      bin: Record<string, string>;
      engines: { node: string };
      files: string[];
      scripts: Record<string, string>;
    };

    expect(manifest.name).toBe("weread-omni");
    expect(manifest.engines.node).toBe(">=22.13.0");
    expect(manifest.bin).toEqual({ "weread-omni": "./dist/cli.js" });
    expect(manifest.files).toEqual([
      "dist",
      "docs",
      "!docs/plans",
      "!docs/api-design-review-*.md",
      "skills",
      "README.md",
      // Pinned so a future edit to the allowlist cannot silently drop the English README,
      // which is the entry point for every reader who does not read Chinese.
      "README.en.md",
      "CHANGELOG.md",
      "SECURITY.md",
      "LICENSE",
    ]);
    // Non-shipping plans and design reviews must never reach the tarball; they can contain
    // unfinished security analysis with file:line pointers.
    expect(manifest.scripts.prepack).toBe("npm run build");
    // tsc does not remove stale output, so dist must be deleted before every build and pack.
    expect(manifest.scripts.build).toBe("npm run clean && tsc -p tsconfig.json");
    expect(manifest.scripts.clean).toContain("rmSync('dist'");
    // The packed-artifact suite is slow and packs a real tarball; it runs in its own CI job.
    expect(manifest.scripts.test).not.toContain("test/e2e");
    expect(manifest.scripts["test:cov"]).not.toContain("test/e2e");

    // The CLI resolves its own identity from the manifest rather than a baked-in literal.
    const cli = await text("src/cli.ts");
    expect(cli).toContain('new URL("../package.json", import.meta.url)');
    expect(cli).not.toContain('version: "0.1.0"');
  });

  it("exposes exactly the SDK, CLI, and plugin entry points", async () => {
    const manifest = JSON.parse(await text("package.json")) as {
      exports: Record<string, { types: string; default: string }>;
    };

    expect(Object.keys(manifest.exports).sort()).toEqual([".", "./cli", "./plugin"]);
    expect(manifest.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./cli": { types: "./dist/cli.d.ts", default: "./dist/cli.js" },
      "./plugin": { types: "./dist/plugin.d.ts", default: "./dist/plugin.js" },
    });
  });

  it("declares npm publishing metadata for provenance", async () => {
    const manifest = JSON.parse(await text("package.json")) as {
      author: string;
      homepage: string;
      bugs: string;
      repository: { type: string; url: string };
      keywords: string[];
      publishConfig: { access: string; provenance: boolean };
      sideEffects: boolean;
    };

    expect(manifest.author).toBe("Teng Lin");
    expect(manifest.homepage).toBe("https://github.com/teng-lin/weread-omni#readme");
    expect(manifest.bugs).toBe("https://github.com/teng-lin/weread-omni/issues");
    // Provenance attestation compares this against the publishing repository.
    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/teng-lin/weread-omni.git",
    });
    // Declared in the manifest as well as on the publish command line, so a manual
    // `npm publish` cannot accidentally go out scoped-private or unattested.
    expect(manifest.publishConfig).toEqual({ access: "public", provenance: true });
    expect(manifest.keywords).toEqual(expect.arrayContaining(["weread", "cli"]));
    expect(manifest.sideEffects).toBe(false);
  });

  // The READMEs were deliberately narrowed to what a reader needs to get working: the security
  // notes, troubleshooting guide, deployment recipes, and official-client reference were removed
  // rather than reorganized. SECURITY.md remains the security document, and the headings below are
  // the reduced set the READMEs still promise.
  it("documents quickstart, SDK, CLI, and legal status", async () => {
    const readme = await text("README.md");
    for (const heading of ["## 快速开始", "## TypeScript SDK", "## CLI 参考", "## 法律声明"]) {
      expect(readme).toContain(heading);
    }
    expect(readme).toContain("非官方");
    expect(readme).toContain("chapters(bookId)");
    expect(readme).toContain("weread-omni accounts");
    expect(readme).toContain("AccountManager");
    expect(readme).toContain("[更新日志](CHANGELOG.md)");
    expect(readme).toContain("[安全政策](SECURITY.md)");

    const english = await text("README.en.md");
    for (const heading of ["## Quickstart", "## TypeScript SDK", "## CLI reference", "## Legal"]) {
      expect(english).toContain(heading);
    }
    expect(english).toContain("unofficial");
    expect(english).toContain("chapters(bookId)");
    expect(english).toContain("weread-omni accounts");
    expect(english).toContain("AccountManager");
    expect(english).toContain("[Changelog](CHANGELOG.md)");
    expect(english).toContain("[Security policy](SECURITY.md)");
  });

  // What a document says is an editorial choice; naming configuration that no longer exists is not.
  // This checks only the second. The earlier version of this ban covered the two READMEs, which is
  // how SKILL.md and SECURITY.md kept naming the five removed write gates through three refactors --
  // SKILL.md being the file an agent actually reads at runtime.
  // The CLI is `weread-omni`; the bundled skill is still `weread`. A rename sweep that cannot tell
  // them apart produces an install command for a skill that does not exist -- which is exactly what
  // happened, and what only a reader comparing two adjacent lines would have caught.
  it("installs a skill that the repository actually ships", async () => {
    for (const doc of ["README.md", "README.en.md"]) {
      const referenced = [...(await text(doc)).matchAll(/--skill\s+(\S+)/g)].map(([, name]) => name);
      expect(referenced.length, `${doc} documents no skill install`).toBeGreaterThan(0);
      for (const name of referenced) {
        const skill = await text(`skills/${name}/SKILL.md`);
        expect(skill, `${doc} installs --skill ${name}`).toContain(`name: ${name}`);
      }
    }
  });

  it("names no removed configuration in any shipped document", async () => {
    const removed = [
      "WEREAD_ALLOW_",
      "WEREAD_API_KEY",
      "WEREAD_API_KEYS",
      "WEREAD_CREDENTIAL_STORE",
      "OfficialApiClient",
      "chapterContent",
      "--store",
    ];
    const shipped = ["README.md", "README.en.md", "skills/weread/SKILL.md", "SECURITY.md", ".env.example"];

    for (const name of shipped) {
      const doc = await text(name);
      for (const gone of removed) expect(doc, `${name} still names ${gone}`).not.toContain(gone);
    }
  });

  it("includes the declared MIT license", async () => {
    expect(await text("LICENSE")).toMatch(/MIT License[\s\S]*Permission is hereby granted/);
  });

  it("records the complete first public release with no pending changes", async () => {
    const changelog = await text("CHANGELOG.md");
    const manifest = JSON.parse(await text("package.json")) as { version: string };

    expect(changelog).toContain("Keep a Changelog");
    const unreleased = changelog.match(/^## \[Unreleased\][ \t]*\r?\n([\s\S]*?)(?=^## \[)/m);
    const current = changelog.indexOf(`## [${manifest.version}]`);
    expect(unreleased?.index).toBe(changelog.search(/^## \[/m));
    expect(unreleased?.[1]?.trim()).toBe("");
    expect(current).toBeGreaterThan(unreleased?.index ?? -1);
    const next = changelog.indexOf("\n## [", current + 1);
    const release = changelog.slice(current, next < 0 ? undefined : next);
    expect(release).toContain("MobileApiClient");
    expect(release).toContain("WEREAD_PLUGINS");
    expect(release).toContain("incremental deltas");
    expect(changelog).toContain("40 canonical operations");
    expect(changelog).toContain("drives the JSON CLI");
    expect(changelog).toContain("Tencent COS");
    expect(changelog).not.toMatch(/\b(?:27|29) canonical operations\b/);
    expect(changelog).not.toContain("0.2.0");
    // Readers must not infer semver protection for the CLI surface.
    expect(changelog).toContain("experimental");
  });

  it("publishes a private reporting channel rather than an issue tracker", async () => {
    const policy = await text("SECURITY.md");
    const runbook = await text("docs/releasing.md");

    expect(policy).toContain("https://github.com/teng-lin/weread-omni/security/advisories/new");
    expect(policy).toContain("Do not open a public issue");
    expect(runbook).toContain('gh api "repos/$repo/private-vulnerability-reporting" --jq .enabled');
    expect(runbook).toContain("requires sign-in");
    expect(runbook).not.toContain('"https://github.com/$repo/security/advisories/new" >/dev/null');
    // The upstream service is not ours to receive reports about.
    expect(policy).toContain("unofficial client");
    expect(policy).toContain("WEREAD_PLUGINS");
    expect(policy).toContain("not a sandbox");
  });

  it("documents every environment variable the code reads", async () => {
    const example = await text(".env.example");
    for (const variable of [
      "WEREAD_VID",
      "WEREAD_ACCESS_TOKEN",
      "WEREAD_REFRESH_TOKEN",
      "WEREAD_DEVICE_ID",
      "WEREAD_CONFIG_DIR",
      "WEREAD_PLUGINS",
      "WEREAD_READONLY",
    ]) {
      expect(example).toContain(variable);
    }
    // The launcher rejects an absent PUBLIC_BASE_URL when upload is on over HTTP, so the
    // reference may not advertise a default that would let a reader leave it unset.
    expect(example).not.toContain("Default: http://localhost:9402");
    // A direct SDK client defaults to the "eink" store, so an unnamed store resolves
    // credentials.eink.json. Advertising the bare file would send a reader looking for their
    // credentials in a path nothing writes.
    expect(example).not.toContain("Unset: credentials.json");
    expect(example).toContain("credentials.eink.json");
  });

  // A documented variable that nothing reads is worse than an undocumented one: it tells an
  // operator to configure behaviour that no longer exists. `S3_PUBLIC_ENDPOINT` outlived its only
  // reader by a whole release and went on promising that the download link handed back to a caller
  // was presigned against it. Every name .env.example declares has to be read somewhere in src/ —
  // as `env.NAME`, `env["NAME"]`, or a quoted literal — or be named below as consumed outside the
  // server process. A bare mention in a comment does not count; that is exactly how the dead
  // variable stayed plausible.
  const consumedOutsideTheServer = [
    "CF_TUNNEL_TOKEN",
    "WEREAD_CONFIG_MOUNT",
    "WEREAD_COPILOT_IMAGE",
    "WEREAD_LIVE_MUTATION_PUBLIC_ACCOUNT_ID",
    "WEREAD_LIVE_PUBLIC_ACCOUNT_ID",
    "WEREAD_LIVE_PUBLIC_ACCOUNT_MUTATION",
  ];

  it("declares no environment variable the code has stopped reading", async () => {
    const example = await text(".env.example");
    const declared = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].flatMap(([, name]) => name ?? []);
    // A floor, not a target: the point is that the file still enumerates the surface rather than
    // rotting into a stub. It dropped when the official API key, the credential-store selector, the
    // five per-class write gates, and the live-probe variables left.
    expect(declared.length).toBeGreaterThan(10);

    const sourceRoot = new URL("src/", `file://${root}/`);
    const paths = (await readdir(sourceRoot, { recursive: true })).filter((path) => /\.(ts|mjs)$/.test(path));
    const code = (await Promise.all(paths.map((path) => readFile(new URL(path, sourceRoot), "utf8")))).join("\n");

    const unread = [...new Set(declared)]
      .filter((name) => !consumedOutsideTheServer.includes(name))
      .filter((name) => !new RegExp(String.raw`env(?:\.|\[")${name}\b|["']${name}["']`).test(code));
    expect(unread).toEqual([]);
  });

  // The deployment chapter left the READMEs, so they no longer walk through Compose. The invariant
  // that still matters: these files are excluded from the tarball, so any link the READMEs DO keep
  // must be an absolute tagged URL. A relative link resolves to nothing on npmjs.com.
  // `.env.example` is excluded from the tarball, so a relative link is dead for anyone reading the
  // README on npmjs.com — it has to be an absolute link to a tag. The tag is derived from the
  // manifest version rather than hardcoded: `npm version` bumps the manifest during a release and
  // nothing rewrites these links, so a hardcoded tag would silently point a `0.1.0-alpha.1` release
  // at a `v0.1.0` tree, or at a tag that does not exist yet. Deriving it makes that a failed gate
  // instead of a broken link.
  it("links tarball-excluded deployment files through tagged source URLs", async () => {
    const manifest = JSON.parse(await text("package.json")) as { files: string[]; version: string };
    const docs = [await text("README.md"), await text("README.en.md")];
    const deployFiles = [".env.example"];

    for (const file of deployFiles) {
      expect(manifest.files).not.toContain(file);
      for (const doc of docs) {
        expect(doc).not.toContain(`](${file})`);
        expect(doc).not.toContain(`](./${file})`);
      }
    }
    const tagged = `https://github.com/teng-lin/weread-omni/blob/v${manifest.version}/.env.example`;
    for (const doc of docs) {
      expect(doc).toContain(tagged);
      // A link to a moving ref would resolve today and drift away from the published version.
      expect(doc).not.toContain("/blob/main/.env.example");
    }
  });

  it("ships no usable credential placeholder in the environment reference", async () => {
    const example = await text(".env.example");

    // `cp .env.example .env` must not hand anyone a working credential printed in this
    // repository. Every secret stays commented out.
    for (const secret of ["WEREAD_REFRESH_TOKEN", "WEREAD_ACCESS_TOKEN"]) {
      expect(example).toMatch(new RegExp(`^# ${secret}=`, "m"));
      expect(example).not.toMatch(new RegExp(`^${secret}=`, "m"));
    }
  });

  it("keeps the durable credential file authoritative after environment bootstrap", async () => {
    const example = await text(".env.example");

    for (const secret of ["WEREAD_VID", "WEREAD_ACCESS_TOKEN", "WEREAD_REFRESH_TOKEN", "WEREAD_DEVICE_ID"]) {
      expect(example).toMatch(new RegExp(`^# ${secret}=`, "m"));
      expect(example).not.toMatch(new RegExp(`^${secret}=`, "m"));
    }
    expect(example).toContain("bootstrap");
    expect(example).toMatch(/credential file\s+(?:#\s+)?takes\s+(?:#\s+)?precedence/);
    expect(example).not.toContain("refresh token does not rotate");
  });

  it("runs the dev gate on supported toolchain floors and the packed artifact on the Node 22 runtime floor", async () => {
    const workflow = await text(".github/workflows/ci.yml");
    expect(workflow).toContain('node-version: ["22.13.0", "24"]');
    for (const command of [
      "npm ci --engine-strict",
      "npm run lint",
      "npm run typecheck",
      "npm run build",
      "npm test",
      "npm run test:cov",
    ]) {
      expect(workflow).toContain(`run: ${command}`);
    }
    expect(workflow).toContain("run: npm pack --dry-run");
    const installSmoke = workflow.slice(workflow.indexOf("  install-smoke:"), workflow.indexOf("  pack-smoke:"));
    expect(installSmoke).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
    expect(installSmoke).toContain("if: runner.os != 'Linux'");
    expect(installSmoke).toContain("run: npm test");
    const packSmoke = workflow.slice(workflow.indexOf("  pack-smoke:"));
    expect(packSmoke).toContain("node-version: 24");
    expect(packSmoke).toContain("run: npm ci --engine-strict");
    expect(packSmoke).toContain('npm_config_engine_strict: "true"');
    expect(packSmoke).toContain("node-version: 22.13.0");
    expect(packSmoke).toContain("npm install --engine-strict --ignore-scripts --no-audit --no-fund");
    expect(packSmoke).toContain('await Promise.all(["weread-omni", "weread-omni/cli"]');
    expect(packSmoke).toContain("./node_modules/.bin/weread-omni --help");
  });

  it("pins every external workflow action to a commit", async () => {
    const workflowRoot = new URL(".github/workflows/", `file://${root}/`);
    const workflows = (await readdir(workflowRoot)).filter((path) => /\.ya?ml$/.test(path));
    const mutable = (
      await Promise.all(
        workflows.map(async (path) =>
          directives(await readFile(new URL(path, workflowRoot), "utf8")).flatMap((line) => {
            const reference = line.match(/^-?\s*uses:\s*["']?([^"'#\s]+)/)?.[1];
            return reference && !reference.startsWith("./") && !/^[^@]+@[0-9a-f]{40}$/.test(reference)
              ? [`${path}: ${reference}`]
              : [];
          }),
        ),
      )
    ).flat();

    expect(mutable).toEqual([]);
  });

  it("runs the packed-artifact smoke test in a dedicated CI job", async () => {
    const workflow = await text(".github/workflows/ci.yml");
    expect(workflow).toContain("pack-smoke:");
    // The whole e2e directory, not just pack-smoke: `npm test` runs only test/unit and
    // test/integration, so a suite under test/e2e is otherwise unverified until a release
    // candidate — which is how a stale suite survived a surface removal once already.
    expect(workflow).toContain("run: npm run test:e2e");
    expect(workflow).not.toContain("vitest run test/e2e/pack-smoke");
  });

  it("keeps public CI free of every credential, live or retired", async () => {
    const workflow = await text(".github/workflows/ci.yml");
    // Sentinels for credentials this package no longer has, kept as guards: public CI is
    // hermetic and must never reference a key or a mobile device identity.
    expect(workflow).not.toContain(officialApiCredential);
    expect(workflow).not.toContain(officialApiCredentialMap);
    expect(workflow).not.toContain("WEREAD_DEVICE_ID");
    // The retired public taxonomy stays absent from workflows as well as the package.
    expect(workflow).not.toContain("gateway");
    // No live probe at all: the public gate is hermetic, so forks run the same CI.
    expect(workflow).not.toContain("secrets.");
  });

  it("retains exactly one deterministically named candidate bound to the input commit", async () => {
    const workflow = await text(".github/workflows/release-candidate.yml");

    expect(workflow).toContain("workflow_dispatch:");
    // A full 40-character SHA is required and validated before anything is checked out.
    expect(workflow).toContain("'^[0-9a-f]{40}$'");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal GitHub Actions expression
    expect(workflow).toContain("ref: ${{ inputs.commit }}");
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$CANDIDATE_COMMIT"');

    // Exactly one upload of exactly one build.
    expect(countOccurrences(workflow, "actions/upload-artifact")).toBe(1);
    expect(countOccurrences(workflow, "npm pack")).toBe(1);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal GitHub Actions expression
    expect(workflow).toContain("ARTIFACT_NAME: weread-omni-candidate-${{ inputs.commit }}");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal GitHub Actions expression
    expect(workflow).toContain("name: ${{ env.ARTIFACT_NAME }}");
    expect(workflow).toContain("if-no-files-found: error");

    // The artifact carries everything release.yml needs to re-identify this build.
    for (const payload of ["pack-metadata.json", "candidate-metadata.json"]) {
      expect(workflow).toContain(payload);
    }
    for (const field of ["artifactName:", "commit:", "name:", "runId:", "tarball:", "version:", "sha512:", "sri:"]) {
      expect(workflow).toContain(field);
    }
    expect(workflow).toContain('source.name !== "weread-omni"');
    expect(workflow).toContain("packed.name !== source.name");
    expect(workflow).toContain("packed.version !== source.version");
    expect(workflow).toContain(String.raw`source.version.replace(/-(?:alpha|beta|rc)\.[1-9]\d*$/, "")`);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal workflow script
    expect(workflow).toContain("changelog.includes(`## [${changelogVersion}]`)");
    expect(workflow).toContain(String.raw`changelog.match(/^## \[Unreleased\][ \t]*\r?\n([\s\S]*?)(?=^## \[)/m)`);
    expect(workflow).toContain("CHANGELOG.md must begin with an empty [Unreleased] section");
    const unreleased = (changelog: string): RegExpMatchArray | null =>
      changelog.match(/^## \[Unreleased\][ \t]*\r?\n([\s\S]*?)(?=^## \[)/m);
    expect(unreleased("## [Unreleased]\n\n## [0.1.0]\n")).not.toBeNull();
    expect(unreleased("## [Unreleased] pending\n\n## [0.1.0]\n")).toBeNull();

    const pack = workflow.indexOf("- name: Build the retained tarball (once)");
    const metadata = workflow.indexOf("- name: Record and verify the retained package metadata");
    const upload = workflow.indexOf("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    const e2e = workflow.indexOf("- name: Test the retained tarball as a consumer");
    const recheck = workflow.indexOf("- name: Recheck the retained tarball digest");
    expect([pack, metadata, upload, e2e, recheck].every((index) => index >= 0)).toBe(true);
    expect(pack).toBeLessThan(metadata);
    expect(metadata).toBeLessThan(e2e);
    expect(e2e).toBeLessThan(recheck);
    expect(recheck).toBeLessThan(upload);
    expect(workflow.trimEnd()).toMatch(/retention-days: 90$/);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal GitHub Actions expression
    expect(workflow).toContain("WEREAD_PACKED_TARBALL: ${{ env.TARBALL }}");
  });

  it("publishes only the retained tarball and never repacks or bare-publishes", async () => {
    const workflow = await text(".github/workflows/release.yml");

    // The two ways this workflow could publish something other than the audited
    // candidate: rebuilding a tarball, or publishing the working directory.
    expect(workflow).not.toContain("npm pack");
    expect(workflow).toContain('npm publish "$TARBALL" --provenance --access public --tag "$NPM_DIST_TAG"');
    expect(countOccurrences(workflow, "npm publish")).toBe(1);
  });

  it("binds the publish to the named run, artifact, commit, tag, and digest", async () => {
    const workflow = await text(".github/workflows/release.yml");

    for (const input of ["tag:", "candidate_run_id:", "artifact_name:", "commit:", "expected_sha512:"]) {
      expect(workflow).toContain(input);
    }
    expect(countOccurrences(workflow, "required: true")).toBe(5);

    // Addressed by run ID, never by recency.
    expect(workflow).toContain('gh run download "$CANDIDATE_RUN_ID"');
    expect(workflow).toContain('--name "$ARTIFACT_NAME"');
    // `gh run list` is how a workflow would discover a run by recency; there is no
    // legitimate use for it here, so its absence pins the run-ID-only lookup.
    expect(workflow).not.toContain("gh run list");
    expect(workflow).not.toContain("--limit");

    // The run must exist, be finished, have succeeded, be a candidate run, and be the
    // same commit; the tag must resolve to that commit; the file must match the digest.
    expect(workflow).toContain('test "$(jq -r .status candidate-run.json)" = "completed"');
    expect(workflow).toContain('test "$(jq -r .conclusion candidate-run.json)" = "success"');
    expect(workflow).toContain('test "$(jq -r .path candidate-run.json)" = "$CANDIDATE_WORKFLOW"');
    expect(workflow).toContain('test "$(jq -r .head_sha candidate-run.json)" = "$CANDIDATE_COMMIT"');
    expect(workflow).toContain('test "$(git rev-list -n 1 "refs/tags/$RELEASE_TAG")" = "$CANDIDATE_COMMIT"');
    expect(workflow).toContain("timingSafeEqual");
    expect(workflow).toContain("retained tarball does not match the expected SHA-512");
    expect(workflow).toContain('test "$ARTIFACT_NAME" = "weread-omni-candidate-$CANDIDATE_COMMIT"');
    expect(workflow).toContain(
      "'^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-(alpha|beta|rc)\\.([1-9][0-9]*))?$'",
    );
    expect(workflow).toContain('source.name !== "weread-omni"');
    expect(workflow).toContain("packed.name !== source.name");
    expect(workflow).toContain("packed.version !== source.version");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal workflow script
    expect(workflow).toContain("const expectedTarball = `${source.name}-${source.version}.tgz`;");
    expect(workflow).toContain("metadata.tarball !== expectedTarball");
    expect(workflow).not.toContain('metadata.tarball.endsWith(".tgz")');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal workflow script
    expect(workflow).toContain("process.env.RELEASE_TAG !== `v${source.version}`");
    expect(workflow).toContain(String.raw`source.version.replace(/-(?:alpha|beta|rc)\.[1-9]\d*$/, "")`);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal workflow script
    expect(workflow).toContain("changelog.includes(`## [${changelogVersion}]`)");

    const identity = workflow.indexOf("- name: Verify the retained package identity and digest");
    const tooling = workflow.indexOf("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
    const auth = workflow.indexOf("- name: Confirm registry authentication");
    const publish = workflow.indexOf("- name: Recheck the digest and publish the retained tarball");
    const sourceIdentity = workflow.indexOf('source.name !== "weread-omni"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal workflow script
    const versionIdentity = workflow.indexOf("process.env.RELEASE_TAG !== `v${source.version}`");
    const canonicalTarball = workflow.indexOf("metadata.tarball !== expectedTarball");
    const resolveTarball = workflow.indexOf('resolve("candidate", expectedTarball)');
    const exportTarball = workflow.indexOf("appendFileSync(process.env.GITHUB_ENV");
    expect([identity, tooling, auth, publish].every((index) => index >= 0)).toBe(true);
    expect(identity).toBeLessThan(sourceIdentity);
    expect(sourceIdentity).toBeLessThan(versionIdentity);
    expect(versionIdentity).toBeLessThan(canonicalTarball);
    expect(canonicalTarball).toBeLessThan(resolveTarball);
    expect(resolveTarball).toBeLessThan(exportTarball);
    expect(identity).toBeLessThan(tooling);
    expect(tooling).toBeLessThan(auth);
    expect(auth).toBeLessThan(publish);
    expect(workflow.slice(publish)).toContain(
      'npm publish "$TARBALL" --provenance --access public --tag "$NPM_DIST_TAG"',
    );
    expect(workflow.slice(publish)).toContain("sha512sum");
  });

  it("keeps prereleases off npm latest and maps each channel explicitly", async () => {
    const workflow = await text(".github/workflows/release.yml");

    for (const mapping of [
      "*-alpha.*) npm_dist_tag=alpha",
      "*-beta.*) npm_dist_tag=beta",
      "*-rc.*) npm_dist_tag=rc",
      "*) npm_dist_tag=latest",
    ]) {
      expect(workflow).toContain(mapping);
    }
    expect(workflow).toContain('echo "NPM_DIST_TAG=$npm_dist_tag" >> "$GITHUB_ENV"');
  });

  it("configures a provenance-capable, least-privilege publish job", async () => {
    const candidate = await text(".github/workflows/release-candidate.yml");
    const workflow = await text(".github/workflows/release.yml");

    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("id-token: write");
    for (const releasePath of [candidate, workflow]) {
      expect(releasePath).toContain("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683");
      expect(releasePath).toContain("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
      expect(releasePath).toContain("node-version: 22.14.0");
      expect(releasePath).toContain('npm install -g "npm@11.15.0"');
      expect(releasePath).not.toMatch(/actions\/(?:checkout|setup-node|upload-artifact)@v\d/);
      expect(releasePath).not.toContain("npm@>=");
    }
    expect(candidate).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    expect(candidate).not.toContain("actions/download-artifact");
    expect(workflow).not.toContain("actions/download-artifact");
    expect(workflow).toContain("registry-url: https://registry.npmjs.org");
    expect(workflow).toContain("--provenance");
    // `workflow_dispatch` is open to every write-access user, so the only real approval
    // gate is a protected Environment holding the registry token.
    expect(workflow).toContain("environment: npm-publish");

    // The registry token is exposed to the authentication and publish steps only.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal GitHub Actions secret expression
    const authToken = "NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}";
    expect(workflow).toContain(authToken);
    expect(countOccurrences(workflow, authToken)).toBe(2);
    expect(countOccurrences(workflow, "NODE_AUTH_TOKEN")).toBe(2);
  });

  it("ships an explicit first-publish and Trusted Publishing runbook", async () => {
    const runbook = await text("docs/releasing.md");

    for (const heading of [
      "## Local release gate",
      "## First publish",
      "## Verify the public package",
      "## Remove the bootstrap credential",
      "## Trusted Publishing",
      "## Alpha, beta, and release-candidate versions",
      "## GitHub Release",
    ]) {
      expect(runbook).toContain(heading);
    }
    for (const command of [
      "WEREAD_LIVE=1 npm run test:live",
      "actions/workflows/release-candidate.yml/dispatches",
      "actions/workflows/release.yml/dispatches",
      "dist.integrity dist.attestations",
      'gh secret delete NPM_TOKEN --repo "$repo" --env npm-publish',
      'npm token revoke "$bootstrap_token_id"',
    ]) {
      expect(runbook).toContain(command);
    }
    expect(runbook).toContain("separate approval");
    expect(runbook).toContain("repository: teng-lin/weread-omni");
    expect(runbook).toContain("workflow: release.yml");
    expect(runbook).toContain("environment: npm-publish");
    expect(runbook).toContain("createPackage: true");
    expect(runbook).not.toContain("gh workflow run");
    expect(runbook).toContain("Promise.all([import('$package'), import('$package/cli'), import('$package/plugin')])");
    expect(runbook).not.toMatch(/read -r (?:candidate|release)_run_id/);
    expect(countOccurrences(runbook, "return_run_details: true")).toBe(2);
    expect(countOccurrences(runbook, "X-GitHub-Api-Version: 2022-11-28")).toBeGreaterThanOrEqual(2);
    expect(countOccurrences(runbook, "workflow_run_id")).toBeGreaterThanOrEqual(2);
    expect(countOccurrences(runbook, ".html_url")).toBeGreaterThanOrEqual(2);
    expect(runbook).toContain("same shell so the armed trap survives");
    expect(runbook).not.toMatch(/^NPM_TOKEN=/m);
    expect(runbook).toContain("changelog_version=");
    expect(runbook).toContain("--prerelease");
    expect(runbook).toContain('target = "## [" version "]"');
    expect(runbook).toContain("emit && /^## \\[/");
    expect(runbook).toContain("test -s release-notes.md");
    expect(runbook).not.toContain("sed -n");
    expect(runbook).toContain("git ls-remote --heads --tags origin");
    expect(runbook).toContain("--remotes=origin");
    expect(runbook).toContain("'+refs/tags/*:refs/audit/origin-tags/*'");
    expect(runbook).toContain("--glob='refs/audit/origin-tags/*'");
    expect(runbook).toContain("git for-each-ref refs/audit/origin-tags");
    expect(runbook).toContain("%(taggername) %(taggeremail)");
    expect(runbook).toContain("--format='%an <%ae>%n%cn <%ce>'");
    expect(runbook).not.toContain("--format='%H");
    expect(runbook).toContain('gh run rerun "$ci_run_id"');
    expect(runbook).toContain('test "$(jq -r .path <<<"$ci_run")" = ".github/workflows/ci.yml"');
    expect(runbook).toContain('test "$(jq -r .head_sha <<<"$ci_run")" = "$release_sha"');
    const localGate = runbook.indexOf("## Local release gate");
    const inventory = runbook.indexOf("git ls-remote --heads --tags origin");
    const visibility = runbook.indexOf('gh repo edit "$repo" --visibility public');
    const exactCi = runbook.indexOf('test "$(jq -r .head_sha <<<"$ci_run")" = "$release_sha"');
    const liveProbe = runbook.indexOf("WEREAD_LIVE=1 npm run test:live");
    const candidateDispatch = runbook.indexOf("actions/workflows/release-candidate.yml/dispatches");
    expect([localGate, inventory, visibility, exactCi, liveProbe, candidateDispatch].every((index) => index >= 0)).toBe(
      true,
    );
    expect(localGate).toBeLessThan(inventory);
    expect(inventory).toBeLessThan(visibility);
    expect(visibility).toBeLessThan(exactCi);
    expect(exactCi).toBeLessThan(liveProbe);
    expect(liveProbe).toBeLessThan(candidateDispatch);
    expect(runbook).toContain("npm_bootstrap_token=$(jq -er .token");
    const cleanupDefinition = runbook.indexOf("cleanup_bootstrap() {");
    const cleanupTrap = runbook.indexOf("trap 'cleanup_bootstrap || exit 1' EXIT");
    const tokenCreation = runbook.indexOf("npm token create --json");
    expect(cleanupDefinition).toBeGreaterThanOrEqual(0);
    expect(cleanupDefinition).toBeLessThan(tokenCreation);
    expect(cleanupTrap).toBeLessThan(tokenCreation);

    const cleanupBody = runbook.slice(cleanupDefinition, cleanupTrap);
    expect(cleanupBody).toContain('test "$bootstrap_cleanup_armed" -eq 1 || return 0');
    expect(cleanupBody).toContain("if ! gh secret list");
    expect(cleanupBody).toContain("if ! npm token list");
    expect(cleanupBody).toContain("BOOTSTRAP CLEANUP REQUIRES MANUAL ACTION");
    expect(cleanupBody.indexOf("bootstrap_cleanup_armed=0")).toBeGreaterThan(
      cleanupBody.indexOf("'all(.[]; .key != $id and .name != $name)'"),
    );
    expect(runbook).toContain("cleanup_bootstrap\ntrap - EXIT HUP INT TERM");
    expect(runbook).toContain('gh secret delete NPM_TOKEN --repo "$repo" --env npm-publish || true');
    expect(runbook).toContain('npm token revoke "$bootstrap_token_id" || true');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal shell fallback
    expect(runbook).toContain('--arg name "${token_name:-}"');
    for (const flag of [
      "--expires=1",
      "--packages-all",
      "--packages-and-scopes-permission=read-write",
      "--orgs-permission=no-access",
      "--bypass-2fa",
    ]) {
      expect(runbook).toContain(flag);
    }
    expect(runbook).toContain("npm token list --json");
    expect(runbook).toContain("'[.[] | select(.name == $name)]'");
    expect(runbook).toContain("bootstrap_token_id=$(jq -er '.[0].key'");
    expect(runbook).not.toContain('--packages="$package"');
    expect(runbook).not.toContain(".key // .id");
    expect(runbook).toContain("unset npm_bootstrap_token token_json");
    expect(runbook).not.toContain("gh secret set NPM_TOKEN --body");
  });
});
