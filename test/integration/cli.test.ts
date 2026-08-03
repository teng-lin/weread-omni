import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_OPERATIONS } from "../../src/api/operations.js";
import { type Credentials, saveCredentials, storePath } from "../../src/auth/credentials.js";
import {
  type CliDependencies,
  type CliStore,
  type CliStoreCommandContext,
  type CliStoreIdentity,
  type Command,
  type CommandContext,
  createProgram,
  isMain,
  runCli,
} from "../../src/cli.js";
import { AuthError, WeReadApiError } from "../../src/errors.js";
import { MobileApiClient } from "../../src/index.js";

const directories: string[] = [];
// Writes are open by default; the switch only ever closes them.
const enabledGates = {} satisfies NodeJS.ProcessEnv;

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function sink() {
  let value = "";
  return {
    stream: {
      write(chunk: string) {
        value += chunk;
      },
    },
    read: () => value,
  };
}

function dependencies(): {
  value: CliDependencies;
  stdout: ReturnType<typeof sink>;
  stderr: ReturnType<typeof sink>;
} {
  const stdout = sink();
  const stderr = sink();
  return {
    stdout,
    stderr,
    value: {
      getClient: vi.fn(() => new MobileApiClient({ credentials: fixtureCredentials, env: {} })),
      env: enabledGates,
      stdout: stdout.stream,
      stderr: stderr.stream,
      isTTY: false,
      confirm: vi.fn(async () => true),
    },
  };
}

function leafCommands(command: Command, prefix: string[] = []): string[] {
  return command.commands.flatMap((child) => {
    const path = [...prefix, child.name()];
    return child.commands.length === 0 ? [path.join(" ")] : leafCommands(child, path);
  });
}

function commandAt(program: Command, path: string): Command {
  let current = program;
  for (const name of path.split(" ")) {
    const child = current.commands.find((command) => command.name() === name);
    if (!child) throw new Error(`missing command ${path}`);
    current = child;
  }
  return current;
}

const fixtureCredentials: Credentials = {
  vid: "123",
  refreshToken: "refresh",
  deviceId: "eink33000000000000000000000000",
};

const expectedLeaves = [
  "ai ask-book",
  "ai suggest",
  "book chapters",
  "book detail",
  "book info",
  "book progress",
  "discover recommend",
  "discover similar",
  "doctor",
  "import book",
  "library path",
  "library status",
  "library verify",
  "notes add-bookmark",
  "notes best",
  "notes bookmarks",
  "notes mine",
  "notes notebooks",
  "notes read-reviews",
  "notes recent",
  "notes remove-bookmark",
  "notes underlines",
  "notes update-bookmark",
  "public-accounts articles",
  "public-accounts paid-content",
  "public-accounts export",
  "public-accounts feed",
  "public-accounts resolve-article",
  "public-accounts subscribe",
  "public-accounts subscriptions",
  "public-accounts unsubscribe",
  "read-data detail",
  "review add",
  "review delete",
  "review edit",
  "review list",
  "review single",
  "search books",
  "search suggest",
  "shelf add",
  "shelf delete",
  "shelf mark-finished",
  "shelf mark-reading",
  "shelf pin",
  "shelf set-private",
  "shelf sync",
  "whoami",
] as const;

const expectedOptions: Record<(typeof expectedLeaves)[number], string[]> = {
  "ai ask-book": ["--delay-cap-ms <milliseconds>", "--intent <intent>", "--max-polls <number>"],
  "ai suggest": ["--chapter-uid <number>", "--mp-review-id <id>", "--range <range>", "--toolbar"],
  "book chapters": [],
  "book detail": ["--count <number>"],
  "book info": [],
  "book progress": [],
  "discover recommend": ["--count <number>", "--max-idx <number>"],
  "discover similar": ["--count <number>", "--max-idx <number>", "--session-id <id>"],
  doctor: [],
  "library path": [],
  "library status": [],
  "library verify": [],
  "import book": [],
  "notes add-bookmark": [
    "--book-version <number>",
    "--chapter-name <name>",
    "--color-style <number>",
    "--context-abstract <text>",
    "--style <number>",
    "--type <number>",
  ],
  "notes best": ["--chapter-uid <number>", "--count <number>", "--max-idx <number>", "--synckey <number>"],
  "notes bookmarks": ["--synckey <number>"],
  "notes mine": ["--count <number>", "--synckey <number>"],
  "notes notebooks": ["--count <number>", "--last-sort <number>"],
  "notes read-reviews": ["--reviews <json>"],
  "notes recent": ["--count <number>"],
  "notes remove-bookmark": ["-y, --yes"],
  "notes underlines": ["--synckey <number>"],
  "notes update-bookmark": ["--color-style <number>", "--style <number>"],
  "public-accounts articles": ["--count <number>", "--offset <number>", "--synckey <number>"],
  "public-accounts export": ["--limit <number>", "--out <directory>"],
  "public-accounts feed": ["--format <format>", "--limit <number>", "--out <file>"],
  "public-accounts paid-content": [],
  "public-accounts resolve-article": [],
  "public-accounts subscribe": [],
  "public-accounts subscriptions": ["--count <number>", "--offset <number>"],
  "public-accounts unsubscribe": ["-y, --yes"],
  "read-data detail": ["--base-time <number>", "--mode <mode>"],
  "review add": [
    "--abstract <text>",
    "--chapter-uid <number>",
    "--range <range>",
    "--star <number>",
    "--type <number>",
  ],
  "review delete": ["-y, --yes"],
  "review edit": [],
  "review list": [
    "--count <number>",
    "--list-mode <number>",
    "--list-type <number>",
    "--max-idx <number>",
    "--mine <number>",
    "--synckey <number>",
  ],
  "review single": [
    "--comments-count <number>",
    "--comments-direction <number>",
    "--likes-count <number>",
    "--likes-direction <number>",
    "--synckey <number>",
  ],
  "search books": ["--count <number>", "--max-idx <number>", "--scope <number>"],
  "search suggest": ["--count <number>"],
  "shelf add": [],
  "shelf delete": ["-y, --yes"],
  "shelf mark-finished": ["--no-finished"],
  "shelf mark-reading": ["--no-reading"],
  "shelf pin": ["--no-top"],
  "shelf set-private": ["--no-secret"],
  "shelf sync": ["--count <number>", "--full", "--offset <number>"],
  whoami: [],
};

describe("public CLI topology", () => {
  it("contains exactly 40 public operation leaves plus the lifecycle and artifact commands", () => {
    const program = createProgram({ env: enabledGates, getClient: vi.fn() });

    expect(leafCommands(program).sort()).toEqual([...expectedLeaves].sort());
    expect(Object.values(PUBLIC_OPERATIONS).flat()).toHaveLength(40);
  });

  it("pins the exact option flags for every leaf and the global options", () => {
    const program = createProgram({ env: enabledGates, getClient: vi.fn() });

    expect(program.options.map(({ flags }) => flags)).toEqual([
      "-V, --version",
      "--json",
      "--account <name>",
      "--no-library",
      "--refresh",
    ]);
    for (const [path, flags] of Object.entries(expectedOptions)) {
      expect(
        commandAt(program, path)
          .options.map((option) => option.flags)
          .sort(),
        path,
      ).toEqual([...flags].sort());
    }
  });

  it("renders help without loading credentials", async () => {
    const deps = dependencies();

    await expect(createProgram(deps.value).parseAsync(["node", "weread", "--help"])).rejects.toMatchObject({
      code: "commander.helpDisplayed",
      exitCode: 0,
    });
    expect(deps.stdout.read()).toMatchInlineSnapshot(`
      "Usage: weread [options] [command]

      WeChat Reading command line interface

      Options:
        -V, --version     print the installed version
        --json            write raw JSON
        --account <name>  select a configured account
        --no-library      do not read or write the local content library
        --refresh         refetch content even when the local library holds it
        -h, --help        display help for command

      Commands:
        whoami            Show the active credential identity
        doctor            Check authentication and configuration
        search            Search the WeRead catalog
        book              Inspect books
        shelf             Manage the bookshelf
        public-accounts   Discover and archive public accounts
        notes             Read notes and highlights
        review            Read and manage reviews
        read-data         Inspect reading statistics
        discover          Discover books
        ai                Ask WeRead AI
        import            Import personal books
        library           Inspect the local content library
        help [command]    display help for command
      "
    `);
    expect(deps.value.getClient).not.toHaveBeenCalled();
  });

  it.each([
    { argv: ["node", "weread"], usage: "Usage: weread [options] [command]" },
    { argv: ["node", "weread", "book"], usage: "Usage: weread book [options] [command]" },
  ])("renders contextual help for an incomplete command", async ({ argv, usage }) => {
    const deps = dependencies();

    await expect(runCli(argv, deps.value)).resolves.toBe(0);
    expect(deps.stdout.read()).toContain(usage);
    expect(deps.stderr.read()).toBe("");
    expect(deps.value.getClient).not.toHaveBeenCalled();
  });

  it.each([["--json"], ["book", "--json"]])(
    "returns a JSON error for an incomplete machine command: %s",
    async (...args) => {
      const deps = dependencies();

      await expect(runCli(["node", "weread", ...args], deps.value)).resolves.toBe(1);
      expect(deps.stdout.read()).toBe("");
      expect(JSON.parse(deps.stderr.read())).toEqual({ error: "missing command" });
      expect(deps.value.getClient).not.toHaveBeenCalled();
    },
  );

  it("keeps explicit help successful and human-readable with --json present", async () => {
    const deps = dependencies();

    await expect(runCli(["node", "weread", "book", "--help", "--json"], deps.value)).resolves.toBe(0);
    expect(deps.stdout.read()).toContain("Usage: weread book");
    expect(deps.stderr.read()).toBe("");
  });

  it.each([
    {
      argv: ["book", "detail", "--help"],
      expected: ["default: 6", "min: 1", "max: 12"],
    },
    {
      argv: ["review", "add", "--help"],
      expected: ["20, 40, 60, 80, or 100", "Chapter identifier"],
    },
    {
      argv: ["ai", "ask-book", "--help"],
      expected: ["default: 80", "max: 100", "default: 1500", "max: 60000"],
    },
  ])("renders declared defaults and bounds in help for $argv", async ({ argv, expected }) => {
    const deps = dependencies();

    await expect(runCli(["node", "weread", ...argv], deps.value)).resolves.toBe(0);
    const help = deps.stdout.read().replace(/\s+/g, " ");
    for (const text of expected) expect(help).toContain(text);
    expect(deps.stderr.read()).toBe("");
  });

  it.each([
    ["book", "content", "b", "1"],
    ["book", "epub", "b"],
    ["album", "info", "a"],
    ["album", "list", "a"],
    ["album", "related", "a"],
    ["track", "info", "t"],
    ["track", "text", "a", "t"],
    ["track", "play-url", "t"],
    ["track", "progress", "a"],
    ["listen", "last"],
    ["listen", "recent"],
  ])("rejects removed command %s before loading credentials", async (...args) => {
    const deps = dependencies();

    await expect(runCli(["node", "weread", ...args], deps.value)).resolves.toBe(1);
    expect(deps.value.getClient).not.toHaveBeenCalled();
    expect(deps.stderr.read()).toContain("unknown command");
  });
});

describe("public CLI operation projection", () => {
  const cases: Array<{ operation: string; args: string[]; expected: unknown[] }> = [
    {
      operation: "search.books",
      args: ["search", "books", "dune", "--scope", "0", "--count", "5", "--max-idx", "7"],
      expected: ["dune", { scope: 0, count: 5, maxIdx: 7 }],
    },
    {
      operation: "search.suggest",
      args: ["search", "suggest", "dun", "--count", "5"],
      expected: ["dun", { count: 5 }],
    },
    { operation: "book.info", args: ["book", "info", "b"], expected: ["b"] },
    {
      operation: "book.detail",
      args: ["book", "detail", "b", "--count", "3"],
      expected: ["b", { count: 3 }],
    },
    { operation: "book.chapters", args: ["book", "chapters", "b"], expected: ["b"] },
    { operation: "book.progress", args: ["book", "progress", "b"], expected: ["b"] },
    { operation: "shelf.sync", args: ["shelf", "sync", "--full"], expected: [] },
    { operation: "shelf.add", args: ["shelf", "add", "b"], expected: ["b"] },
    { operation: "shelf.delete", args: ["shelf", "delete", "b", "--yes"], expected: ["b"] },
    { operation: "shelf.pin", args: ["shelf", "pin", "b", "--no-top"], expected: ["b", false] },
    {
      operation: "shelf.setPrivate",
      args: ["shelf", "set-private", "b", "--no-secret"],
      expected: ["b", false],
    },
    {
      operation: "shelf.markFinished",
      args: ["shelf", "mark-finished", "b", "--no-finished"],
      expected: ["b", false],
    },
    {
      operation: "shelf.markReading",
      args: ["shelf", "mark-reading", "b", "--no-reading"],
      expected: ["b", false],
    },
    {
      operation: "notes.notebooks",
      args: ["notes", "notebooks", "--count", "3", "--last-sort", "9"],
      expected: [{ count: 3, lastSort: 9 }],
    },
    {
      operation: "notes.recent",
      args: ["notes", "recent", "--count", "3"],
      expected: [{ count: 3 }],
    },
    {
      operation: "publicAccounts.subscriptions",
      args: ["public-accounts", "subscriptions", "--count", "3", "--offset", "2"],
      expected: [{ count: 3, offset: 2 }],
    },
    {
      operation: "publicAccounts.articles",
      args: ["public-accounts", "articles", "MP_WXS_1", "--count", "3", "--offset", "9"],
      expected: ["MP_WXS_1", { count: 3, offset: 9 }],
    },
    {
      operation: "publicAccounts.resolveArticle",
      args: ["public-accounts", "resolve-article", "https://mp.weixin.qq.com/s/article"],
      expected: ["https://mp.weixin.qq.com/s/article", {}],
    },
    {
      operation: "publicAccounts.paidContent",
      args: ["public-accounts", "paid-content", "https://mp.weixin.qq.com/s?id=1"],
      expected: ["https://mp.weixin.qq.com/s?id=1", {}],
    },
    {
      operation: "publicAccounts.subscribe",
      args: ["public-accounts", "subscribe", "MP_WXS_1"],
      expected: ["MP_WXS_1"],
    },
    {
      operation: "publicAccounts.unsubscribe",
      args: ["public-accounts", "unsubscribe", "MP_WXS_1", "--yes"],
      expected: ["MP_WXS_1"],
    },
    {
      operation: "notes.bookmarks",
      args: ["notes", "bookmarks", "b", "--synckey", "9"],
      expected: ["b", { synckey: 9 }],
    },
    {
      operation: "notes.mine",
      args: ["notes", "mine", "b", "--synckey", "9", "--count", "3"],
      expected: ["b", { synckey: 9, count: 3 }],
    },
    {
      operation: "notes.best",
      args: ["notes", "best", "b", "--chapter-uid", "7", "--synckey", "9", "--count", "3", "--max-idx", "2"],
      expected: ["b", { chapterUid: 7, synckey: 9, count: 3, maxIdx: 2 }],
    },
    {
      operation: "notes.readReviews",
      args: ["notes", "read-reviews", "b", "7", "--reviews", '[{"range":"1-2","count":5}]'],
      expected: ["b", 7, [{ range: "1-2", count: 5 }]],
    },
    {
      operation: "notes.underlines",
      args: ["notes", "underlines", "b", "7", "--synckey", "9"],
      expected: ["b", 7, { synckey: 9 }],
    },
    {
      operation: "notes.addBookmark",
      args: [
        "notes",
        "add-bookmark",
        "b",
        "2",
        "1-2",
        "highlight",
        "--type",
        "1",
        "--style",
        "2",
        "--color-style",
        "3",
        "--book-version",
        "4",
        "--chapter-name",
        "Chapter",
        "--context-abstract",
        "Context",
      ],
      expected: [
        {
          bookId: "b",
          chapterUid: 2,
          range: "1-2",
          markText: "highlight",
          type: 1,
          style: 2,
          colorStyle: 3,
          bookVersion: 4,
          chapterName: "Chapter",
          contextAbstract: "Context",
        },
      ],
    },
    {
      operation: "notes.updateBookmark",
      args: ["notes", "update-bookmark", "bookmark", "--style", "2", "--color-style", "5"],
      expected: [{ bookmarkId: "bookmark", style: 2, colorStyle: 5 }],
    },
    {
      operation: "notes.removeBookmark",
      args: ["notes", "remove-bookmark", "bookmark", "--yes"],
      expected: ["bookmark"],
    },
    {
      operation: "review.list",
      args: [
        "review",
        "list",
        "b",
        "--list-type",
        "3",
        "--list-mode",
        "2",
        "--mine",
        "1",
        "--synckey",
        "9",
        "--count",
        "5",
        "--max-idx",
        "7",
      ],
      expected: ["b", { listType: 3, listMode: 2, mine: 1, synckey: 9, count: 5, maxIdx: 7 }],
    },
    {
      operation: "review.single",
      args: [
        "review",
        "single",
        "r",
        "--comments-count",
        "3",
        "--comments-direction",
        "1",
        "--likes-count",
        "4",
        "--likes-direction",
        "0",
        "--synckey",
        "9",
      ],
      expected: ["r", { commentsCount: 3, commentsDirection: 1, likesCount: 4, likesDirection: 0, synckey: 9 }],
    },
    {
      operation: "review.add",
      args: [
        "review",
        "add",
        "b",
        "note",
        "--star",
        "80",
        "--type",
        "4",
        "--range",
        "1-2",
        "--abstract",
        "quote",
        "--chapter-uid",
        "7",
      ],
      expected: [
        {
          bookId: "b",
          content: "note",
          star: 80,
          type: 4,
          range: "1-2",
          abstract: "quote",
          chapterUid: 7,
        },
      ],
    },
    { operation: "review.edit", args: ["review", "edit", "r", "replacement"], expected: ["r", "replacement"] },
    { operation: "review.delete", args: ["review", "delete", "r", "--yes"], expected: ["r"] },
    {
      operation: "readData.detail",
      args: ["read-data", "detail", "--mode", "annually", "--base-time", "9"],
      expected: [{ mode: "annually", baseTime: 9 }],
    },
    {
      operation: "discover.recommend",
      args: ["discover", "recommend", "--count", "3", "--max-idx", "2"],
      expected: [{ count: 3, maxIdx: 2 }],
    },
    {
      operation: "discover.similar",
      args: ["discover", "similar", "b", "--count", "3", "--max-idx", "2", "--session-id", "s"],
      expected: ["b", { count: 3, maxIdx: 2, sessionId: "s" }],
    },
    {
      operation: "ai.askBook",
      args: ["ai", "ask-book", "b", "why", "--intent", "summary", "--max-polls", "4", "--delay-cap-ms", "5"],
      expected: [{ bookId: "b", query: "why", intent: "summary", maxPolls: 4, delayCapMs: 5 }],
    },
    {
      operation: "ai.suggest",
      args: ["ai", "suggest", "b", "--chapter-uid", "7", "--range", "1-2", "--mp-review-id", "review"],
      expected: [{ bookId: "b", chapterUid: 7, toolbar: false, range: "1-2", mpReviewId: "review" }],
    },
    {
      operation: "import.book",
      args: ["import", "book", "/tmp/novel.epub"],
      expected: [{ name: "novel.epub", path: "/tmp/novel.epub" }],
    },
  ];

  it("covers every registered public operation exactly once", () => {
    const registered = Object.entries(PUBLIC_OPERATIONS).flatMap(([namespace, methods]) =>
      methods.map((method) => `${namespace}.${method}`),
    );
    expect(cases.map(({ operation }) => operation).sort()).toEqual(registered.sort());
  });

  it.each(cases)("$operation delegates exact parsed arguments", async ({ operation, args, expected }) => {
    const stdout = sink();
    const stderr = sink();
    const result = { operation };
    const method = vi.fn(async () => result);
    const [namespace, action] = operation.split(".") as [string, string];
    const client = { [namespace]: { [action]: method } } as unknown as MobileApiClient;

    await expect(
      runCli(["node", "weread", "--json", ...args], {
        getClient: () => client,
        env: enabledGates,
        stdout: stdout.stream,
        stderr: stderr.stream,
        isTTY: false,
      }),
    ).resolves.toBe(0);
    expect(method).toHaveBeenCalledOnce();
    expect(method).toHaveBeenCalledWith(...expected);
    expect(stdout.read()).toBe(`${JSON.stringify(result)}\n`);
    expect(stderr.read()).toBe("");
  });

  it("passes an article synckey and rejects mixing it with an offset", async () => {
    const articles = vi.fn(async () => ({ articles: [], returnedCount: 0, requestedOffset: 0 }));
    const client = { publicAccounts: { articles } } as unknown as MobileApiClient;

    await expect(
      runCli(["node", "weread", "public-accounts", "articles", "MP_WXS_1", "--synckey", "9", "--json"], {
        getClient: () => client,
        stdout: sink().stream,
        stderr: sink().stream,
      }),
    ).resolves.toBe(0);
    expect(articles).toHaveBeenCalledWith("MP_WXS_1", { count: undefined, synckey: 9, offset: undefined });

    const deps = dependencies();
    await expect(
      runCli(
        ["node", "weread", "public-accounts", "articles", "MP_WXS_1", "--synckey", "9", "--offset", "2"],
        deps.value,
      ),
    ).resolves.toBe(1);
    expect(deps.value.getClient).not.toHaveBeenCalled();
  });

  it("projects and pages shelf sync unless full output is requested", async () => {
    const stdout = sink();
    const stderr = sink();
    const sync = vi.fn(async () => ({
      books: [
        { bookId: "one", title: "One", maxFreeInfo: { noisy: true } },
        { bookId: "two", title: "Two", maxFreeInfo: { noisy: true } },
      ],
      bookProgress: [{ bookId: "two", progress: 42 }],
    }));

    await expect(
      runCli(["node", "weread", "shelf", "sync", "--count", "1", "--offset", "1", "--json"], {
        getClient: () => ({ shelf: { sync } }) as unknown as MobileApiClient,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).resolves.toBe(0);

    expect(JSON.parse(stdout.read())).toMatchObject({
      totalCount: 2,
      returnedCount: 1,
      offset: 1,
      books: [{ bookId: "two", title: "Two", progress: 42 }],
    });
    expect(stdout.read()).not.toContain("maxFreeInfo");
    expect(stderr.read()).toBe("");
  });

  it("rejects full shelf output combined with paging before loading the client", async () => {
    const deps = dependencies();

    await expect(
      runCli(["node", "weread", "shelf", "sync", "--full", "--count", "1", "--json"], deps.value),
    ).resolves.toBe(1);
    expect(deps.value.getClient).not.toHaveBeenCalled();
    expect(deps.stderr.read()).toContain("cannot be used with option");
  });
});

describe("public CLI lifecycle and extension seam", () => {
  it("checks the selected credentials with a read-only request and reports configured values", async () => {
    const directory = mkdtempSync(join(tmpdir(), "weread-cli-doctor-"));
    directories.push(directory);
    const env = {
      WEREAD_CONFIG_DIR: directory,
      WEREAD_CONNECT_ATTEMPT_TIMEOUT_MS: "1500",
    };
    saveCredentials(fixtureCredentials, { env, store: "eink" });
    const sync = vi.fn(async () => ({ books: [] }));
    const stdout = sink();
    const stderr = sink();

    await expect(
      runCli(["node", "weread", "doctor", "--json"], {
        env,
        getClient: () => ({ shelf: { sync } }) as unknown as MobileApiClient,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).resolves.toBe(0);

    expect(sync).toHaveBeenCalledOnce();
    expect(JSON.parse(stdout.read())).toEqual({
      ok: true,
      cli: {
        package: "weread-omni",
        version: expect.any(String),
      },
      auth: {
        status: "authenticated",
        vid: fixtureCredentials.vid,
        deviceId: fixtureCredentials.deviceId,
        source: "file",
      },
      config: {
        credentialPath: storePath(env, "eink"),
        connectAttemptTimeoutMs: 1500,
      },
    });
    expect(stderr.read()).toBe("");

    const human = sink();
    await expect(
      runCli(["node", "weread", "doctor"], {
        env,
        getClient: () => ({ shelf: { sync } }) as unknown as MobileApiClient,
        stdout: human.stream,
        stderr: stderr.stream,
      }),
    ).resolves.toBe(0);
    expect(human.read()).toContain("CLI: weread-omni ");
    expect(human.read()).toContain(
      [
        "Authentication: authenticated as 123",
        "Credential source: file",
        `Credential path: ${storePath(env, "eink")}`,
        `Device: ${fixtureCredentials.deviceId}`,
        "Configured connect attempt timeout: 1500 ms",
      ].join("\n"),
    );
    expect(sync).toHaveBeenCalledTimes(2);
    expect(stderr.read()).toBe("");
  });

  it("reports file authority when a selected file beats bootstrap environment values", async () => {
    const directory = mkdtempSync(join(tmpdir(), "weread-cli-authority-"));
    directories.push(directory);
    const env = {
      WEREAD_CONFIG_DIR: directory,
      WEREAD_VID: "env-vid",
      WEREAD_REFRESH_TOKEN: "env-refresh",
      WEREAD_DEVICE_ID: "env-device",
    };
    saveCredentials(fixtureCredentials, { env, store: "eink" });
    const stdout = sink();

    await expect(
      runCli(["node", "weread", "whoami", "--json"], { env, stdout: stdout.stream, stderr: sink().stream }),
    ).resolves.toBe(0);
    expect(JSON.parse(stdout.read())).toEqual({ vid: "123", deviceId: fixtureCredentials.deviceId, source: "file" });
  });

  it("invokes one typed extension after public command registration", async () => {
    class ExtendedClient extends MobileApiClient {
      readonly extensionProbe = vi.fn(async () => ({ extended: true }));
    }
    const client = new ExtendedClient({ credentials: fixtureCredentials, env: {} });
    const stdout = sink();
    const stderr = sink();
    const extendProgram = vi.fn((program: Command, context: CommandContext<ExtendedClient>) => {
      expect(commandAt(program, "book info")).toBeDefined();
      program.command("extension-probe").action(async () => {
        const result = await context.getClient().extensionProbe();
        context.stdout.write(`${JSON.stringify(result)}\n`);
      });
    });

    await expect(
      runCli(["node", "weread", "extension-probe"], {
        getClient: () => client,
        stdout: stdout.stream,
        stderr: stderr.stream,
        extendProgram,
      }),
    ).resolves.toBe(0);

    expect(extendProgram).toHaveBeenCalledOnce();
    expect(client.extensionProbe).toHaveBeenCalledOnce();
    expect(stdout.read()).toBe('{"extended":true}\n');
  });
});

describe("CLI store routing and capability policy", () => {
  it("rejects repeated stores for an ordinary command before loading a client", async () => {
    const deps = dependencies();

    await expect(
      runCli(["node", "weread", "--account", "personal", "--account", "work", "book", "info", "b"], deps.value),
    ).resolves.toBe(1);

    expect(deps.value.getClient).not.toHaveBeenCalled();
    expect(deps.stderr.read()).toContain("exactly one --account");
  });

  it("does not exempt an extension leaf merely because it is named mcp", async () => {
    const action = vi.fn();
    const stores = [
      { name: "personal", backend: "mobile-api", client: {} },
      { name: "work", backend: "hosted-api", client: {} },
    ] satisfies readonly CliStore[];
    const stderr = sink();

    await expect(
      runCli(["node", "weread", "--account", "personal", "--account", "work", "private", "mcp"], {
        stores,
        stderr: stderr.stream,
        extendStoreProgram: (program) => {
          program.command("private").command("mcp").action(action);
        },
      }),
    ).resolves.toBe(1);

    expect(action).not.toHaveBeenCalled();
    expect(stderr.read()).toContain("exactly one --account");
  });

  it("selects flag, injected default, then eink in precedence order", async () => {
    const directory = mkdtempSync(join(tmpdir(), "weread-cli-precedence-"));
    directories.push(directory);
    for (const store of ["flag", "dependency", "eink"]) {
      saveCredentials({ ...fixtureCredentials, vid: store }, { env: { WEREAD_CONFIG_DIR: directory }, store });
    }

    const cases = [
      {
        argv: ["node", "weread", "--account", "flag", "whoami", "--json"],
        dependencies: { env: { WEREAD_CONFIG_DIR: directory }, store: "dependency" },
        expected: "flag",
      },
      {
        argv: ["node", "weread", "whoami", "--json"],
        dependencies: { env: { WEREAD_CONFIG_DIR: directory }, store: "dependency" },
        expected: "dependency",
      },
      {
        argv: ["node", "weread", "whoami", "--json"],
        dependencies: { env: { WEREAD_CONFIG_DIR: directory } },
        expected: "eink",
      },
    ] as const;

    for (const testCase of cases) {
      const stdout = sink();
      await expect(
        runCli([...testCase.argv], {
          ...testCase.dependencies,
          stdout: stdout.stream,
          stderr: sink().stream,
        }),
      ).resolves.toBe(0);
      expect(JSON.parse(stdout.read()).vid).toBe(testCase.expected);
    }
  });

  it("rejects a different selector for a fixed injected client before calling it", async () => {
    const deps = dependencies();

    await expect(runCli(["node", "weread", "--account", "work", "book", "info", "b"], deps.value)).resolves.toBe(1);

    expect(deps.value.getClient).not.toHaveBeenCalled();
    expect(deps.stderr.read()).toContain('fixed to store "eink"');
  });

  it("registers the registry capability union and validates the selected store before dispatch", async () => {
    const search = vi.fn(async () => ({ books: [] }));
    const info = vi.fn(async (bookId: string) => ({ bookId }));
    const sync = vi.fn(async () => ({ books: [] }));
    const stores = [
      {
        name: "alpha",
        backend: "mobile-api",
        clientProfile: "eink",
        client: { search: { books: search }, shelf: { sync } },
        readIdentity: async () =>
          ({ vid: "alpha", deviceId: "device-alpha", accessToken: "must-not-leak" }) as CliStoreIdentity,
      },
      {
        name: "beta",
        backend: "hosted-api",
        client: { book: { info } },
      },
    ] as unknown as readonly CliStore[];
    const env: NodeJS.ProcessEnv = {};
    const program = createProgram({ env, store: "alpha", stores });

    expect(leafCommands(program)).toEqual(expect.arrayContaining(["search books", "book info", "whoami", "doctor"]));
    expect(leafCommands(program)).not.toContain("mcp");
    expect(leafCommands(program)).not.toEqual(expect.arrayContaining(["book detail", "login", "shelf add"]));

    const unsupportedError = sink();
    await expect(
      runCli(["node", "weread", "book", "info", "b", "--json"], {
        env,
        store: "alpha",
        stores,
        stdout: sink().stream,
        stderr: unsupportedError.stream,
      }),
    ).resolves.toBe(1);
    expect(info).not.toHaveBeenCalled();
    expect(unsupportedError.read()).toContain("does not support book.info");

    const selectedOutput = sink();
    await expect(
      runCli(["node", "weread", "--account", "beta", "book", "info", "b", "--json"], {
        env,
        stores,
        stdout: selectedOutput.stream,
        stderr: sink().stream,
      }),
    ).resolves.toBe(0);
    expect(info).toHaveBeenCalledWith("b");
    expect(JSON.parse(selectedOutput.read())).toEqual({ bookId: "b" });

    const identityOutput = sink();
    await expect(
      runCli(["node", "weread", "whoami", "--json"], {
        env,
        store: "alpha",
        stores,
        stdout: identityOutput.stream,
        stderr: sink().stream,
      }),
    ).resolves.toBe(0);
    expect(JSON.parse(identityOutput.read())).toEqual({
      vid: "alpha",
      deviceId: "device-alpha",
    });
    expect(identityOutput.read()).not.toContain("must-not-leak");
  });

  it("registers public-account artifact commands for a capable account registry", () => {
    const stores = [
      {
        name: "account",
        backend: "eink",
        client: {
          publicAccounts: {
            subscriptions: vi.fn(),
            articles: vi.fn(),
            paidContent: vi.fn(),
          },
          review: { single: vi.fn() },
        },
      },
    ] as unknown as readonly CliStore[];

    expect(leafCommands(createProgram({ store: "account", stores }))).toEqual(
      expect.arrayContaining(["public-accounts feed", "public-accounts export"]),
    );
  });

  it("hides artifact commands when paid-content support is absent", () => {
    const stores = [
      {
        name: "account",
        backend: "eink",
        client: {
          publicAccounts: { articles: vi.fn() },
          review: { single: vi.fn() },
        },
      },
    ] as unknown as readonly CliStore[];

    const leaves = leafCommands(createProgram({ store: "account", stores }));
    expect(leaves).not.toContain("public-accounts feed");
    expect(leaves).not.toContain("public-accounts export");
  });

  it("keeps registry extensions on a partial store-only context", async () => {
    const stores = [
      { name: "alpha", backend: "mobile-api", client: {} },
      { name: "beta", backend: "hosted-api", client: {} },
    ] satisfies readonly CliStore[];
    const stdout = sink();
    const extendStoreProgram = vi.fn((program: Command, context: CliStoreCommandContext) => {
      program.command("store-probe").action(() => {
        const store = context.getStore();
        context.stdout.write(`${store.name}:${store.backend}\n`);
      });
    });

    await expect(
      runCli(["node", "weread", "--account", "beta", "store-probe"], {
        store: "alpha",
        stores,
        stdout: stdout.stream,
        stderr: sink().stream,
        extendStoreProgram,
      }),
    ).resolves.toBe(0);

    expect(extendStoreProgram).toHaveBeenCalledOnce();
    expect(stdout.read()).toBe("beta:hosted-api\n");
  });

  it("registers lifecycle commands from the registry union", () => {
    const stores = [
      {
        name: "mobile",
        backend: "mobile-api",
        client: { shelf: { sync: vi.fn(async () => ({ books: [] })) } },
        readIdentity: () => ({ vid: "123", deviceId: fixtureCredentials.deviceId }),
      },
    ] as unknown as readonly CliStore[];
    const env: NodeJS.ProcessEnv = {};
    const program = createProgram({ env, store: "mobile", stores });

    expect(leafCommands(program)).toEqual(expect.arrayContaining(["whoami", "doctor"]));
    expect(leafCommands(program)).not.toContain("login");
  });

  it("rejects registry mode mixed with the legacy extension/client seam", async () => {
    const stderr = sink();
    const getClient = vi.fn(() => new MobileApiClient({ credentials: fixtureCredentials, env: {} }));

    await expect(
      runCli(["node", "weread", "book", "info", "b"], {
        stores: [{ name: "alpha", backend: "mobile-api", client: {} }],
        getClient,
        stderr: stderr.stream,
      }),
    ).resolves.toBe(1);

    expect(getClient).not.toHaveBeenCalled();
    expect(stderr.read()).toContain("cannot be mixed");
  });

  it("intersects backend capabilities with shared write gates for visibility and dispatch", async () => {
    const env: NodeJS.ProcessEnv = {};
    const add = vi.fn(async () => ({ ok: true }));
    const stores = [
      {
        name: "alpha",
        backend: "mobile-api",
        client: {
          book: { info: vi.fn(async (bookId: string) => ({ bookId })) },
          shelf: { add },
        },
      },
    ] as unknown as readonly CliStore[];
    const program = createProgram({ env, store: "alpha", stores });
    const leaves = leafCommands(program);

    expect(leaves).toContain("shelf add");
    expect(leaves).not.toContain("shelf delete");
    expect(leaves).not.toContain("review add");
    expect(leaves).not.toContain("import book");
    expect(leaves).not.toContain("login");
    expect(leaves).toContain("book info");

    const disabledProgram = createProgram({
      // Shelf writes are permitted unless closed, so the disabled case has to say so explicitly.
      env: { WEREAD_READONLY: "1" },
      stores,
    });
    expect(leafCommands(disabledProgram)).not.toContain("shelf add");
    await expect(disabledProgram.parseAsync(["node", "weread", "shelf", "add", "b"])).rejects.toThrow();
    expect(add).not.toHaveBeenCalled();

    // Policy is a startup snapshot: visibility and dispatch cannot diverge if an embedder mutates
    // its configuration object after constructing the command tree.
    env.WEREAD_READONLY = "1";
    await program.parseAsync(["node", "weread", "shelf", "add", "b"]);
    expect(add).toHaveBeenCalledOnce();
  });
});

describe("public CLI output and failures", () => {
  it("returns structured API errors as one redacted JSON line", async () => {
    const stdout = sink();
    const stderr = sink();
    const info = vi.fn(async () => {
      throw new WeReadApiError("failed Bearer sk-9f8e7d6c5b4a3210 accessToken=hidden", {
        path: "/book/info",
        status: 200,
        errCode: -2012,
      });
    });

    await expect(
      runCli(["node", "weread", "book", "info", "b", "--json"], {
        getClient: () => ({ book: { info } }) as unknown as MobileApiClient,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).resolves.toBe(1);

    expect(JSON.parse(stderr.read())).toEqual({
      error: "failed Bearer [REDACTED] accessToken=[REDACTED]",
      errCode: -2012,
      status: 200,
      path: "/book/info",
    });
    expect(`${stdout.read()}${stderr.read()}`).not.toContain("hidden");
  });

  it("returns structured public-account artifact failures with recovery metadata", async () => {
    const directory = mkdtempSync(join(tmpdir(), "weread-cli-artifact-error-"));
    directories.push(directory);
    const destination = join(directory, "archive");
    const upstream = new WeReadApiError("credentials rejected", {
      path: "/review/single",
      status: 401,
      errCode: -2012,
      ambiguous: true,
    });
    const client = {
      publicAccounts: {
        articles: vi.fn(async () => ({
          accountId: "MP_WXS_1",
          articles: [{ reviewId: "r1" }],
          returnedCount: 1,
          requestedOffset: 0,
          hasMore: 0,
        })),
        paidContent: vi.fn(),
      },
      review: { single: vi.fn(async () => Promise.reject(upstream)) },
    } as unknown as MobileApiClient;
    const stdout = sink();
    const stderr = sink();

    await expect(
      runCli(["node", "weread", "public-accounts", "export", "MP_WXS_1", "--out", destination, "--json"], {
        getClient: () => client,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).resolves.toBe(1);

    expect(JSON.parse(stderr.read())).toMatchObject({
      error: expect.stringContaining("archive is incomplete"),
      code: "ARTIFACT_INCOMPLETE",
      path: destination,
      incomplete: true,
      incompletePath: destination,
      authenticationHint: 'Re-authenticate store "eink" through the client that supplies it, then retry.',
      upstreamStatus: 401,
      upstreamPath: "/review/single",
      errCode: -2012,
      ambiguous: true,
    });
    expect(stdout.read()).toBe("");
    expect(existsSync(join(destination, "manifest.json"))).toBe(false);
  });

  it.each([
    {
      message: "WeRead credentials not found",
      hint: 'Re-authenticate store "eink" through the client that supplies it, then retry.',
    },
    {
      message: "WeRead credentials are not valid JSON",
      hint: 'Re-authenticate store "eink" through the client that supplies it, then retry.',
    },
    {
      message: "mobile /shelf/sync: authentication rejected after token refresh",
      hint: 'Re-authenticate store "eink" through the client that supplies it, then retry.',
    },
  ])("gives authentication failures a machine-readable recovery hint: $message", async ({ message, hint }) => {
    const stdout = sink();
    const stderr = sink();
    const info = vi.fn(async () => {
      throw new AuthError(message);
    });

    await expect(
      runCli(["node", "weread", "book", "info", "b", "--json"], {
        getClient: () => ({ book: { info } }) as unknown as MobileApiClient,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).resolves.toBe(1);

    expect(JSON.parse(stderr.read())).toEqual({
      error: message,
      cli: {
        package: "weread-omni",
        version: expect.any(String),
      },
      hint,
    });
    expect(stdout.read()).toBe("");
  });

  it("keeps authentication recovery on the selected store", async () => {
    const info = vi.fn(async () => {
      throw new AuthError("credentials rejected");
    });

    for (const [store, client, expected] of [
      ["mobile", { book: { info } }, 'Re-authenticate store "mobile" through the client that supplies it, then retry.'],
      ["hosted", { book: { info } }, 'Re-authenticate store "hosted" through the client that supplies it, then retry.'],
    ] as const) {
      const stderr = sink();
      await expect(
        runCli(["node", "weread", "--account", store, "book", "info", "b", "--json"], {
          stores: [{ name: store, backend: `${store}-api`, client }],
          stdout: sink().stream,
          stderr: stderr.stream,
        }),
      ).resolves.toBe(1);
      expect(JSON.parse(stderr.read())).toMatchObject({ hint: expected });
    }

    const stderr = sink();
    await expect(
      runCli(["node", "weread", "book", "info", "b", "--json"], {
        store: "beta",
        stores: [
          { name: "alpha", backend: "mobile-api", client: { book: { info } } },
          { name: "beta", backend: "mobile-api", client: { book: { info } } },
        ],
        stdout: sink().stream,
        stderr: stderr.stream,
      }),
    ).resolves.toBe(1);
    expect(JSON.parse(stderr.read())).toMatchObject({
      hint: 'Re-authenticate store "beta" through the client that supplies it, then retry.',
    });
  });

  it("requires confirmation for destructive non-interactive actions", async () => {
    const deps = dependencies();

    await expect(runCli(["node", "weread", "shelf", "delete", "b", "--json"], deps.value)).resolves.toBe(1);
    expect(deps.value.getClient).not.toHaveBeenCalled();
    expect(deps.stderr.read()).toContain("requires --yes");
  });

  it("requires confirmation before removing a highlight", async () => {
    const deps = dependencies();

    await expect(
      runCli(["node", "weread", "notes", "remove-bookmark", "bookmark", "--json"], deps.value),
    ).resolves.toBe(1);
    expect(deps.value.getClient).not.toHaveBeenCalled();
    expect(deps.stderr.read()).toContain("requires --yes");
  });

  it("requires confirmation before creating a client for public-account unsubscribe", async () => {
    const deps = dependencies();

    await expect(
      runCli(["node", "weread", "public-accounts", "unsubscribe", "MP_WXS_1", "--json"], deps.value),
    ).resolves.toBe(1);
    expect(deps.value.getClient).not.toHaveBeenCalled();
    expect(deps.stderr.read()).toContain("requires --yes");
  });

  it.each([
    ["public-accounts", "articles", "bad", "--count", "1"],
    ["public-accounts", "subscribe", "MP_WXS_bad"],
    ["public-accounts", "unsubscribe", "MP_WXS_1x", "--yes"],
    ["public-accounts", "subscriptions", "--count", "0"],
    ["public-accounts", "feed", "MP_WXS_1", "--out", "/tmp/feed.json"],
    ["public-accounts", "feed", "MP_WXS_1", "--format", "json", "--out", " "],
    ["public-accounts", "feed", "bad", "--format", "json", "--out", "/tmp/feed.json"],
    ["public-accounts", "export", "MP_WXS_1", "--out", " "],
    ["public-accounts", "export", "MP_WXS_1", "--out", "/tmp/archive", "--limit", "101"],
  ])("validates public-account command %s before loading credentials", async (...args) => {
    const deps = dependencies();

    await expect(runCli(["node", "weread", ...args, "--json"], deps.value)).resolves.toBe(1);
    expect(deps.value.getClient).not.toHaveBeenCalled();
  });

  it("emits the exact feed and archive JSON success contracts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "weread-public-account-cli-"));
    directories.push(directory);
    const articles = vi.fn(async (accountId: string) => ({
      accountId,
      articles: [],
      returnedCount: 0,
      requestedOffset: 0,
    }));
    const client = {
      publicAccounts: {
        articles,
        paidContent: vi.fn(),
        subscriptions: vi.fn(async () => ({
          accounts: [],
          returnedCount: 0,
          requestedOffset: 0,
          totalCount: 0,
        })),
      },
      review: { single: vi.fn() },
    } as unknown as MobileApiClient;

    const feedOut = sink();
    const feedPath = join(directory, "feed.json");
    await expect(
      runCli(
        ["node", "weread", "public-accounts", "feed", "MP_WXS_1", "--format", "json", "--out", feedPath, "--json"],
        { getClient: () => client, stdout: feedOut.stream, stderr: sink().stream },
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(feedOut.read())).toEqual({ path: feedPath, format: "json", itemCount: 0 });

    const archiveOut = sink();
    const archivePath = join(directory, "archive");
    await expect(
      runCli(["node", "weread", "public-accounts", "export", "MP_WXS_1", "--out", archivePath, "--json"], {
        getClient: () => client,
        stdout: archiveOut.stream,
        stderr: sink().stream,
      }),
    ).resolves.toBe(0);
    expect(JSON.parse(archiveOut.read())).toEqual({
      path: archivePath,
      accountId: "MP_WXS_1",
      itemCount: 0,
      completeCount: 0,
      partialCount: 0,
      unsupportedCount: 0,
    });
  });

  it("forwards cancellation through feed generation before creating an output file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "weread-public-account-cli-abort-"));
    directories.push(directory);
    const destination = join(directory, "feed.json");
    const articles = vi.fn();
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const stderr = sink();

    await expect(
      runCli(
        ["node", "weread", "public-accounts", "feed", "MP_WXS_1", "--format", "json", "--out", destination, "--json"],
        {
          getClient: () =>
            ({
              publicAccounts: { articles, paidContent: vi.fn() },
              review: { single: vi.fn() },
            }) as unknown as MobileApiClient,
          signal: controller.signal,
          stdout: sink().stream,
          stderr: stderr.stream,
        },
      ),
    ).resolves.toBe(1);
    expect(articles).not.toHaveBeenCalled();
    expect(existsSync(destination)).toBe(false);
    expect(JSON.parse(stderr.read())).toMatchObject({ error: "cancelled" });
  });

  it("cancels an interactive destructive action without loading the client", async () => {
    const deps = dependencies();
    deps.value.isTTY = true;
    deps.value.confirm = vi.fn(async () => false);

    await expect(runCli(["node", "weread", "shelf", "delete", "b"], deps.value)).resolves.toBe(0);
    expect(deps.value.confirm).toHaveBeenCalledWith("Deleting this book?");
    expect(deps.value.getClient).not.toHaveBeenCalled();
    expect(deps.stdout.read()).toBe("Cancelled.\n");
  });

  it.each([
    ["notes", "notebooks", "--count", "0x10"],
    ["notes", "notebooks", "--count", "0"],
    ["notes", "recent", "--count", "101"],
    ["notes", "bookmarks", "b", "--synckey", "-1"],
    ["notes", "read-reviews", "b", "7", "--reviews", '[{"range":"1-2","count":0}]'],
    ["notes", "read-reviews", "b", "7", "--reviews", '[{"range":"1-2","count":21}]'],
    ["notes", "read-reviews", "b", "7", "--reviews", '[{"range":"1-2","maxIdx":1.5}]'],
    ["review", "add", "b", "note", "--star", "5"],
    ["review", "add", "b", "note", "--type", "-1"],
    ["notes", "add-bookmark", "b", "1", "1-2", "text", "--style", "-1"],
    ["notes", "update-bookmark", "bookmark", "--style", "-1"],
  ])("rejects invalid numeric option %s before loading the client", async (...args) => {
    const deps = dependencies();

    await expect(runCli(["node", "weread", ...args, "--json"], deps.value)).resolves.toBe(1);
    expect(deps.value.getClient).not.toHaveBeenCalled();
  });

  it("rejects blank required write text before transport", async () => {
    const deps = dependencies();

    await expect(runCli(["node", "weread", "review", "add", "b", " ", "--json"], deps.value)).resolves.toBe(1);
    expect(deps.stderr.read()).toContain("content");
  });

  it("exports the option parsers and output writer an extension needs as values", async () => {
    // Types alone are not enough: an extension that cannot import these has to reimplement them,
    // and its commands then drift from the built-in ones in formatting and validation.
    const cli = (await import("../../src/cli.js")) as Record<string, unknown>;
    for (const name of ["output", "integer", "port"]) {
      expect(typeof cli[name], name).toBe("function");
    }

    const written: string[] = [];
    (cli.output as typeof import("../../src/cli/output.js").output)(
      { a: 1 },
      { json: true, stdout: { write: (chunk: string) => written.push(chunk) } },
      () => "human",
    );
    expect(written).toEqual(['{"a":1}\n']);
    expect((cli.integer as (value: string) => number)("42")).toBe(42);
    expect(() => (cli.integer as (value: string) => number)("4.2")).toThrow();
    expect((cli.port as (value: string) => number)("8080")).toBe(8080);
    expect(() => (cli.port as (value: string) => number)("65536")).toThrow();
  });

  it("recognizes an npm-style symlink as the ESM main entry", () => {
    const directory = mkdtempSync(join(tmpdir(), "weread-cli-main-"));
    directories.push(directory);
    const target = join(directory, "cli.js");
    const link = join(directory, "weread");
    writeFileSync(target, "");
    symlinkSync(target, link);

    expect(isMain(pathToFileURL(target).href, link)).toBe(true);
  });
});

describe("CLI error-format selection", () => {
  it("does not switch to JSON because a positional argument looks like the flag", async () => {
    // Previously decided by argv.includes("--json"), so a bookId of "--json" after the `--`
    // separator flipped the error format even though the parser never saw the option.
    const written: string[] = [];
    const code = await runCli(["node", "weread", "shelf", "delete", "--", "--json"], {
      stderr: { write: (chunk: string) => written.push(chunk) } as never,
      isTTY: false,
      getClient: () => ({}) as never,
      getIdentity: () => ({ vid: "1", deviceId: "d", source: "file" }),
    });
    expect(code).toBeGreaterThan(0);
    expect(written.join("")).toMatch(/^Error: /);
    expect(() => JSON.parse(written.join(""))).toThrow();
  });
});
