import { describe, expect, it } from "vitest";

import { PUBLIC_OPERATIONS } from "../../src/api/operations.js";

describe("PUBLIC_OPERATIONS", () => {
  it("publishes the exact 10 namespaces and 40 public operations", () => {
    expect(PUBLIC_OPERATIONS).toEqual({
      search: ["books", "suggest"],
      book: ["info", "detail", "chapters", "progress"],
      shelf: ["sync", "add", "delete", "pin", "setPrivate", "markFinished", "markReading"],
      publicAccounts: ["subscriptions", "articles", "resolveArticle", "paidContent", "subscribe", "unsubscribe"],
      notes: [
        "notebooks",
        "recent",
        "bookmarks",
        "mine",
        "best",
        "readReviews",
        "underlines",
        "addBookmark",
        "updateBookmark",
        "removeBookmark",
      ],
      review: ["list", "single", "add", "edit", "delete"],
      readData: ["detail"],
      discover: ["recommend", "similar"],
      ai: ["askBook", "suggest"],
      import: ["book"],
    });

    expect(Object.values(PUBLIC_OPERATIONS).flat()).toHaveLength(40);
  });
});
