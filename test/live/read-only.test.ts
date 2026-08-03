import { beforeAll, describe, expect, it } from "vitest";

import { applyConnectAttemptTimeout } from "../../src/connect-timeout.js";
import { createEinkClient } from "../../src/index.js";

describe.skipIf(process.env.WEREAD_LIVE !== "1")("read-only live release probe", () => {
  // The probe drives the SDK directly, and the SDK deliberately never touches this Node-wide
  // default — only a process entry point may. This vitest worker is the process entry point here,
  // so it stands in for `weread` and applies the same setting it does. Without it
  // the probe fails intermittently with `network error`, because Node's 250 ms Happy Eyeballs
  // budget expires a few milliseconds before a ~255 ms connect to WeRead completes.
  beforeAll(() => {
    applyConnectAttemptTimeout();
  });

  it("reads the selected account without changing it", async () => {
    const client = createEinkClient();

    const shelf = await client.shelf.sync({ signal: AbortSignal.timeout(15_000) });
    expect(Array.isArray(shelf.books)).toBe(true);
    // `albums` is optional: the live endpoint omits it for accounts with no album collections.
    // Asserting it is always an array is what made this probe fail against a healthy HTTP 200.
    expect(shelf.albums === undefined || Array.isArray(shelf.albums)).toBe(true);

    const notebooks = await client.notes.notebooks({ count: 1, signal: AbortSignal.timeout(15_000) });
    expect(Array.isArray(notebooks.books)).toBe(true);
    expect(notebooks.books.length).toBeLessThanOrEqual(1);
    const notebook = notebooks.books[0];
    if (notebooks.hasMore === 1 && typeof notebook?.sort === "number") {
      const next = await client.notes.notebooks({
        count: 1,
        lastSort: notebook.sort,
        signal: AbortSignal.timeout(15_000),
      });
      expect(next.books.length).toBeLessThanOrEqual(1);
      expect(next.books[0]?.bookId).not.toBe(notebook.bookId);
    }

    const search = await client.search.books("三体", { signal: AbortSignal.timeout(15_000) });
    expect(Array.isArray(search.books)).toBe(true);
    const bookId = search.books.find((result) => result.bookInfo?.bookId)?.bookInfo?.bookId;
    if (!bookId) throw new Error("live search returned no book id");

    const popular = await client.notes.best(bookId, {
      count: 2,
      signal: AbortSignal.timeout(15_000),
    });
    const nextPopular = await client.notes.best(bookId, {
      count: 2,
      maxIdx: popular.items?.length ?? 0,
      signal: AbortSignal.timeout(15_000),
    });
    expect(popular.items?.length ?? 0).toBeLessThanOrEqual(2);
    expect(nextPopular.items?.length ?? 0).toBeLessThanOrEqual(2);
    const popularIds = new Set((popular.items ?? []).map((item) => item.bookmarkId ?? JSON.stringify(item)));
    expect((nextPopular.items ?? []).every((item) => !popularIds.has(item.bookmarkId ?? JSON.stringify(item)))).toBe(
      true,
    );

    const reviews = await client.review.list(bookId, {
      count: 2,
      signal: AbortSignal.timeout(15_000),
    });
    const nextReviews = await client.review.list(bookId, {
      count: 2,
      maxIdx: reviews.reviews.length,
      signal: AbortSignal.timeout(15_000),
    });
    expect(reviews.reviews.length).toBeLessThanOrEqual(2);
    expect(nextReviews.reviews.length).toBeLessThanOrEqual(2);
    const reviewIds = new Set(reviews.reviews.map((review) => review.reviewId ?? JSON.stringify(review)));
    expect(nextReviews.reviews.every((review) => !reviewIds.has(review.reviewId ?? JSON.stringify(review)))).toBe(true);
  }, 60_000);

  it.skipIf(!/^MP_WXS_[0-9]+$/.test(process.env.WEREAD_LIVE_PUBLIC_ACCOUNT_ID ?? ""))(
    "lists and resolves one public-account article without changing subscriptions",
    async () => {
      const accountId = process.env.WEREAD_LIVE_PUBLIC_ACCOUNT_ID as string;
      const client = createEinkClient();
      const page = await client.publicAccounts.articles(accountId, {
        count: 1,
        offset: 0,
        signal: AbortSignal.timeout(15_000),
      });
      expect(page.accountId).toBe(accountId);
      expect(page.articles.length).toBeLessThanOrEqual(1);
      const reviewId = page.articles[0]?.reviewId;
      if (!reviewId) throw new Error("live public-account probe returned no resolvable article");

      const detail = await client.review.single(reviewId, { signal: AbortSignal.timeout(15_000) });
      expect(detail.review).toBeTypeOf("object");
      expect(detail.review?.mpInfo).toBeTypeOf("object");
    },
    45_000,
  );
});
