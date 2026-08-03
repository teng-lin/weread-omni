import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LibraryError } from "../../src/library/errors.js";
import { blobPath, checkedChapterUid, checkedDigest, checkedIdentifier, libraryRoot } from "../../src/library/paths.js";

const DIGEST = "a".repeat(64);

describe("libraryRoot", () => {
  it("prefers WEREAD_LIBRARY_DIR", () => {
    expect(libraryRoot({ WEREAD_LIBRARY_DIR: "/tmp/explicit", XDG_DATA_HOME: "/tmp/xdg" })).toBe("/tmp/explicit");
  });

  it("falls back to XDG_DATA_HOME", () => {
    expect(libraryRoot({ XDG_DATA_HOME: "/tmp/xdg" })).toBe(join("/tmp/xdg", "weread", "library"));
  });

  it("falls back to the home directory", () => {
    expect(libraryRoot({})).toBe(join(homedir(), ".local", "share", "weread", "library"));
  });

  it("treats a blank value as unset", () => {
    expect(libraryRoot({ WEREAD_LIBRARY_DIR: "   " })).toBe(join(homedir(), ".local", "share", "weread", "library"));
  });

  it("keeps the library out of the credential directory", () => {
    // The config root is documented as secret-bearing and its reader caps state at 1 MiB. Bulk
    // content has a different retention profile and no size ceiling.
    expect(libraryRoot({ WEREAD_CONFIG_DIR: "/tmp/config" })).not.toContain("/tmp/config");
  });
});

describe("checkedDigest", () => {
  it("accepts a lowercase hexadecimal digest", () => {
    expect(checkedDigest(DIGEST)).toBe(DIGEST);
  });

  it.each([
    ["a path-shaped value of the right length", "a../../../../../../etc/passwd_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    ["uppercase hexadecimal", "A".repeat(64)],
    ["too short", "a".repeat(63)],
    ["too long", "a".repeat(65)],
    ["a traversal segment", `${"a".repeat(58)}/../b`],
  ])("rejects %s", (_label, value) => {
    expect(() => checkedDigest(value)).toThrow(LibraryError);
  });

  it("rejects a value that only starts with a hex digit", () => {
    // The digest becomes a path component. An anchored-prefix check would pass this.
    const value = `a${"/".repeat(63)}`;
    expect(value).toHaveLength(64);
    expect(() => checkedDigest(value)).toThrow(LibraryError);
  });
});

describe("blobPath", () => {
  it("shards by the first byte of the digest", () => {
    expect(blobPath("/lib", DIGEST)).toBe(join("/lib", "blobs", "sha256", "aa", DIGEST));
  });
});

describe("checkedIdentifier", () => {
  it.each([["3300060341"], ["CB_a"], ["cb_A"], ["MP_WXS_123"]])("accepts the upstream identifier %s", (value) => {
    expect(checkedIdentifier(value, "bookId")).toBe(value);
  });

  it("distinguishes identifiers that differ only by case", () => {
    expect(checkedIdentifier("CB_a", "bookId")).not.toBe(checkedIdentifier("cb_A", "bookId"));
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["a NUL byte", "book\u0000id"],
    ["a newline", "book\nid"],
    ["a delete character", "book\u007fid"],
  ])("rejects %s", (_label, value) => {
    expect(() => checkedIdentifier(value, "bookId")).toThrow(LibraryError);
  });
});

describe("checkedChapterUid", () => {
  it("accepts zero and positive integers", () => {
    expect(checkedChapterUid(0)).toBe(0);
    expect(checkedChapterUid(42)).toBe(42);
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["not a number", Number.NaN],
    ["beyond the safe range", Number.MAX_SAFE_INTEGER + 2],
  ])("rejects %s", (_label, value) => {
    expect(() => checkedChapterUid(value)).toThrow(LibraryError);
  });
});
