export const MAX_JSON_RESPONSE_BYTES = 16 * 1024 * 1024;

export class ResponseBodyTooLargeError extends Error {}

export class ResponseBodyReadError extends Error {
  constructor(cause: unknown) {
    super("response body read failed", { cause });
  }
}

function cancelWithoutWaiting(source: { cancel(): Promise<unknown> }): void {
  try {
    void source.cancel().catch(() => undefined);
  } catch {
    // Cleanup must not delay or replace the response-size error.
  }
}

export async function readResponseBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && BigInt(declared) > BigInt(maxBytes)) {
    if (response.body) cancelWithoutWaiting(response.body);
    throw new ResponseBodyTooLargeError();
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = response.body?.getReader();
  } catch (cause) {
    throw new ResponseBodyReadError(cause);
  }
  if (!reader) return new Uint8Array();

  let bytes = new Uint8Array();
  let total = 0;
  let releaseError: ResponseBodyReadError | undefined;
  try {
    while (true) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch (cause) {
        throw new ResponseBodyReadError(cause);
      }
      if (next.done) break;
      if (next.value.byteLength > maxBytes - total) {
        cancelWithoutWaiting(reader);
        throw new ResponseBodyTooLargeError();
      }
      const required = total + next.value.byteLength;
      if (required > bytes.byteLength) {
        const doubled = bytes.byteLength <= Math.floor(maxBytes / 2) ? bytes.byteLength * 2 : maxBytes;
        const grown = new Uint8Array(Math.max(required, doubled));
        grown.set(bytes.subarray(0, total));
        bytes = grown;
      }
      bytes.set(next.value, total);
      total = required;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch (cause) {
      releaseError = new ResponseBodyReadError(cause);
    }
  }
  if (releaseError) throw releaseError;

  return bytes.byteLength === total ? bytes : bytes.slice(0, total);
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  const bytes = await readResponseBody(response, MAX_JSON_RESPONSE_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
