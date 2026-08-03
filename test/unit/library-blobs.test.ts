import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BlobStore } from "../../src/library/blobs.js";
import { LibraryStoreError } from "../../src/library/errors.js";
import { blobPath, stagingDirectory } from "../../src/library/paths.js";
import { expectPosixMode } from "../support/posix.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function store(): Promise<{ blobs: BlobStore; root: string; warnings: string[] }> {
  const root = mkdtempSync(join(tmpdir(), "weread-blobs-"));
  roots.push(root);
  const warnings: string[] = [];
  const blobs = new BlobStore({ root, logger: { warn: (message) => warnings.push(message) } });
  await blobs.prepare();
  return { blobs, root, warnings };
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("BlobStore", () => {
  it("round-trips bytes and reports the digest an independent hash produces", async () => {
    const { blobs } = await store();
    const bytes = Buffer.from("chapter body", "utf8");

    const ref = await blobs.put(bytes);

    expect(ref.sha256).toBe(sha256(bytes));
    expect(ref.byteLength).toBe(bytes.byteLength);
    expect(await blobs.read(ref)).toEqual(new Uint8Array(bytes));
  });

  it("stores identical bytes once, as the same file", async () => {
    const { blobs, root } = await store();
    const bytes = Buffer.from("shared across accounts", "utf8");

    const first = await blobs.put(bytes);
    const second = await blobs.put(bytes);

    expect(second.sha256).toBe(first.sha256);
    expect(statSync(blobPath(root, first.sha256)).ino).toBe(statSync(blobPath(root, second.sha256)).ino);
  });

  it("keeps memory bounded by consuming a stream chunk by chunk", async () => {
    const { blobs } = await store();
    const chunk = Buffer.alloc(64 * 1024, 7);
    let live = 0;
    let peak = 0;
    async function* source() {
      for (let index = 0; index < 80; index++) {
        live += 1;
        peak = Math.max(peak, live);
        yield chunk;
        live -= 1;
      }
    }

    const ref = await blobs.putStream(source());

    expect(ref.byteLength).toBe(80 * chunk.byteLength);
    // One chunk is in flight at a time; the store never accumulates the payload before writing.
    expect(peak).toBe(1);
  });

  it("leaves nothing behind when a stream aborts part-way", async () => {
    const { blobs, root } = await store();
    async function* failing() {
      yield Buffer.from("first", "utf8");
      throw new Error("connection reset");
    }

    await expect(blobs.putStream(failing())).rejects.toThrow("connection reset");

    await expect(readdir(stagingDirectory(root))).resolves.toEqual([]);
    const shards = await readdir(join(root, "blobs", "sha256"));
    expect(shards).toEqual([]);
  });

  it("refuses an empty payload", async () => {
    const { blobs } = await store();
    await expect(blobs.put(Buffer.alloc(0))).rejects.toThrow(LibraryStoreError);
  });

  it("reports a miss for a blob whose file was removed", async () => {
    const { blobs, root } = await store();
    const ref = await blobs.put(Buffer.from("gone", "utf8"));
    rmSync(blobPath(root, ref.sha256));

    expect(await blobs.read(ref)).toBeUndefined();
    expect(blobs.has(ref)).toBe(false);
  });

  it("reports a miss when the stored length disagrees with the record", async () => {
    const { blobs, root, warnings } = await store();
    const ref = await blobs.put(Buffer.from("original content", "utf8"));
    writeFileSync(blobPath(root, ref.sha256), "truncated");

    expect(await blobs.read(ref)).toBeUndefined();
    expect(warnings.join(" ")).toContain("unexpected length");
  });

  it("detects a same-length corruption by digest", async () => {
    const { blobs, root, warnings } = await store();
    const ref = await blobs.put(Buffer.from("aaaaaaaaaa", "utf8"));
    writeFileSync(blobPath(root, ref.sha256), "bbbbbbbbbb");

    expect(await blobs.read(ref)).toBeUndefined();
    expect(warnings.join(" ")).toContain("digest verification");
  });

  it("never follows a symbolic link planted at a blob path", async () => {
    // Blob paths are predictable, because identical content always produces the same name. A link
    // planted at one would otherwise be read back as library content.
    const { blobs, root, warnings } = await store();
    const secret = join(root, "secret.txt");
    writeFileSync(secret, "cookies and tokens");

    const bytes = Buffer.from("cookies and tokens", "utf8");
    const destination = blobPath(root, sha256(bytes));
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(secret, destination);

    const read = await blobs.read({ sha256: sha256(bytes), byteLength: bytes.byteLength });

    expect(read).toBeUndefined();
    expect(warnings.join(" ")).toContain("refusing to read a blob path");
  });

  it("replaces an incumbent whose bytes do not hash to its name", async () => {
    const { blobs, root, warnings } = await store();
    const bytes = Buffer.from("the real chapter", "utf8");
    const destination = blobPath(root, sha256(bytes));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, "wrong");

    const ref = await blobs.put(bytes);

    expect(await blobs.read(ref)).toEqual(new Uint8Array(bytes));
    expect(warnings.join(" ")).toContain("not the content it is named for");
  });

  it("writes files and directories that only the owner can read", async () => {
    const { blobs, root } = await store();
    const ref = await blobs.put(Buffer.from("private", "utf8"));

    expectPosixMode(blobPath(root, ref.sha256), 0o600);
    expectPosixMode(dirname(blobPath(root, ref.sha256)), 0o700);
    expectPosixMode(stagingDirectory(root), 0o700);
  });

  it("exports a blob byte-for-byte", async () => {
    const { blobs, root } = await store();
    const bytes = Buffer.from("exported article", "utf8");
    const ref = await blobs.put(bytes);
    const destination = join(root, `${randomUUID()}.html`);

    await blobs.writeTo(ref, destination);

    expect(readFileSync(destination)).toEqual(bytes);
  });

  it("rejects a planted file of the right size, at any size", async () => {
    // Size is the one property an attacker controls for free, because the blob path is the digest
    // of content they also hold. This ran unverified above a 1 MiB threshold, which is exactly the
    // size class chapter bodies and article sources occupy.
    const { blobs, root, warnings } = await store();
    const real = Buffer.alloc(1024 * 1024 + 1, 0x61);
    const planted = Buffer.alloc(real.byteLength, 0x62);
    const ref = await blobs.put(real);
    writeFileSync(blobPath(root, ref.sha256), planted);

    expect(await blobs.read(ref)).toBeUndefined();
    expect(warnings.join(" ")).toContain("digest verification");
  });

  it("repairs a blob whose stored copy is the wrong content", async () => {
    // Accepting a same-size incumbent meant the good bytes were discarded and no later store could
    // ever replace it: the digest stayed poisoned permanently.
    const { blobs, root } = await store();
    const bytes = Buffer.from("the genuine chapter body", "utf8");
    const digest = sha256(bytes);
    const destination = blobPath(root, digest);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, Buffer.alloc(bytes.byteLength, 0x7a));

    const ref = await blobs.put(bytes);

    expect(await blobs.read(ref)).toEqual(new Uint8Array(bytes));
  });

  it("refuses to export a blob that is missing", async () => {
    const { blobs, root } = await store();
    const ref = await blobs.put(Buffer.from("vanishing", "utf8"));
    rmSync(blobPath(root, ref.sha256));

    await expect(blobs.writeTo(ref, join(root, "out.html"))).rejects.toThrow(LibraryStoreError);
  });
});
