import { mkdtempSync, rmSync, type statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fsHooks = vi.hoisted(() => ({
  realpath: undefined as ((value: string) => Promise<string>) | undefined,
  stat: undefined as ((value: string) => Promise<ReturnType<typeof statSync>>) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: (value: string) => fsHooks.realpath?.(value) ?? actual.realpath(value),
    stat: (value: string) => fsHooks.stat?.(value) ?? actual.stat(value),
  };
});

import {
  ALLOWED_EXT,
  assertBook,
  BookValidationError,
  maxUploadBytes,
  readBookFile,
} from "../../src/api/import-guards.js";
import { DEFAULT_STORAGE_TIMEOUT_MS, storageTimeoutMs } from "../../src/storage-timeout.js";

afterEach(() => {
  fsHooks.realpath = undefined;
  fsHooks.stat = undefined;
});

describe("personal book import guards", () => {
  it("accepts supported formats including case-insensitive EPUB names", () => {
    expect(ALLOWED_EXT).toEqual(new Set(["epub", "pdf", "mobi", "txt", "azw3"]));
    expect(() => assertBook("Novel.EPUB", 4, { WEREAD_MAX_UPLOAD_BYTES: "4" })).not.toThrow();
  });

  it("returns typed validation errors for format and size failures", () => {
    try {
      assertBook("novel.zip", 1);
      throw new Error("expected unsupported format");
    } catch (error) {
      expect(error).toBeInstanceOf(BookValidationError);
      expect(error).toMatchObject({ code: "unsupported-format" });
    }
    expect(() => assertBook("novel.epub", 5, { WEREAD_MAX_UPLOAD_BYTES: "4" })).toThrow(
      expect.objectContaining({ code: "too-large" }),
    );
  });

  it.each(["0", "-1", "1.5", "later"])("rejects invalid upload limit %s", (value) => {
    expect(() => maxUploadBytes({ WEREAD_MAX_UPLOAD_BYTES: value })).toThrow("positive integer");
  });

  it("reads a supported regular file at the size limit", async () => {
    const root = mkdtempSync(join(tmpdir(), "weread-book-guard-"));
    const path = join(root, "book.epub");
    writeFileSync(path, "book");
    const concat = vi.spyOn(Buffer, "concat");
    try {
      await expect(readBookFile("book.epub", path, { WEREAD_MAX_UPLOAD_BYTES: "4" })).resolves.toEqual(
        Buffer.from("book"),
      );
      expect(concat).not.toHaveBeenCalled();
    } finally {
      concat.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("rejects a non-regular path", async () => {
    await expect(readBookFile("book.epub", "/dev/null", {})).rejects.toThrow("regular file");
  });

  it.skipIf(process.platform !== "linux")("bounds content that exceeds its reported file size", async () => {
    await expect(
      readBookFile("book.epub", "/proc/self/cmdline", { WEREAD_MAX_UPLOAD_BYTES: "1" }),
    ).rejects.toMatchObject({ code: "too-large" });
  });
});

describe("storage timeouts", () => {
  it("uses stable defaults and explicit positive integer overrides", () => {
    expect(storageTimeoutMs({})).toBe(DEFAULT_STORAGE_TIMEOUT_MS);
    expect(storageTimeoutMs({ WEREAD_STORAGE_TIMEOUT_MS: "17" })).toBe(17);
  });

  it.each(["0", "-1", "1.5", "later"])("rejects invalid storage timeouts %s", (value) => {
    expect(() => storageTimeoutMs({ WEREAD_STORAGE_TIMEOUT_MS: value })).toThrow("positive integer");
  });
});

describe("the exported extension list cannot widen validation policy", () => {
  it("ignores a consumer mutating ALLOWED_EXT", async () => {
    const { ALLOWED_EXT } = await import("../../src/api/import-guards.js");
    (ALLOWED_EXT as Set<string>).add("exe");
    // The validator keeps its own set, so a mutated public copy changes nothing.
    expect(() => assertBook("payload.exe", 1)).toThrow(BookValidationError);
  });
});
