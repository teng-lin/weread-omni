import { existsSync, statSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CosClient, type CosConstructor, cosUpload } from "../../src/api/cos-upload.js";

class FakeCos implements CosClient {
  static authorization: Record<string, unknown>;
  static constructed: number;
  static method: string;
  static options: Record<string, unknown>;
  static pending: boolean;
  static deferTaskReady: boolean;
  static taskRegistered: boolean;
  static cancelledTaskIds: string[];
  static timeout: number;
  static temporaryMode: number;

  constructor(options: {
    getAuthorization: (value: unknown, callback: (authorization: Record<string, unknown>) => void) => void;
    Domain: string;
    Timeout: number;
  }) {
    FakeCos.constructed += 1;
    FakeCos.timeout = options.Timeout;
    options.getAuthorization({}, (authorization) => {
      FakeCos.authorization = authorization;
    });
    expect(options.Domain).toBe("bucket.cos.accelerate.myqcloud.com");
  }

  putObject(options: Record<string, unknown>): Promise<unknown> {
    FakeCos.method = "putObject";
    FakeCos.options = options;
    if (!FakeCos.deferTaskReady) {
      (options.onTaskReady as ((taskId: string) => void) | undefined)?.("put-task");
      FakeCos.taskRegistered = true;
      (options.onTaskStart as (() => void) | undefined)?.();
    }
    return FakeCos.pending ? new Promise(() => undefined) : Promise.resolve({});
  }

  sliceUploadFile(options: Record<string, unknown>): Promise<unknown> {
    FakeCos.method = "sliceUploadFile";
    FakeCos.options = options;
    FakeCos.temporaryMode = statSync(options.FilePath as string).mode & 0o777;
    if (!FakeCos.deferTaskReady) {
      (options.onTaskReady as ((taskId: string) => void) | undefined)?.("slice-task");
      FakeCos.taskRegistered = true;
      (options.onTaskStart as (() => void) | undefined)?.();
    }
    return FakeCos.pending ? new Promise(() => undefined) : Promise.resolve({});
  }

  cancelTask(taskId: string): void {
    if (FakeCos.taskRegistered) FakeCos.cancelledTaskIds.push(taskId);
  }
}

const base = {
  bucket: "bucket",
  key: "object",
  credentials: { TmpSecretId: "id", TmpSecretKey: "key", Token: "token" },
  expiredTime: 123,
  cosConstructor: FakeCos as CosConstructor,
};

describe("cosUpload", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    FakeCos.constructed = 0;
    FakeCos.method = "";
    FakeCos.options = {};
    FakeCos.pending = false;
    FakeCos.deferTaskReady = false;
    FakeCos.taskRegistered = false;
    FakeCos.cancelledTaskIds = [];
  });

  it("uses an in-memory upload for small files", async () => {
    await cosUpload({ ...base, bytes: Buffer.from("book") });
    expect(FakeCos.method).toBe("putObject");
    expect(FakeCos.options).toMatchObject({
      Bucket: "bucket",
      Region: "ap-shanghai",
      Key: "object",
      Body: Buffer.from("book"),
    });
    expect(FakeCos.authorization).toMatchObject({
      TmpSecretId: "id",
      TmpSecretKey: "key",
      SecurityToken: "token",
      ExpiredTime: 123,
    });
    expect(FakeCos.timeout).toBe(30_000);
  });

  it("uses a mode-0600 temporary file for multipart upload and removes it", async () => {
    await cosUpload({ ...base, bytes: Buffer.alloc(8 * 1024 * 1024 + 1) });
    const temporaryPath = FakeCos.options.FilePath;
    expect(FakeCos.method).toBe("sliceUploadFile");
    expect(FakeCos.options).toMatchObject({ Bucket: "bucket", Region: "ap-shanghai", Key: "object" });
    expect(typeof temporaryPath).toBe("string");
    if (process.platform !== "win32") expect(FakeCos.temporaryMode).toBe(0o600);
    expect(existsSync(temporaryPath as string)).toBe(false);
  });

  it("removes a partial temporary file when writing fails", async () => {
    const { promises: fs } = await import("node:fs");
    const rm = vi.spyOn(fs, "rm");
    const writeFile = vi.spyOn(fs, "writeFile").mockRejectedValueOnce(new Error("disk full"));
    await expect(cosUpload({ ...base, bytes: Buffer.alloc(8 * 1024 * 1024 + 1) })).rejects.toThrow("disk full");
    expect(rm).toHaveBeenCalledWith(expect.stringContaining("weread-"), { force: true });
    writeFile.mockRestore();
    rm.mockRestore();
  });

  it("rejects an already-aborted upload before constructing the client", async () => {
    const caller = new AbortController();
    caller.abort(new DOMException("caller gone", "AbortError"));

    await expect(cosUpload({ ...base, bytes: Buffer.from("book"), signal: caller.signal })).rejects.toMatchObject({
      name: "TransportError",
      cause: caller.signal.reason,
    });
    expect(FakeCos.constructed).toBe(0);
  });

  it("cancels an in-flight multipart task and removes its temporary file", async () => {
    FakeCos.pending = true;
    const caller = new AbortController();
    const upload = cosUpload({ ...base, bytes: Buffer.alloc(8 * 1024 * 1024 + 1), signal: caller.signal });
    await vi.waitFor(() => expect(FakeCos.method).toBe("sliceUploadFile"));
    const temporaryPath = FakeCos.options.FilePath as string;

    caller.abort(new DOMException("caller gone", "AbortError"));

    await expect(upload).rejects.toMatchObject({ name: "TransportError", cause: caller.signal.reason });
    expect(FakeCos.cancelledTaskIds).toEqual(["slice-task"]);
    expect(existsSync(temporaryPath)).toBe(false);
  });

  it.each(["before", "after"] as const)(
    "cancels a small putObject task when abort lands %s task readiness",
    async (timing) => {
      FakeCos.pending = true;
      FakeCos.deferTaskReady = true;
      const caller = new AbortController();
      const upload = cosUpload({ ...base, bytes: Buffer.from("book"), signal: caller.signal });
      expect(FakeCos.method).toBe("putObject");
      const taskReady = FakeCos.options.onTaskReady as (taskId: string) => void;

      if (timing === "after") taskReady("late-task");
      caller.abort(new DOMException("caller gone", "AbortError"));
      await expect(upload).rejects.toMatchObject({ name: "TransportError", cause: caller.signal.reason });
      if (timing === "before") taskReady("late-task");
      await Promise.resolve();
      expect(FakeCos.cancelledTaskIds).toEqual([]);
      FakeCos.taskRegistered = true;
      (FakeCos.options.onTaskStart as () => void)();
      await Promise.resolve();
      expect(FakeCos.cancelledTaskIds).toEqual(["late-task"]);
    },
  );

  it.each(["0", "-1", "1.5", "later"])("rejects invalid timeout %s before constructing the client", async (value) => {
    vi.stubEnv("WEREAD_STORAGE_TIMEOUT_MS", value);
    await expect(cosUpload({ ...base, bytes: Buffer.from("book") })).rejects.toThrow("positive integer");
    expect(FakeCos.constructed).toBe(0);
  });
});
