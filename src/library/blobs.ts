import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, opendirSync, openSync, readFileSync } from "node:fs";
import { chmod, link, lstat, mkdir, open, rename, rm, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { emitLog, type Logger } from "../logger.js";
import { LibraryStoreError } from "./errors.js";
import { blobPath, blobsDirectory, checkedDigest, stagingDirectory } from "./paths.js";

const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;

/** Hash and copy in chunks this large so a large blob never monopolises the thread. */
const CHUNK_BYTES = 64 * 1024;

/** Reclaim staging entries older than this at open. */
const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface BlobRef {
  sha256: string;
  byteLength: number;
  mediaType?: string;
}

export interface BlobStoreOptions {
  root: string;
  logger?: Logger;
}

/**
 * Content-addressed store for payload bytes.
 *
 * Bytes live here rather than in the database because they are large, streamable, and dedup across
 * accounts for free. The name of a blob is the digest of its contents, so a truncated write cannot
 * occupy a valid path: the file only acquires its name after the last byte is durable.
 */
export class BlobStore {
  readonly #root: string;
  readonly #logger?: Logger;
  #linkSupported = true;

  constructor(options: BlobStoreOptions) {
    this.#root = options.root;
    this.#logger = options.logger;
  }

  /**
   * Prepare the directories and confirm the filesystem can host the store.
   *
   * `link` is preferred but not required: it never clobbers, which gives first-writer-wins for
   * free. Where it is rejected -- exFAT, some FUSE mounts -- `rename` is equally safe here, because
   * two racing writers are storing byte-identical content by construction.
   */
  async prepare(): Promise<void> {
    mkdirSync(blobsDirectory(this.#root), { recursive: true, mode: DIRECTORY_MODE });
    mkdirSync(stagingDirectory(this.#root), { recursive: true, mode: DIRECTORY_MODE });
    await chmod(stagingDirectory(this.#root), DIRECTORY_MODE);
    await this.#probeLink();
    await this.#sweepStaging();
  }

  async #probeLink(): Promise<void> {
    const staging = stagingDirectory(this.#root);
    const source = join(staging, `.probe.${process.pid}.${randomUUID()}`);
    const target = `${source}.link`;
    const handle = await open(source, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, FILE_MODE);
    await handle.close();
    try {
      await link(source, target);
      await unlink(target);
    } catch (error) {
      this.#linkSupported = false;
      emitLog(this.#logger, "debug", `library blob store falling back to rename: ${(error as Error).message}`);
    } finally {
      await rm(source, { force: true });
    }
  }

  /** Remove staging files abandoned by a killed process. */
  async #sweepStaging(): Promise<void> {
    const staging = stagingDirectory(this.#root);
    const cutoff = Date.now() - STAGING_MAX_AGE_MS;
    let directory: ReturnType<typeof opendirSync>;
    try {
      directory = opendirSync(staging);
    } catch {
      return;
    }
    try {
      for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) {
        const candidate = join(staging, entry.name);
        try {
          const info = await stat(candidate);
          if (info.mtimeMs < cutoff) await rm(candidate, { force: true, recursive: true });
        } catch {
          // Raced with another sweeper, or the entry vanished. Either way it is gone.
        }
      }
    } finally {
      directory.closeSync();
    }
  }

  /**
   * Whether a payload is present and plausibly intact.
   *
   * Existence alone was not enough: a truncated file, a same-length substitution, or a directory
   * left at the path all reported present, and `ContentLibrary.has` promises callers they can skip
   * fetching. They would then get nothing. The digest is not recomputed here -- this runs per
   * lookup and the verified read path still catches substitution -- but type and length are cheap
   * and rule out the cases that actually occur.
   */
  has(ref: Pick<BlobRef, "sha256"> & { byteLength?: number }): boolean {
    try {
      const info = lstatSync(blobPath(this.#root, checkedDigest(ref.sha256)));
      if (!info.isFile()) return false;
      return ref.byteLength === undefined || info.size === ref.byteLength;
    } catch {
      return false;
    }
  }

  /** Read and verify a text blob synchronously for synchronous library availability checks. */
  readTextSync(ref: BlobRef): string | undefined {
    const path = blobPath(this.#root, checkedDigest(ref.sha256));
    const noFollow = constants.O_NOFOLLOW ?? 0;
    let descriptor: number | undefined;
    try {
      if (noFollow === 0 && !lstatSync(path).isFile()) return undefined;
      descriptor = openSync(path, constants.O_RDONLY | noFollow);
      const info = fstatSync(descriptor);
      if (!info.isFile() || info.size !== ref.byteLength) return undefined;
      const bytes = readFileSync(descriptor);
      if (createHash("sha256").update(bytes).digest("hex") !== ref.sha256) return undefined;
      return bytes.toString("utf8");
    } catch {
      return undefined;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  /** Store bytes already held in memory. */
  async put(bytes: Uint8Array, meta?: { mediaType?: string }): Promise<BlobRef> {
    return this.putStream(
      (async function* () {
        yield bytes;
      })(),
      meta,
    );
  }

  /**
   * Store a stream, hashing as it is written.
   *
   * Memory stays bounded by one chunk regardless of the payload, which is what makes a large audio
   * track storable at all.
   */
  async putStream(
    source: AsyncIterable<Uint8Array>,
    meta?: { mediaType?: string; signal?: AbortSignal },
  ): Promise<BlobRef> {
    const staging = stagingDirectory(this.#root);
    const temporary = join(staging, `.${process.pid}.${randomUUID()}.tmp`);
    const hash = createHash("sha256");
    let byteLength = 0;

    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, FILE_MODE);
    try {
      for await (const chunk of source) {
        meta?.signal?.throwIfAborted();
        hash.update(chunk);
        byteLength += chunk.byteLength;
        await handle.write(chunk);
      }
      await handle.sync();

      // The digest names the bytes that went in, not the bytes that landed. A short write -- most
      // plausibly ENOSPC part-way through a large track -- would otherwise be stored under the
      // digest of content it does not contain.
      const written = await handle.stat();
      if (written.size !== byteLength) {
        throw new LibraryStoreError(
          `blob staging wrote ${written.size} bytes but hashed ${byteLength}; refusing to store it`,
        );
      }
      await handle.close();
      await chmod(temporary, FILE_MODE);

      if (byteLength === 0) throw new LibraryStoreError("refusing to store an empty blob");

      const digest = hash.digest("hex");
      await this.#commit(temporary, digest);
      return { sha256: digest, byteLength, ...(meta?.mediaType ? { mediaType: meta.mediaType } : {}) };
    } finally {
      await handle.close().catch(() => undefined);
      // Guarded like the close above it. `force` only suppresses ENOENT, so an EBUSY or EPERM here
      // -- a virus scanner holding the staging file, say -- would reject out of `finally` and
      // discard a blob that is already durably committed, leaving the caller to refetch forever.
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async #commit(temporary: string, digest: string): Promise<void> {
    const destination = blobPath(this.#root, digest);
    await mkdir(dirname(destination), { recursive: true, mode: DIRECTORY_MODE });

    if (!this.#linkSupported) {
      await rename(temporary, destination);
      await this.#syncDirectory(dirname(destination));
      return;
    }

    try {
      await link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A name is not a guarantee about contents. An incumbent of the wrong size, or one that is
      // not a regular file at all, is either damage or something planted; accepting it would serve
      // its bytes as this content forever, and would also discard the good bytes we are holding.
      await this.#acceptIncumbent(destination, temporary, digest);
    }
    await this.#syncDirectory(dirname(destination));
  }

  /**
   * Decide whether the file already occupying a digest path may stand.
   *
   * Matching size is not evidence. The whole point of the path is that its name is the digest of
   * its contents, so the only question worth asking is whether the bytes there actually hash to
   * it. Accepting on size meant a planted or damaged file of the right length was adopted
   * permanently -- and because the correct bytes in staging were then discarded, no later store
   * could ever repair it.
   */
  async #acceptIncumbent(destination: string, temporary: string, digest: string): Promise<void> {
    const existing = await this.#lstat(destination);
    const sound = existing?.isFile() === true && (await this.#digestOf(destination)) === digest;
    if (sound) return;

    const detail =
      existing === undefined
        ? "unreadable"
        : existing.isFile()
          ? "not the content it is named for"
          : "not a regular file";
    emitLog(this.#logger, "warn", `replacing a blob whose stored copy is ${detail}`);
    await rm(destination, { force: true });
    try {
      await link(temporary, destination);
    } catch (error) {
      // Another writer replaced it in the same window. It stored the same bytes we hold, so its
      // copy is as good as ours and losing the race is success.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  /** Hash a file in place, or undefined when it cannot be read. */
  async #digestOf(path: string): Promise<string | undefined> {
    try {
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const hash = createHash("sha256");
        const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
        let offset = 0;
        for (;;) {
          const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, offset);
          if (bytesRead === 0) break;
          hash.update(Uint8Array.prototype.slice.call(buffer, 0, bytesRead));
          offset += bytesRead;
        }
        return hash.digest("hex");
      } finally {
        await handle.close();
      }
    } catch {
      return undefined;
    }
  }

  async #lstat(path: string) {
    try {
      return await lstat(path);
    } catch {
      return undefined;
    }
  }

  async #syncDirectory(path: string): Promise<void> {
    try {
      const handle = await open(path, constants.O_RDONLY);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {
      // Directory fsync is unavailable on Windows and rejected by some filesystems. The rename or
      // link already happened, so failing here would report a completed write as a failure.
    }
  }

  /** Read a blob whole, verifying it. Returns undefined for anything unusable. */
  async read(ref: BlobRef): Promise<Uint8Array | undefined> {
    const handle = await this.#openVerified(ref);
    if (handle === undefined) return undefined;
    try {
      // Always hashed, at every size. A size-only check verifies the one property an attacker
      // controls for free: blob paths are the digest of their contents, so anyone who can obtain
      // the same chapter knows where it will be stored and can plant a file of matching length
      // there. Skipping the hash above a threshold made exactly the large payloads -- chapter HTML
      // and article bodies -- the ones served unverified.
      const chunks: Uint8Array[] = [];
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
      let total = 0;
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, total);
        if (bytesRead === 0) break;
        const chunk = Uint8Array.prototype.slice.call(buffer, 0, bytesRead);
        hash.update(chunk);
        chunks.push(chunk);
        total += bytesRead;
      }
      if (hash.digest("hex") !== ref.sha256) {
        emitLog(this.#logger, "warn", "a stored blob failed digest verification");
        return undefined;
      }
      // A plain view rather than the Buffer subclass: the declared return type is Uint8Array, and
      // handing back a Buffer makes callers' equality checks depend on which one they guessed.
      const joined = Buffer.concat(chunks);
      return new Uint8Array(joined.buffer, joined.byteOffset, joined.byteLength);
    } finally {
      await handle.close();
    }
  }

  async readText(ref: BlobRef): Promise<string | undefined> {
    const bytes = await this.read(ref);
    return bytes === undefined ? undefined : Buffer.from(bytes).toString("utf8");
  }

  /**
   * Open a blob for reading, refusing to follow a symbolic link.
   *
   * Blob paths are predictable -- content dedups precisely because identical bytes produce the same
   * name -- so anyone who can obtain the same chapter knows where it will be stored. Following a
   * link planted there would return its target's bytes as library content.
   */
  async #openVerified(ref: BlobRef) {
    const path = blobPath(this.#root, checkedDigest(ref.sha256));
    // O_NOFOLLOW is undefined on Windows, so the constant alone cannot be relied on. Where it is
    // missing the lstat comparison below carries the check -- `handle.stat()` describes the target
    // of a link, not the link, so it can never detect one on its own.
    const noFollow = constants.O_NOFOLLOW ?? 0;
    if (noFollow === 0) {
      const link = await this.#lstat(path);
      if (link !== undefined && !link.isFile()) {
        emitLog(this.#logger, "warn", "refusing to read a blob path that is not a regular file");
        return undefined;
      }
    }
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path, constants.O_RDONLY | noFollow);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ELOOP" || code === "EMLINK") {
        emitLog(this.#logger, "warn", "refusing to read a blob path that is a symbolic link");
      } else if (code !== "ENOENT") {
        emitLog(this.#logger, "warn", `a stored blob could not be opened: ${code ?? "unknown error"}`);
      }
      return undefined;
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) {
        emitLog(this.#logger, "warn", "refusing to read a blob path that is not a regular file");
        await handle.close();
        return undefined;
      }
      if (info.size !== ref.byteLength) {
        emitLog(this.#logger, "warn", "a stored blob has an unexpected length");
        await handle.close();
        return undefined;
      }
      return handle;
    } catch (error) {
      await handle.close();
      throw new LibraryStoreError("failed to inspect a stored blob", { cause: error });
    }
  }

  /** Copy a blob to a destination path, always verifying its digest. */
  async writeTo(ref: BlobRef, destination: string): Promise<void> {
    const source = await this.#openVerified(ref);
    if (source === undefined) {
      throw new LibraryStoreError("the stored blob is missing or unusable");
    }
    try {
      const target = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, FILE_MODE);
      try {
        const hash = createHash("sha256");
        const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
        let offset = 0;
        for (;;) {
          const { bytesRead } = await source.read(buffer, 0, CHUNK_BYTES, offset);
          if (bytesRead === 0) break;
          const chunk = Uint8Array.prototype.slice.call(buffer, 0, bytesRead);
          hash.update(chunk);
          await target.write(chunk);
          offset += bytesRead;
        }
        if (hash.digest("hex") !== ref.sha256) {
          throw new LibraryStoreError("a stored blob failed digest verification while being exported");
        }
        await target.sync();
      } finally {
        await target.close();
      }
    } finally {
      await source.close();
    }
  }
}
