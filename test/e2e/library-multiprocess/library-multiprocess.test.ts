import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { expectPosixMode } from "../../support/posix.js";

/**
 * Cross-process behaviour of the content library, exercised with real spawned processes.
 *
 * The in-process suites open several `ContentLibrary` instances against one root, which shares a
 * single JavaScript thread. That cannot show what happens when two operating-system processes
 * contend: write-ahead logging across processes, `link`, `fsync`, and the file locks SQLite takes
 * are all kernel behaviour. It lives under test/e2e so it stays out of `npm test` and the coverage
 * run, both of which scope to unit and integration.
 */

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
// An ESM specifier, not a path: on Windows an absolute path parses as a URL whose scheme is the
// drive letter, and the loader rejects it. `file://` is correct on every platform.
const storeEntry = pathToFileURL(join(repoRoot, "dist", "library", "store.js")).href;

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "weread-library-e2e-"));
  roots.push(root);
  return root;
}

/** Run one short program in its own process against the built library. */
async function inProcess(root: string, body: string, argument = ""): Promise<string> {
  const source = `
    import { ContentLibrary } from ${JSON.stringify(storeEntry)};
    const root = ${JSON.stringify(root)};
    const arg = ${JSON.stringify(argument)};
    const library = await ContentLibrary.open({ vid: "vid-e2e", root, env: {} });
    try { ${body} } finally { library.close(); }
  `;
  const { stdout } = await execFileAsync(process.execPath, ["--no-warnings", "--input-type=module", "--eval", source], {
    cwd: repoRoot,
    timeout: 60_000,
  });
  return stdout.trim();
}

const chapter = (uid: number, html: string) =>
  `{ bookId: "b-shared", chapterUid: ${uid}, format: "epub", html: ${JSON.stringify(html)} }`;

describe("content library across processes", () => {
  it("makes content stored by one process visible to the next", async () => {
    const root = await temporaryRoot();

    await inProcess(root, `await library.putChapterContent(${chapter(1, "<p>from the writer</p>")});`);
    const seen = await inProcess(
      root,
      `const content = await library.getChapterContent("b-shared", 1);
       process.stdout.write(content?.html ?? "MISSING");`,
    );

    expect(seen).toBe("<p>from the writer</p>");
  });

  it("stores one payload when several processes write identical content concurrently", async () => {
    // Two processes racing on the same digest is the ordinary case for two accounts, or one
    // account re-fetching. Content addressing means both write byte-identical files, so whichever
    // wins, the result is the same file.
    const root = await temporaryRoot();
    const html = "<p>written by everyone</p>";

    await Promise.all(
      Array.from({ length: 4 }, (_unused, index) =>
        inProcess(root, `await library.putChapterContent(${chapter(index, html)});`),
      ),
    );

    const stats = JSON.parse(await inProcess(root, "process.stdout.write(JSON.stringify(library.stats()));"));
    expect(stats.chapters).toBe(4);
    // Four chapters, one distinct payload between them.
    expect(stats.blobs).toBe(1);

    const digest = createHash("sha256").update(Buffer.from(html, "utf8")).digest("hex");
    const blob = join(root, "blobs", "sha256", digest.slice(0, 2), digest);
    expect((await stat(blob)).size).toBe(Buffer.byteLength(html));
  });

  it("keeps every write when processes write different content concurrently", async () => {
    const root = await temporaryRoot();

    await Promise.all(
      Array.from({ length: 6 }, (_unused, index) =>
        inProcess(root, `await library.putChapterContent(${chapter(index, `<p>chapter ${index}</p>`)});`),
      ),
    );

    const stats = JSON.parse(await inProcess(root, "process.stdout.write(JSON.stringify(library.stats()));"));
    expect(stats.chapters).toBe(6);
    expect(stats.blobs).toBe(6);
  });

  it("reports no damage after concurrent writes", async () => {
    const root = await temporaryRoot();

    await Promise.all(
      Array.from({ length: 5 }, (_unused, index) =>
        inProcess(root, `await library.putChapterContent(${chapter(index, `<p>body ${index}</p>`)});`),
      ),
    );

    const report = JSON.parse(await inProcess(root, "process.stdout.write(JSON.stringify(await library.verify()));"));
    expect(report).toEqual({ ok: true, problems: [] });
  });

  it("keeps the highest chapter index when processes race on the same book", async () => {
    // Replace-on-newer is a single INSERT .. ON CONFLICT .. WHERE, so the comparison happens inside
    // the database rather than between a separate read and write.
    const root = await temporaryRoot();

    await Promise.all(
      [3, 11, 7].map((synckey) =>
        inProcess(
          root,
          `library.putChapterIndex(
             { bookId: "b-toc", synckey: ${synckey},
               chapters: Array.from({ length: ${synckey} }, (_u, i) => ({ chapterUid: i, chapterIdx: i })) },
             "eink",
           );`,
        ),
      ),
    );

    const stored = JSON.parse(
      await inProcess(root, `process.stdout.write(JSON.stringify(library.getChapterIndex("b-toc", "eink")));`),
    );
    expect(stored.synckey).toBe(11);
    expect(stored.chapters).toHaveLength(11);
  });

  it("leaves the database readable by its owner alone", async () => {
    const root = await temporaryRoot();
    await inProcess(root, `await library.putChapterContent(${chapter(1, "<p>private</p>")});`);

    for (const name of ["library.db", "library.db-wal"]) {
      const path = join(root, name);
      // The -wal file is gone once the last connection checkpoints, so absence is not a failure.
      const present = await stat(path).then(
        () => true,
        () => false,
      );
      // Windows has no POSIX mode bits -- it reports a synthetic mode and controls access through
      // ACLs -- so the shared helper skips the assertion there rather than comparing a fiction.
      if (present) expectPosixMode(path, 0, 0o077);
    }
  });
});
