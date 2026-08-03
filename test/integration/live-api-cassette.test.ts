import { readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";
import { afterEach, describe, expect, it } from "vitest";
import type { Credentials } from "../../src/auth/credentials.js";
import { loadCredentials, saveCredentials } from "../../src/auth/credentials.js";
import { mintAccessToken } from "../../src/auth/token.js";
import { applyConnectAttemptTimeout } from "../../src/connect-timeout.js";
import { createEinkClient } from "../../src/index.js";

const API_ORIGIN = "https://i.weread.qq.com";
const SEARCH_TERM = "三体";
const FIXTURE_NAME = "public-book-search.json";
const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/cassettes/", import.meta.url));
const FIXTURE_PATH = join(FIXTURE_DIR, FIXTURE_NAME);
const RECORDING = process.env.WEREAD_RECORD_CASSETTES === "1";
const SEARCH_URL = new URL("/store/search", API_ORIGIN);
SEARCH_URL.searchParams.set("keyword", SEARCH_TERM);
SEARCH_URL.searchParams.set("scope", "10");
SEARCH_URL.searchParams.set("count", "1");
SEARCH_URL.searchParams.set("maxIdx", "0");
const SEARCH_PATH = `${SEARCH_URL.pathname}${SEARCH_URL.search}`;

const REPLAY_CREDENTIALS: Credentials = {
  vid: "cassette",
  accessToken: "cassette",
  refreshToken: "cassette",
  deviceId: "cassette",
};

interface PublicBook {
  bookId: string;
  title: string;
  author?: string;
}

type SafeDefinition = Omit<nock.Definition, "response"> & {
  response: { books: [{ bookInfo: PublicBook }] };
};

function object(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isApiScope(scope: string | RegExp): boolean {
  if (typeof scope !== "string") return false;
  try {
    const url = new URL(scope);
    return (
      url.origin === API_ORIGIN &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function sanitizeDefinitions(definitions: nock.Definition[]): [SafeDefinition] {
  if (definitions.length !== 1) {
    throw new Error(`cassette must contain exactly one request (saw ${definitions.length})`);
  }
  const definition = definitions[0];
  if (!definition) throw new Error("cassette recorder returned no request");
  const mismatches = [
    ...(!isApiScope(definition.scope) ? ["host"] : []),
    ...(definition.method?.toUpperCase() !== "GET" ? ["method"] : []),
    ...(definition.path !== SEARCH_PATH ? ["path"] : []),
    ...(definition.status !== 200 ? ["status"] : []),
  ];
  if (mismatches.length > 0) throw new Error(`cassette recorder rejected unexpected ${mismatches.join(", ")}`);

  const response = object(definition.response);
  const books = response?.books;
  const book = Array.isArray(books)
    ? books
        .map((entry) => object(object(entry)?.bookInfo))
        .find(
          (entry): entry is Record<string, unknown> & Pick<PublicBook, "bookId" | "title"> =>
            typeof entry?.bookId === "string" &&
            entry.bookId.length > 0 &&
            typeof entry.title === "string" &&
            entry.title.length > 0,
        )
    : undefined;
  if (!book) throw new Error("cassette response contained no usable public book metadata");

  return [
    {
      scope: API_ORIGIN,
      method: "GET",
      path: SEARCH_PATH,
      status: 200,
      response: {
        books: [
          {
            bookInfo: {
              bookId: book.bookId,
              title: book.title,
              ...(typeof book.author === "string" ? { author: book.author } : {}),
            },
          },
        ],
      },
    },
  ];
}

function serializeDefinitions(definitions: nock.Definition[]): string {
  return `${JSON.stringify(sanitizeDefinitions(definitions), null, 2)}\n`;
}

function containsString(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (Array.isArray(value)) return value.some((entry) => containsString(entry, needle));
  return (
    value !== null && typeof value === "object" && Object.values(value).some((entry) => containsString(entry, needle))
  );
}

function assertSafeCassette(text: string, credentials?: Credentials): PublicBook {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("cassette is not valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("cassette must be a JSON array");

  const canonical = sanitizeDefinitions(parsed as nock.Definition[]);
  if (text !== `${JSON.stringify(canonical, null, 2)}\n`) {
    throw new Error("cassette is not the canonical public metadata allowlist");
  }
  for (const [field, secret] of Object.entries(credentials ?? {})) {
    if (secret && containsString(canonical, secret)) {
      throw new Error(`cassette contains live credential field ${field}`);
    }
  }
  return canonical[0].response.books[0].bookInfo;
}

const publicSearchFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (
    method !== "GET" ||
    url.origin !== API_ORIGIN ||
    url.pathname !== SEARCH_URL.pathname ||
    url.search !== SEARCH_URL.search ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error("cassette recorder blocked a non-public request");
  }
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("accept-encoding", "identity");
  return fetch(input, { ...init, headers });
};

afterEach(() => {
  nock.restore();
  nock.cleanAll();
  nock.enableNetConnect();
});

describe("live API cassette", () => {
  it("keeps only allowlisted public metadata", () => {
    const sanitized = sanitizeDefinitions([
      {
        scope: `${API_ORIGIN}:443`,
        method: "GET",
        path: SEARCH_PATH,
        status: 200,
        reqheaders: { accessToken: "private-token", cookie: "private-cookie" },
        rawHeaders: { "set-cookie": "private-cookie", "x-request-id": "private-request" },
        response: {
          sid: "private-session",
          queryUid: "private-account",
          books: [
            {
              bookInfo: {
                bookId: "public-book",
                title: "Public title",
                author: "Public author",
                userVid: "private-account",
              },
            },
          ],
        },
      },
    ]);

    expect(sanitized).toEqual([
      {
        scope: API_ORIGIN,
        method: "GET",
        path: SEARCH_PATH,
        status: 200,
        response: {
          books: [
            {
              bookInfo: {
                bookId: "public-book",
                title: "Public title",
                author: "Public author",
              },
            },
          ],
        },
      },
    ]);
    expect(assertSafeCassette(serializeDefinitions(sanitized))).toEqual({
      bookId: "public-book",
      title: "Public title",
      author: "Public author",
    });
    expect(() => assertSafeCassette(JSON.stringify(sanitized))).toThrow("canonical");
    expect(() =>
      assertSafeCassette(
        serializeDefinitions([
          {
            ...sanitized[0],
            response: {
              books: [{ bookInfo: { bookId: "public-book", title: 'Public "token" title' } }],
            },
          },
        ]),
        { ...REPLAY_CREDENTIALS, accessToken: '"token"' },
      ),
    ).toThrow("accessToken");
  });

  it("replays a real public catalog response through the SDK", async () => {
    if (process.env.NOCK_OFF === "true") {
      throw new Error("cassette tests require Nock interception");
    }
    if (RECORDING && process.env.WEREAD_LIVE !== "1") {
      throw new Error("recording requires both WEREAD_RECORD_CASSETTES=1 and WEREAD_LIVE=1");
    }
    if (RECORDING && (process.env.DEBUG || process.env.NODE_DEBUG)) {
      throw new Error("recording requires debug logging to be disabled");
    }
    if (RECORDING) applyConnectAttemptTimeout();

    const signal = AbortSignal.timeout(18_000);
    const store = "eink";
    let credentials = REPLAY_CREDENTIALS;
    if (RECORDING) {
      try {
        const stored = loadCredentials({ store });
        const token = await mintAccessToken(stored, fetch, { signal });
        credentials = { ...stored, ...token };
        saveCredentials(credentials, { store });
      } catch {
        throw new Error("live cassette credential refresh failed");
      }
    }
    const expectedBook = RECORDING ? undefined : assertSafeCassette(readFileSync(FIXTURE_PATH, "utf8"));

    const pendingName = RECORDING ? `.public-book-search.${process.pid}.json` : FIXTURE_NAME;
    const pendingPath = join(FIXTURE_DIR, pendingName);
    nock.back.fixtures = FIXTURE_DIR;
    nock.back.setMode(RECORDING ? "update" : "lockdown");

    try {
      const { nockDone, context } = await nock.back(pendingName, {
        afterRecord: serializeDefinitions,
        recorder: { enable_reqheaders_recording: false },
      });
      let requestFailed = false;
      let requestError: unknown;
      try {
        const result = await createEinkClient({
          credentials,
          fetchImpl: publicSearchFetch,
        }).search.books(SEARCH_TERM, {
          count: 1,
          signal,
        });
        if (expectedBook) {
          expect(result.books[0]?.bookInfo).toEqual(expectedBook);
        } else {
          expect(result.books[0]?.bookInfo?.bookId).toBeTypeOf("string");
          expect(result.books[0]?.bookInfo?.title).toBeTypeOf("string");
        }
        if (!RECORDING) context.assertScopesFinished();
      } catch (error) {
        requestFailed = true;
        requestError = RECORDING ? new Error("live cassette public search failed") : error;
      }
      try {
        nockDone();
      } catch (error) {
        if (!requestFailed) throw error;
      }
      if (requestFailed) throw requestError;

      if (RECORDING) {
        const cassette = readFileSync(pendingPath, "utf8");
        assertSafeCassette(cassette, credentials);
        renameSync(pendingPath, FIXTURE_PATH);
      }
    } finally {
      if (RECORDING) rmSync(pendingPath, { force: true });
    }
  }, 20_000);
});
