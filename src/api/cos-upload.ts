import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toTransportError } from "../errors.js";
import { storageTimeoutMs } from "../storage-timeout.js";
import { waitUnlessAborted } from "./signal.js";
import type { CosUploadInput } from "./types.js";

const SLICE_THRESHOLD = 8 * 1024 * 1024;
const UPLOAD_LABEL = "COS upload";

type CosMethod = (options: Record<string, unknown>) => Promise<unknown>;

export interface CosClient {
  putObject: CosMethod;
  sliceUploadFile: CosMethod;
  cancelTask(taskId: string): void;
}

export type CosConstructor = new (options: {
  getAuthorization: (options: unknown, callback: (authorization: Record<string, unknown>) => void) => void;
  Domain: string;
  Timeout: number;
}) => CosClient;

export interface CosUploadOptions extends CosUploadInput {
  region?: string;
  cosConstructor?: CosConstructor;
}

async function uploadWithSignal(
  client: CosClient,
  method: "putObject" | "sliceUploadFile",
  uploadOptions: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await client[method](uploadOptions);
    return;
  }
  if (signal.aborted) throw toTransportError(signal.reason, UPLOAD_LABEL);

  let taskId: string | undefined;
  const cancelTask = () => {
    if (taskId !== undefined) client.cancelTask(taskId);
  };
  signal.addEventListener("abort", cancelTask, { once: true });
  try {
    await waitUnlessAborted(
      client[method]({
        ...uploadOptions,
        onTaskReady(id: string) {
          taskId = id;
          // The SDK announces the ID before registration; multipart upload may wait on fs.stat.
          if (signal.aborted) queueMicrotask(cancelTask);
        },
        onTaskStart() {
          // Retry after registration in case the SDK ignored the earlier cancellation.
          if (signal.aborted) queueMicrotask(cancelTask);
        },
      }),
      UPLOAD_LABEL,
      signal,
    );
  } finally {
    signal.removeEventListener("abort", cancelTask);
  }
}

export async function cosUpload(options: CosUploadOptions): Promise<void> {
  const { bucket, key, credentials, expiredTime, bytes, signal, region = "ap-shanghai", cosConstructor } = options;
  if (signal?.aborted) throw toTransportError(signal.reason, UPLOAD_LABEL);
  const Cos = cosConstructor ?? ((await import("cos-nodejs-sdk-v5")).default as unknown as CosConstructor);
  const client = new Cos({
    getAuthorization: (_authorizationOptions, callback) =>
      callback({
        TmpSecretId: credentials.TmpSecretId,
        TmpSecretKey: credentials.TmpSecretKey,
        SecurityToken: credentials.Token,
        StartTime: Math.floor(Date.now() / 1000),
        ExpiredTime: expiredTime,
      }),
    Domain: `${bucket}.cos.accelerate.myqcloud.com`,
    Timeout: storageTimeoutMs(),
  });

  if (bytes.length <= SLICE_THRESHOLD) {
    await uploadWithSignal(
      client,
      "putObject",
      {
        Bucket: bucket,
        Region: region,
        Key: key,
        Body: bytes,
      },
      signal,
    );
    return;
  }

  const temporaryPath = join(tmpdir(), `weread-${randomUUID()}`);
  try {
    await fs.writeFile(temporaryPath, bytes, { mode: 0o600, signal });
    await uploadWithSignal(
      client,
      "sliceUploadFile",
      {
        Bucket: bucket,
        Region: region,
        Key: key,
        FilePath: temporaryPath,
      },
      signal,
    );
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}
