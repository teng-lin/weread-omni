import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileApiClient } from "../../src/api/mobile-client.js";
import { type CliDependencies, runCli } from "../../src/cli.js";
import { ContentLibrary } from "../../src/library/store.js";

const fixtureCredentials = {
  vid: "42",
  accessToken: "access",
  refreshToken: "refresh",
  deviceId: "device",
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sink() {
  const chunks: string[] = [];
  return { stream: { write: (chunk: string) => chunks.push(chunk) }, read: () => chunks.join("") };
}

function harness(): {
  value: CliDependencies;
  stdout: ReturnType<typeof sink>;
  stderr: ReturnType<typeof sink>;
  root: string;
} {
  const root = mkdtempSync(join(tmpdir(), "weread-library-cli-"));
  roots.push(root);
  const stdout = sink();
  const stderr = sink();
  return {
    stdout,
    stderr,
    root,
    value: {
      getClient: vi.fn(() => new MobileApiClient({ credentials: fixtureCredentials, env: {} })),
      getIdentity: () => ({ vid: fixtureCredentials.vid, deviceId: "device", source: "file" as const }),
      env: { WEREAD_LIBRARY_DIR: root },
      stdout: stdout.stream,
      stderr: stderr.stream,
      isTTY: false,
      confirm: vi.fn(async () => true),
    },
  };
}

const run = (deps: CliDependencies, ...args: string[]): Promise<number> =>
  runCli(["node", "weread-omni", ...args], deps);

describe("weread-omni library", () => {
  it("reports where content is stored without creating anything", async () => {
    const test = harness();
    rmSync(test.root, { recursive: true, force: true });

    await expect(run(test.value, "library", "path", "--json")).resolves.toBe(0);

    expect(JSON.parse(test.stdout.read())).toEqual({ path: test.root, exists: false });
  });

  it("summarises an empty library", async () => {
    const test = harness();

    await expect(run(test.value, "library", "status", "--json")).resolves.toBe(0);

    expect(JSON.parse(test.stdout.read())).toMatchObject({
      path: test.root,
      chapters: 0,
      books: 0,
      articles: 0,
      blobs: 0,
    });
  });

  it("counts what the library holds", async () => {
    const test = harness();
    const library = await ContentLibrary.open({ vid: fixtureCredentials.vid, root: test.root, env: {} });
    await library.putChapterContent({ bookId: "b1", chapterUid: 1, format: "epub", html: "<p>one</p>" });
    await library.putChapterContent({ bookId: "b1", chapterUid: 2, format: "epub", html: "<p>two</p>" });
    library.close();

    await expect(run(test.value, "library", "status", "--json")).resolves.toBe(0);

    expect(JSON.parse(test.stdout.read())).toMatchObject({ chapters: 2, blobs: 2 });
  });

  it("reports a healthy library as verified", async () => {
    const test = harness();
    const library = await ContentLibrary.open({ vid: fixtureCredentials.vid, root: test.root, env: {} });
    await library.putChapterContent({ bookId: "b1", chapterUid: 1, format: "epub", html: "<p>intact</p>" });
    library.close();

    await expect(run(test.value, "library", "verify", "--json")).resolves.toBe(0);

    expect(JSON.parse(test.stdout.read())).toEqual({ ok: true, problems: [] });
  });

  it("fails verification when a payload has gone missing", async () => {
    const test = harness();
    const library = await ContentLibrary.open({ vid: fixtureCredentials.vid, root: test.root, env: {} });
    await library.putChapterContent({ bookId: "b1", chapterUid: 1, format: "epub", html: "<p>doomed</p>" });
    library.close();
    rmSync(join(test.root, "blobs"), { recursive: true, force: true });

    await expect(run(test.value, "library", "verify", "--json")).resolves.toBe(1);

    expect(test.stdout.read()).toContain("missing or unreadable");
    expect(test.stderr.read()).toContain("the content library reported problems");
  });

  it("prints human-readable output without --json", async () => {
    const test = harness();

    await expect(run(test.value, "library", "path")).resolves.toBe(0);

    const written = test.stdout.read();
    expect(JSON.parse(written)).toMatchObject({ path: test.root });
    // The human formatter is the same one the operation commands use, so output stays consistent.
    expect(written.trimEnd().startsWith("{")).toBe(true);
  });
});
