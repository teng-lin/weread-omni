import { describe, expect, it, vi } from "vitest";

import type { MobileCallOptions, MobileResponse } from "../../src/api/mobile.js";
import { PUBLIC_OPERATIONS } from "../../src/api/operations.js";
import { notesModule } from "../../src/api/resources/notes.js";
import { reviewModule } from "../../src/api/resources/review.js";
import { searchModule } from "../../src/api/resources/search.js";
import type { MobileTransport } from "../../src/api/types.js";

const transport = (body: unknown) => {
  const call = vi.fn(
    async <T = unknown>(
      _method: string,
      _path: string,
      _options: MobileCallOptions = {},
    ): Promise<MobileResponse<T>> => ({
      status: 200,
      headers: new Headers(),
      body: body as T,
    }),
  );
  return { call, mobile: { call } as MobileTransport };
};

/**
 * The E-Ink resource modules cover the reads that used to justify a second backend.
 *
 * These were written as a parity check against the official API. That backend is gone, so there is
 * nothing left to compare against -- but the assertions are the reason its absence costs nothing,
 * so they stay: each one pins the request an E-Ink module actually sends.
 */
describe("eink read coverage", () => {
  it("replaces title search with the paginated multi-scope store search", async () => {
    const { call, mobile } = transport({ books: [] });

    await searchModule(mobile).books("dune", { scope: 0, count: 5, maxIdx: 7 });

    expect(call).toHaveBeenCalledWith("GET", "/store/search", {
      query: { keyword: "dune", scope: 0, count: 5, maxIdx: 7 },
    });
  });

  it("defaults book search to the official ebook scope without inventing a page size", async () => {
    const { call, mobile } = transport({ books: [] });

    await searchModule(mobile).books("dune");

    expect(call).toHaveBeenCalledWith("GET", "/store/search", {
      query: { keyword: "dune", scope: 10, count: undefined, maxIdx: 0 },
    });
  });

  it("rejects an unknown search scope before transport", () => {
    const { call, mobile } = transport({ books: [] });
    expect(() => searchModule(mobile).books("dune", { scope: 99 as never })).toThrow("scope");
    expect(call).not.toHaveBeenCalled();
  });

  it("reads thoughts attached to one or more highlight ranges", async () => {
    const { call, mobile } = transport({ reviews: [] });
    const reviews = [{ range: "13059-13119", count: 5, maxIdx: 2, synckey: 9 }];

    await notesModule(mobile).readReviews("book", 2054, reviews);

    expect(call).toHaveBeenCalledWith("POST", "/book/readreviews", {
      body: { bookId: "book", chapterUid: 2054, cht2sMode: "", reviews },
      idempotent: true,
    });
  });

  it("reads a single thought with the official comment and like defaults", async () => {
    const { call, mobile } = transport({ reviewId: "review" });

    await reviewModule(mobile).single("review");

    expect(call).toHaveBeenCalledWith("GET", "/review/single", {
      query: {
        reviewId: "review",
        commentsCount: 10,
        commentsDirection: 0,
        likesCount: 10,
        likesDirection: 0,
        synckey: 0,
      },
    });
  });

  it("rejects an unknown review direction before transport", () => {
    const { call, mobile } = transport({ reviewId: "review" });
    expect(() => reviewModule(mobile).single("review", { commentsDirection: 2 as never })).toThrow("commentsDirection");
    expect(call).not.toHaveBeenCalled();
  });

  it("keeps the expanded reads in the canonical operation surface", () => {
    expect(PUBLIC_OPERATIONS.notes).toContain("readReviews");
    expect(PUBLIC_OPERATIONS.review).toContain("single");
    expect(PUBLIC_OPERATIONS.search).toContain("suggest");
    expect(Object.values(PUBLIC_OPERATIONS).flat()).toHaveLength(40);
  });
});
