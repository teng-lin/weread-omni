import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { binPath, shellOnWindows } from "../../support/platform.js";

// Runtime behaviour of the PACKED artifact, one level past pack-smoke.
//
// pack-smoke proves the tarball installs and that the entry points and the bin resolve. It never
// runs a command. These tests drive the installed executable the way a real host does, through the
// CLI's JSON envelope. A build that resolves but cannot register its commands — a bad bundled
// dependency, a broken shebang, an entry point that only works from source — passes pack-smoke and
// fails here.
//
// Hermetic: nothing reaches WeRead. Tool listing and health checks need no upstream at all, and
// the one test that exercises an SDK call preloads a module that replaces global `fetch`.

const kebab = (value: string): string => value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

let installDir: string;
let binDir: string;
/** Preloaded into the CLI child to answer every request locally. */
let fakeUpstream: string;
/** Full canonical test provider loaded through the packed plugin entry point. */
let packedPlugin: string;

const cleanups: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
});

beforeAll(async () => {
  installDir = await mkdtemp(join(tmpdir(), "weread-packed-runtime-"));
  cleanups.push(() => rm(installDir, { recursive: true, force: true }));

  let tarballPath: string;
  if (process.env.WEREAD_PACKED_TARBALL) {
    tarballPath = resolve(repoRoot, process.env.WEREAD_PACKED_TARBALL);
  } else {
    // Pack into the scratch directory so another suite cannot clobber the same filename.
    const { stdout } = await execFileAsync("npm", ["pack", "--silent", "--pack-destination", installDir], {
      cwd: repoRoot,
      ...shellOnWindows,
    });
    const tarballName = stdout.trim().split("\n").pop()?.trim();
    expect(tarballName, "npm pack should print the tarball filename").toBeTruthy();
    tarballPath = join(installDir, tarballName as string);
  }

  await execFileAsync("npm", ["install", tarballPath, "--no-save", "--no-package-lock"], {
    cwd: installDir,
    ...shellOnWindows,
  });
  binDir = join(installDir, "node_modules", ".bin");

  packedPlugin = join(installDir, "packed-plugin.mjs");
  await writeFile(
    packedPlugin,
    [
      'import { MobileApiClient } from "weread-omni";',
      "const provider = {",
      '  async login() { throw new Error("not used"); },',
      "  async open({ state, env, fetchImpl, saveState }) {",
      "    const client = new MobileApiClient({",
      "      credentials: state, env, fetchImpl,",
      "      onCredentials: (next) => saveState(next),",
      "    });",
      "    return { client, identity: { vid: state.vid, deviceId: state.deviceId } };",
      "  },",
      "};",
      "export default {",
      '  meta: { name: "packed-test-plugin", version: "0.1.0", apiVersion: 1 },',
      "  clients: { packed: provider },",
      "};",
      "",
    ].join("\n"),
  );
  const accountDirectory = join(installDir, "accounts", "default");
  await mkdir(join(accountDirectory, "clients"), { recursive: true });
  await writeFile(join(accountDirectory, "account.json"), `${JSON.stringify({ version: 1, client: "packed" })}\n`);
  await writeFile(
    join(accountDirectory, "clients", "packed.json"),
    `${JSON.stringify({
      vid: "42",
      refreshToken: "refresh-token",
      deviceId: "0123456789abcdef0123456789abcdef",
    })}\n`,
  );

  fakeUpstream = join(installDir, "fake-upstream.mjs");
  await writeFile(
    fakeUpstream,
    [
      "// Replaces global fetch so the packed CLI exercises its real request path without a network.",
      "const json = (body) => new Response(JSON.stringify(body), {",
      '  headers: { "content-type": "application/json" },',
      "});",
      "globalThis.fetch = async (input) => {",
      "  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));",
      '  if (url.pathname === "/login") {',
      '    return json({ vid: "42", accessToken: "access-token", refreshToken: "refresh-token" });',
      "  }",
      '  if (url.pathname === "/book/info") {',
      '    const bookId = url.searchParams.get("bookId");',
      '    return json({ bookId, title: bookId === "pipe-stress" ? "x".repeat(1024 * 1024) : "Dune", author: "Frank Herbert" });',
      "  }",
      '  return json({ errCode: -1, errMsg: "unexpected " + url.pathname });',
      "};",
      "",
    ].join("\n"),
  );
}, 300_000);

const credentialEnv = {
  WEREAD_VID: "42",
  WEREAD_REFRESH_TOKEN: "refresh-token",
  WEREAD_DEVICE_ID: "0123456789abcdef0123456789abcdef",
};

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runBin(bin: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath(binDir, bin), args, {
      cwd: installDir,
      ...shellOnWindows,
      env: { ...process.env, WEREAD_CONFIG_DIR: installDir, WEREAD_PLUGINS: packedPlugin, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function runBinWithClosedStdout(bin: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath(binDir, bin), args, {
      cwd: installDir,
      ...shellOnWindows,
      env: { ...process.env, WEREAD_CONFIG_DIR: installDir, WEREAD_PLUGINS: packedPlugin, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.once("data", (chunk: Buffer) => {
      stdout = chunk.subarray(0, 100).toString();
      child.stdout.destroy();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("packed CLI", () => {
  // The operation-count tripwire the MCP `tools/list` assertions used to carry. Asserted against
  // the PACKED build, because a command that fails to register from the tarball — a bundling gap, a
  // provider that only resolves from source — would simply be missing from `--help`, and every
  // in-process test would still pass.
  it("registers every canonical operation as a command in the packed build", async () => {
    const packedRoot = join(installDir, "node_modules", "weread-omni", "dist", "index.js");
    const { PUBLIC_OPERATIONS } = (await import(pathToFileURL(packedRoot).href)) as {
      PUBLIC_OPERATIONS: Record<string, readonly string[]>;
    };
    const expected = Object.entries(PUBLIC_OPERATIONS).flatMap(([resource, actions]) =>
      actions.map((action) => `${kebab(resource)} ${kebab(action)}`),
    );
    expect(expected).toHaveLength(40);

    const leaves = new Set<string>();
    for (const resource of new Set(expected.map((leaf) => leaf.split(" ")[0] as string))) {
      const help = await runBin("weread", [resource, "--help"], credentialEnv);
      expect(help.code, `${resource} --help: ${help.stderr}`).toBe(0);
      for (const line of help.stdout.split("\n")) {
        const action = /^\s{2}([a-z][a-z-]*)\b/.exec(line)?.[1];
        if (action && action !== "help") leaves.add(`${resource} ${action}`);
      }
    }
    expect([...expected].sort().filter((leaf) => !leaves.has(leaf))).toEqual([]);
  }, 120_000);

  it("prints machine-readable identity without contacting anything", async () => {
    const result = await runBin("weread", ["whoami", "--json"], credentialEnv);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      vid: "42",
      deviceId: credentialEnv.WEREAD_DEVICE_ID,
      source: "file",
    });
  }, 30_000);

  it("emits exactly one JSON document for a successful read", async () => {
    const result = await runBin("weread", ["book", "info", "9787532776870", "--json"], {
      ...credentialEnv,
      NODE_OPTIONS: `--import ${JSON.stringify(pathToFileURL(fakeUpstream).href)}`,
    });
    expect(result.code, result.stderr).toBe(0);
    // One line, one document: anything else breaks a caller that pipes this into `jq`.
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual({
      bookId: "9787532776870",
      title: "Dune",
      author: "Frank Herbert",
    });
  }, 30_000);

  it("reports an upstream refusal on stderr and a non-zero exit, leaving stdout clean", async () => {
    const result = await runBin("weread", ["book", "detail", "9787532776870", "--json"], {
      ...credentialEnv,
      NODE_OPTIONS: `--import ${JSON.stringify(pathToFileURL(fakeUpstream).href)}`,
    });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/unexpected \/book\/detailinfo/);
  }, 30_000);

  it("treats an early-closing stdout consumer as successful pipeline completion", async () => {
    const result = await runBinWithClosedStdout("weread", ["book", "info", "pipe-stress", "--json"], {
      ...credentialEnv,
      NODE_OPTIONS: `--import ${JSON.stringify(pathToFileURL(fakeUpstream).href)}`,
    });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).not.toBe("");
    expect(result.stderr).not.toMatch(/EPIPE|node:events|Unhandled 'error'/);
  }, 30_000);
});
