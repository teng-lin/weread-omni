import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { binPath, shellOnWindows } from "../../support/platform.js";

// Packed-artifact smoke test. Unlike release.test.ts (which inspects package.json and
// workflow strings) and `npm pack --dry-run` (which only lists files), this actually packs
// the tarball, installs it into a throwaway prefix, imports all four published exports
// through the real exports map, runs both installed bins, and inspects the archive
// itself — catching files-allowlist, subpath-export, and stale-build regressions that
// string inspection cannot. It lives under test/e2e/ so it stays out of `npm test` and
// `npm run test:cov` (both scope to test/unit + test/integration).

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

// Planted in dist immediately before packing. `npm run build` deletes dist before
// invoking tsc, so a tarball containing this name proves the clean-build step was lost
// and that stale output can ship.
const staleSentinel = "__stale-build-sentinel__.js";

const cleanups: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) {
    await cleanup().catch(() => {});
  }
});

describe("packed artifact", () => {
  it("packs, installs, and runs the SDK and CLI surfaces", async () => {
    const manifest = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
      name: string;
      bin: Record<string, string>;
    };
    const packageName = manifest.name;
    const binNames = Object.keys(manifest.bin);

    let tarballPath: string;
    if (process.env.WEREAD_PACKED_TARBALL) {
      tarballPath = resolve(repoRoot, process.env.WEREAD_PACKED_TARBALL);
    } else {
      await mkdir(join(repoRoot, "dist"), { recursive: true });
      const sentinelPath = join(repoRoot, "dist", staleSentinel);
      await writeFile(sentinelPath, "export const stale = true;\n");
      cleanups.push(() => rm(sentinelPath, { force: true }));

      // `npm pack` runs `prepack` (clean + build) and emits the tarball into the repo root.
      const { stdout: packStdout } = await execFileAsync("npm", ["pack", "--silent"], {
        ...shellOnWindows,
        cwd: repoRoot,
      });
      const tarballName = packStdout.trim().split("\n").pop()?.trim();
      expect(tarballName, "npm pack should print the tarball filename").toBeTruthy();
      tarballPath = join(repoRoot, tarballName as string);
      cleanups.push(() => rm(tarballPath, { force: true }));
    }

    const { stdout: listing } = await execFileAsync("tar", ["-tzf", tarballPath]);
    const entries = listing
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.replace(/^package\//, ""))
      .filter((entry) => !entry.endsWith("/"));

    // The clean build removed the sentinel, so no stale dist output survived packing.
    expect(entries.filter((entry) => entry.includes(staleSentinel))).toEqual([]);

    expect(entries.filter((entry) => entry.startsWith("dist/crypto/"))).toEqual([]);
    expect(entries.filter((entry) => entry.startsWith("dist/vendor/"))).toEqual([]);
    // Non-shipping planning documents are excluded from the docs allowlist.
    expect(entries.filter((entry) => entry.startsWith("docs/plans/"))).toEqual([]);

    // Declarations for all three entry points, plus the shipped docs and skill.
    for (const declaration of ["dist/index.d.ts", "dist/cli.d.ts", "dist/plugin.d.ts"]) {
      expect(entries).toContain(declaration);
    }
    expect(entries.filter((entry) => entry.startsWith("docs/")).length).toBeGreaterThan(0);
    expect(entries.filter((entry) => entry.startsWith("skills/")).length).toBeGreaterThan(0);
    expect(entries).toContain("README.md");
    expect(entries).toContain("LICENSE");

    const installDir = await mkdtemp(join(tmpdir(), "weread-pack-smoke-"));
    cleanups.push(() => rm(installDir, { recursive: true, force: true }));

    // Install the tarball into an isolated prefix. --no-save keeps it a bare
    // install (there is no package.json in installDir to update).
    await execFileAsync("npm", ["install", tarballPath, "--no-save", "--no-package-lock"], {
      ...shellOnWindows,
      cwd: installDir,
    });

    const typeProbePath = join(installDir, "consumer.mts");
    await writeFile(
      typeProbePath,
      [
        `import * as sdk from "${packageName}";`,
        `import * as cli from "${packageName}/cli";`,
        `import * as plugin from "${packageName}/plugin";`,
        "void [sdk, cli, plugin];",
        "",
      ].join("\n"),
    );
    await execFileAsync(
      process.execPath,
      [
        join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
        "--noEmit",
        "--strict",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--types",
        "node",
        typeProbePath,
      ],
      { cwd: installDir },
    );

    // Resolve all three subpaths as a real consumer does — through the exports map from
    // a module outside the package — rather than by reaching into dist/ directly.
    const probePath = join(installDir, "probe.mjs");
    await writeFile(
      probePath,
      [
        `import { AccountManager, createEinkClient, WeReadClient } from "${packageName}";`,
        `import { createProgram } from "${packageName}/cli";`,
        `import { CLIENT_PLUGIN_API_VERSION } from "${packageName}/plugin";`,
        "process.stdout.write(",
        "  JSON.stringify({",
        "    sdk: typeof WeReadClient,",
        "    accounts: typeof AccountManager,",
        "    einkSdk: typeof createEinkClient,",
        "    cli: typeof createProgram,",
        "    pluginApi: CLIENT_PLUGIN_API_VERSION,",
        "  }),",
        ");",
        "",
      ].join("\n"),
    );
    const { stdout: probeStdout } = await execFileAsync(process.execPath, [probePath], { cwd: installDir });
    expect(JSON.parse(probeStdout)).toEqual({
      sdk: "function",
      accounts: "function",
      einkSdk: "function",
      cli: "function",
      pluginApi: 1,
    });

    // Run every declared bin from the installed .bin directory.
    const binDir = join(installDir, "node_modules", ".bin");
    for (const bin of binNames) {
      const { stdout, stderr } = await execFileAsync(binPath(binDir, bin), ["--help"], shellOnWindows);
      expect(stdout.length + stderr.length, `${bin} --help should print output`).toBeGreaterThan(0);
      expect(stdout).toContain("Usage:");
    }
  }, 300_000);
});
