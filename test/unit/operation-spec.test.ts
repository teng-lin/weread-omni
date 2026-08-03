import { describe, expect, it } from "vitest";

import {
  assertOperationArguments,
  OPERATIONS,
  parameterHelp,
  requiredTextParameters,
} from "../../src/api/operation-spec.js";
import { PUBLIC_OPERATIONS } from "../../src/api/operations.js";

// The operation spec is what the CLI projection is generated from, so "one canonical surface" is
// only structural while the spec and `PUBLIC_OPERATIONS` describe the same operations. These
// assertions are the join between them: a canonical operation with no spec would silently stop
// being projected, and a spec with no canonical operation would project a tool that is not part
// of the advertised surface.

/** Upload is the only projected tool outside the canonical operation surface. */
const NON_CANONICAL = new Set<string>();

const identifier = (resource: string, action: string) => `${resource}.${action}`;

const specs = Object.values(OPERATIONS);

describe("operation spec", () => {
  it("projects every canonical operation exactly once", () => {
    const canonical = Object.entries(PUBLIC_OPERATIONS).flatMap(([resource, actions]) =>
      actions.map((action) => identifier(resource, action)),
    );
    const projected = specs.map((spec) => identifier(spec.resource, spec.action));

    expect(projected.filter((name) => !NON_CANONICAL.has(name)).sort()).toEqual([...canonical].sort());
    // Non-canonical entries are enumerated, not merely tolerated: a fourth one has to be added here.
    expect(projected.filter((name) => NON_CANONICAL.has(name)).sort()).toEqual([...NON_CANONICAL].sort());
    expect(new Set(projected).size).toBe(projected.length);
    expect(canonical).toHaveLength(40);
  });

  it("declares every required parameter, with a description on all of them", () => {
    for (const spec of specs) {
      const name = identifier(spec.resource, spec.action);
      for (const required of spec.required) {
        expect(Object.keys(spec.parameters), name).toContain(required);
      }
      for (const [parameter, declared] of Object.entries(spec.parameters)) {
        expect(declared.description, `${name}.${parameter}`).not.toBe("");
      }
    }
  });

  it("names the required string parameters the projection rejects when blank", () => {
    // AJV's `required` is satisfied by "", so the projection re-checks these. Integers are not
    // included: an integer parameter has no blank value for AJV to let through.
    expect(requiredTextParameters(OPERATIONS.notesUnderlines)).toEqual(["bookId"]);
    expect(requiredTextParameters(OPERATIONS.notesAddBookmark)).toEqual(["bookId", "range", "markText"]);
    expect(requiredTextParameters(OPERATIONS.shelfSync)).toEqual([]);
  });

  it("declares a non-negative domain for every integer parameter", () => {
    for (const spec of specs) {
      for (const [name, parameter] of Object.entries(spec.parameters)) {
        if (parameter.kind === "integer") {
          expect(parameter.minimum, `${identifier(spec.resource, spec.action)}.${name}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("validates required text, numeric bounds, and enums from the declaration", () => {
    expect(() => assertOperationArguments(OPERATIONS.searchBooks, { keyword: " " })).toThrow("keyword");
    expect(() => assertOperationArguments(OPERATIONS.bookInfo, { bookId: 1 })).toThrow("bookId must be a string");
    expect(() => assertOperationArguments(OPERATIONS.bookDetail, { bookId: "b", count: 0 })).toThrow("count");
    expect(() => assertOperationArguments(OPERATIONS.bookDetail, { bookId: "b", count: 13 })).toThrow("count");
    expect(() => assertOperationArguments(OPERATIONS.reviewAdd, { bookId: "b", content: "c", star: 37 })).toThrow(
      "star",
    );
    expect(() =>
      assertOperationArguments(OPERATIONS.notesReadReviews, {
        bookId: "b",
        chapterUid: 1,
        reviews: [{ range: "1-2", count: 21 }],
      }),
    ).toThrow("count");
    expect(() => assertOperationArguments(OPERATIONS.bookDetail, { bookId: "b", count: 12 })).not.toThrow();
    expect(() =>
      assertOperationArguments(OPERATIONS.publicAccountsArticles, {
        accountId: "not-an-account",
        count: 20,
        synckey: 0,
      }),
    ).toThrow("accountId");
    expect(() =>
      assertOperationArguments(OPERATIONS.publicAccountsArticles, {
        accountId: "MP_WXS_123",
        count: 20,
        synckey: 0,
      }),
    ).not.toThrow();
  });

  it("renders declared defaults and bounds for CLI help", () => {
    expect(parameterHelp(OPERATIONS.bookDetail.parameters.count)).toBe(
      "Entries to return from each catalog. (default: 6, min: 1, max: 12)",
    );
    expect(parameterHelp(OPERATIONS.reviewAdd.parameters.star)).toContain("20, 40, 60, 80, or 100");
    expect(OPERATIONS.publicAccountsArticles.parameters.offset.default).toBeUndefined();
  });

  it("describes local import paths as confined to the configured root", () => {
    expect(OPERATIONS.importBook.parameters.path.description).toContain("WEREAD_LOCAL_IMPORT_ROOT");
  });
});
