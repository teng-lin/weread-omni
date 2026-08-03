import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CanonicalClient, WeReadClient } from "../../src/api/client.js";
import {
  captureClientSession,
  type MobileApiClient,
  registerClientSessionProvider,
} from "../../src/api/mobile-client.js";
import type { BookInfo, ChapterContent, ChapterInfoResponse } from "../../src/api/types.js";
import { withContentLibrary } from "../../src/library/cached-client.js";
import { ContentLibrary } from "../../src/library/store.js";

const roots: string[] = [];
const opened: ContentLibrary[] = [];

afterEach(() => {
  for (const library of opened.splice(0)) {
    try {
      library.close();
    } catch {
      // Closed by the test.
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function library(): Promise<ContentLibrary> {
  const root = mkdtempSync(join(tmpdir(), "weread-cached-"));
  roots.push(root);
  const instance = await ContentLibrary.open({ vid: "vid-1", root, env: {} });
  opened.push(instance);
  return instance;
}

interface Counts {
  chapterContent: number;
  chapters: number;
  info: number;
}

/**
 * Chapter text is not a canonical operation, so a client that serves it carries it as an extra.
 * The wrapper only installs the chapter cache for such a client, hence the narrowing helper.
 */
type ClientWithChapterContent = CanonicalClient & {
  readonly book: CanonicalClient["book"] & {
    chapterContent: (bookId: string, chapterUid: number) => Promise<ChapterContent>;
  };
};

function withChapterContent(client: CanonicalClient): ClientWithChapterContent {
  if (typeof (client.book as Partial<ClientWithChapterContent["book"]>).chapterContent !== "function") {
    throw new TypeError("client does not provide chapter content");
  }
  return client as ClientWithChapterContent;
}

/**
 * A canonical client stub that counts calls.
 *
 * Only the three wrapped operations are implemented; the rest exist so the object satisfies the
 * structural contract, and any accidental call fails loudly rather than silently returning
 * undefined.
 */
function stubClient(overrides: { chapterContent?: () => Promise<ChapterContent> } = {}): {
  client: CanonicalClient;
  counts: Counts;
} {
  const counts: Counts = { chapterContent: 0, chapters: 0, info: 0 };
  const unreachable = new Proxy(
    {},
    {
      get: (_target, property) => {
        throw new Error(`unexpected call to ${String(property)}`);
      },
    },
  );

  const client = {
    search: unreachable,
    shelf: unreachable,
    publicAccounts: unreachable,
    notes: unreachable,
    review: unreachable,
    readData: unreachable,
    discover: unreachable,
    ai: unreachable,
    import: unreachable,
    book: {
      detail: unreachable,
      progress: unreachable,
      chapterContent: async (): Promise<ChapterContent> => {
        counts.chapterContent += 1;
        if (overrides.chapterContent) return overrides.chapterContent();
        return { bookId: "b1", chapterUid: 7, format: "epub", html: "<p>fetched</p>" };
      },
      chapters: async (): Promise<ChapterInfoResponse> => {
        counts.chapters += 1;
        return { bookId: "b1", synckey: 12, chapters: [{ chapterUid: 7, chapterIdx: 1 }] };
      },
      info: async (): Promise<BookInfo> => {
        counts.info += 1;
        return { bookId: "b1", title: "Fetched Title" };
      },
    },
  } as unknown as CanonicalClient;

  return { client, counts };
}

/**
 * The single E-Ink backend `WeReadClient` wraps.
 *
 * Only `book.chapters` answers, and its synckey says which backend produced the listing the wrapper
 * decided to store.
 */
function backendStub(synckey: number): MobileApiClient {
  return {
    search: {},
    shelf: {},
    publicAccounts: {},
    notes: {},
    review: {},
    readData: {},
    discover: {},
    ai: {},
    import: {},
    book: {
      chapters: async (): Promise<ChapterInfoResponse> => ({
        bookId: "b1",
        synckey,
        chapters: [{ chapterUid: 7, chapterIdx: 1 }],
      }),
    },
  } as unknown as MobileApiClient;
}

describe("withContentLibrary", () => {
  it("serves the second chapter read without touching the network", async () => {
    const store = await library();
    const { client, counts } = stubClient();
    const wrapped = withContentLibrary(client, { library: store });

    const first = await withChapterContent(wrapped).book.chapterContent("b1", 7);
    const second = await withChapterContent(wrapped).book.chapterContent("b1", 7);

    expect(counts.chapterContent).toBe(1);
    expect(second).toEqual(first);
  });

  it("serves a stored chapter index and book metadata without refetching", async () => {
    const store = await library();
    const { client, counts } = stubClient();
    const wrapped = withContentLibrary(client, { library: store });

    await wrapped.book.chapters("b1");
    await wrapped.book.chapters("b1");
    await wrapped.book.info("b1");
    await wrapped.book.info("b1");

    expect(counts.chapters).toBe(1);
    expect(counts.info).toBe(1);
  });

  it("refetches and replaces in refresh mode", async () => {
    const store = await library();
    const { client, counts } = stubClient();

    await withChapterContent(withContentLibrary(client, { library: store })).book.chapterContent("b1", 7);
    await withChapterContent(withContentLibrary(client, { library: store, mode: "refresh" })).book.chapterContent(
      "b1",
      7,
    );

    expect(counts.chapterContent).toBe(2);
  });

  it("neither reads nor writes when the library is off", async () => {
    const store = await library();
    const { client, counts } = stubClient();
    const wrapped = withContentLibrary(client, { library: store, mode: "off" });

    await withChapterContent(wrapped).book.chapterContent("b1", 7);
    await withChapterContent(wrapped).book.chapterContent("b1", 7);

    expect(counts.chapterContent).toBe(2);
    // Nothing was written either, so a later run starts from scratch rather than from a partial.
    expect(store.has("b1", 7)).toBe(false);
  });

  it("does not store a failed fetch", async () => {
    // Storing an error would make the failure permanent: nothing on the read path ever refetches.
    const store = await library();
    let attempts = 0;
    const { client } = stubClient({
      chapterContent: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("upstream refused");
        return { bookId: "b1", chapterUid: 7, format: "epub", html: "<p>eventually</p>" };
      },
    });
    const wrapped = withContentLibrary(client, { library: store });

    await expect(withChapterContent(wrapped).book.chapterContent("b1", 7)).rejects.toThrow("upstream refused");
    expect(store.has("b1", 7)).toBe(false);

    const recovered = await withChapterContent(wrapped).book.chapterContent("b1", 7);
    expect(recovered.html).toBe("<p>eventually</p>");
  });

  it("leaves chapter text absent when the client does not serve it", async () => {
    // Installing the cache unconditionally would turn a clean "not supported" into a TypeError
    // thrown from inside this decorator.
    const store = await library();
    const { client } = stubClient();
    delete (client.book as { chapterContent?: unknown }).chapterContent;

    const wrapped = withContentLibrary(client, { library: store });

    expect("chapterContent" in wrapped.book).toBe(false);
  });

  it("keeps the pinned mobile session reachable through the wrapper", async () => {
    // The seam is keyed on object identity, so a wrapper misses it unless it re-registers. Losing
    // it breaks import.book, which needs one session across several calls.
    const store = await library();
    const { client } = stubClient();
    const session = { mobile: { marker: "the-session" }, resources: {} };
    registerClientSessionProvider(client, () => session as never);

    const wrapped = withContentLibrary(client, { library: store });

    expect(captureClientSession(wrapped)).toBe(session);
  });

  it("leaves every unwrapped operation referentially intact", async () => {
    const store = await library();
    const { client } = stubClient();

    const wrapped = withContentLibrary(client, { library: store });

    for (const key of [
      "search",
      "shelf",
      "publicAccounts",
      "notes",
      "review",
      "readData",
      "discover",
      "ai",
      "import",
    ]) {
      expect(wrapped[key as keyof CanonicalClient]).toBe(client[key as keyof CanonicalClient]);
    }
    expect(wrapped.book.detail).toBe(client.book.detail);
    expect(wrapped.book.progress).toBe(client.book.progress);
  });

  it("still answers when the library cannot be written to", async () => {
    const store = await library();
    const { client, counts } = stubClient();
    const warnings: string[] = [];
    // Closing the database makes every library call throw, standing in for a full disk or a
    // revoked permission.
    store.close();
    const wrapped = withContentLibrary(client, { library: store, logger: { warn: (m) => warnings.push(m) } });

    const content = await withChapterContent(wrapped).book.chapterContent("b1", 7);

    expect(content.html).toBe("<p>fetched</p>");
    expect(counts.chapterContent).toBe(1);
    expect(warnings.join(" ")).toMatch(/content library could not/);
  });

  it("declines to store a degraded chapter index without failing the call", async () => {
    const store = await library();
    const counts = { chapters: 0 };
    const client = {
      book: {
        chapters: async (): Promise<ChapterInfoResponse> => {
          counts.chapters += 1;
          return { bookId: "b1", synckey: 0, chapters: [] };
        },
      },
    } as unknown as CanonicalClient;

    const wrapped = withContentLibrary(client, { library: store });
    const first = await wrapped.book.chapters("b1");
    const second = await wrapped.book.chapters("b1");

    expect(first.chapters).toEqual([]);
    // Refetched, because an empty listing is never stored: a degraded response must not become
    // the permanent answer.
    expect(counts.chapters).toBe(2);
    expect(second.chapters).toEqual([]);
  });

  it("files a chapter index under the backend that actually served it", async () => {
    // The column still holds rows an older release wrote under a second backend, whose synckeys
    // never compared with these. Writing there now would make this listing unreadable, and once its
    // synckey lost the comparison, unwritable too.
    const store = await library();
    const einkOnly = new WeReadClient({ eink: backendStub(500) });

    await withContentLibrary(einkOnly, { library: store }).book.chapters("b1");

    expect(store.getChapterIndex("b1", "eink")?.synckey).toBe(500);
    expect(store.getChapterIndex("b1", "official")).toBeUndefined();
  });

  it("keeps filing under eink through a second wrap", async () => {
    // A re-wrap must not land the same book in a different row from the first wrap.
    const store = await library();
    const once = withContentLibrary(new WeReadClient({ eink: backendStub(500) }), { library: store });

    await withContentLibrary(once, { library: store, mode: "refresh" }).book.chapters("b1");

    expect(store.getChapterIndex("b1", "eink")?.synckey).toBe(500);
    expect(store.getChapterIndex("b1", "official")).toBeUndefined();
  });
});
