import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicAccountArticlesPage, ReviewSingleResponse } from "../../src/api/types.js";
import { type CliDependencies, type CliStore, runCli } from "../../src/cli.js";
import { ContentLibrary } from "../../src/library/store.js";

/**
 * Proof that the open library actually reaches the artifact commands.
 *
 * The store itself and the public-account paths are covered elsewhere. What is only true if the
 * wiring is right is that `weread public-accounts export` hands its library down far enough to be
 * consulted, and nothing below the command layer can show that.
 */

const LONG_TEXT = "article body ".repeat(30);

vi.mock("@teng-lin/agent-fetch", () => ({
  extractFromHtml: vi.fn(() => ({
    content: `<article>${LONG_TEXT}</article>`,
    textContent: LONG_TEXT,
    markdown: `# ${LONG_TEXT}`,
    isAccessibleForFree: true,
  })),
  htmlToMarkdown: vi.fn((html: string) => html.replace(/<[^>]+>/g, "")),
}));

const directories: string[] = [];
const opened: ContentLibrary[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const library of opened.splice(0)) {
    try {
      library.close();
    } catch {
      // Closed by the test.
    }
  }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

const ACCOUNT = "MP_WXS_7";

function sink() {
  const chunks: string[] = [];
  return { stream: { write: (chunk: string) => chunks.push(chunk) }, read: () => chunks.join("") };
}

const detail = (reviewId: string): ReviewSingleResponse => ({
  review: {
    reviewId,
    createTime: 1_700_000_000,
    mpInfo: {
      doc_url: `https://mp.weixin.qq.com/s?id=${reviewId}`,
      title: `Title ${reviewId}`,
      mp_name: "Some Account",
      time: 1_700_000_000,
    },
  },
});

/** A store exposing exactly the operations the artifact commands require. */
function storeFor(reviewIds: string[]): { store: CliStore; single: ReturnType<typeof vi.fn> } {
  const articles = vi.fn(
    async (accountId: string, request: { offset?: number } = {}): Promise<PublicAccountArticlesPage> => ({
      accountId,
      articles: (request.offset ?? 0) === 0 ? reviewIds.map((reviewId) => ({ reviewId })) : [],
      returnedCount: (request.offset ?? 0) === 0 ? reviewIds.length : 0,
      requestedOffset: request.offset ?? 0,
      hasMore: 0,
    }),
  );
  const single = vi.fn(async (reviewId: string) => detail(reviewId));
  return {
    single,
    store: {
      name: "default",
      backend: "eink",
      client: {
        publicAccounts: { articles, paidContent: vi.fn(), subscriptions: vi.fn() },
        review: { single },
      } as unknown as CliStore["client"],
      readIdentity: () => ({ vid: "42", deviceId: "device", source: "file" as const }),
    },
  };
}

function stubSource(): () => number {
  let calls = 0;
  vi.stubGlobal("fetch", async () => {
    calls += 1;
    return new Response(`<html>${LONG_TEXT}</html>`, { status: 200, headers: { "content-type": "text/html" } });
  });
  return () => calls;
}

describe("weread public-accounts export with a library", () => {
  it("consults the library the CLI opened, so a second export fetches nothing", async () => {
    const library = await ContentLibrary.open({
      vid: "42",
      root: temporaryDirectory("weread-cli-mp-lib-"),
      env: {},
    });
    opened.push(library);
    const { store, single } = storeFor(["r-1", "r-2"]);
    const calls = stubSource();
    const parent = temporaryDirectory("weread-cli-mp-out-");
    const stdout = sink();

    const dependencies: CliDependencies = {
      stores: [store],
      library,
      env: {},
      stdout: stdout.stream,
      stderr: sink().stream,
      isTTY: false,
    };

    const first = await runCli(
      [
        "node",
        "weread",
        "--account",
        "default",
        "public-accounts",
        "export",
        ACCOUNT,
        "--out",
        join(parent, "a"),
        "--json",
      ],
      dependencies,
    );
    const second = await runCli(
      [
        "node",
        "weread",
        "--account",
        "default",
        "public-accounts",
        "export",
        ACCOUNT,
        "--out",
        join(parent, "b"),
        "--json",
      ],
      dependencies,
    );

    expect(first).toBe(0);
    expect(second).toBe(0);
    // Two articles, fetched once each despite two exports. Without the wiring this would be four.
    expect(calls()).toBe(2);
    expect(single).toHaveBeenCalledTimes(2);
    expect(library.stats().articles).toBe(2);
  });

  it("fetches every time when the CLI opened no library", async () => {
    const { store, single } = storeFor(["r-1"]);
    const calls = stubSource();
    const parent = temporaryDirectory("weread-cli-mp-nolib-");

    const dependencies: CliDependencies = {
      stores: [store],
      env: {},
      stdout: sink().stream,
      stderr: sink().stream,
      isTTY: false,
    };

    await runCli(
      [
        "node",
        "weread",
        "--account",
        "default",
        "public-accounts",
        "export",
        ACCOUNT,
        "--out",
        join(parent, "a"),
        "--json",
      ],
      dependencies,
    );
    await runCli(
      [
        "node",
        "weread",
        "--account",
        "default",
        "public-accounts",
        "export",
        ACCOUNT,
        "--out",
        join(parent, "b"),
        "--json",
      ],
      dependencies,
    );

    expect(calls()).toBe(2);
    expect(single).toHaveBeenCalledTimes(2);
  });

  it("reuses stored articles for the feed command too", async () => {
    const library = await ContentLibrary.open({
      vid: "42",
      root: temporaryDirectory("weread-cli-mp-feed-"),
      env: {},
    });
    opened.push(library);
    const { store } = storeFor(["r-1"]);
    const calls = stubSource();
    const parent = temporaryDirectory("weread-cli-mp-feedout-");

    const dependencies: CliDependencies = {
      stores: [store],
      library,
      env: {},
      stdout: sink().stream,
      stderr: sink().stream,
      isTTY: false,
    };

    for (const name of ["a.json", "b.json"]) {
      const code = await runCli(
        [
          "node",
          "weread",
          "--account",
          "default",
          "public-accounts",
          "feed",
          ACCOUNT,
          "--format",
          "json",
          "--out",
          join(parent, name),
          "--json",
        ],
        dependencies,
      );
      expect(code).toBe(0);
    }

    expect(calls()).toBe(1);
  });
});
