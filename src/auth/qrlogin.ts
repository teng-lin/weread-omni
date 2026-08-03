import { createHash, randomInt } from "node:crypto";
import {
  MAX_JSON_RESPONSE_BYTES,
  ResponseBodyReadError,
  ResponseBodyTooLargeError,
  readJsonResponse,
} from "../api/response-body.js";
import { requestSignal } from "../api/signal.js";
import { AuthError, TransportError, toTransportError } from "../errors.js";
import { type ClientProfile, resolveProfile } from "../profile.js";
import type { Credentials } from "./credentials.js";

const WEREAD = "https://i.weread.qq.com";
const WX_APPID = "wxab9b71ad2b90ff34";
const SCOPE = "snsapi_userinfo,snsapi_timeline,snsapi_friend";

export interface QrRequest {
  uuid: string;
  confirmUrl: string;
}

export interface AuthRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  profile?: ClientProfile;
}

async function fetchJsonWithTimeout<T>(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  label: string,
): Promise<{ response: Response; body: T }> {
  const request = requestSignal(signal, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(input, { ...init, redirect: "error", signal: request.signal });
    } catch (error) {
      throw toTransportError(error, label);
    }
    try {
      return { response, body: (await readJsonResponse(response)) as T };
    } catch (error) {
      if (error instanceof ResponseBodyTooLargeError) {
        throw new AuthError(`${label}: response exceeds ${MAX_JSON_RESPONSE_BYTES} bytes`);
      }
      if (error instanceof ResponseBodyReadError) {
        throw toTransportError(error.cause, label);
      }
      if (error instanceof SyntaxError || (error as { name?: string } | null)?.name === "SyntaxError") {
        throw new AuthError(`${label} returned a non-JSON response`, { cause: error });
      }
      throw toTransportError(error, label);
    }
  } finally {
    request.dispose();
  }
}

export async function requestQr(fetchImpl: typeof fetch = fetch, options: AuthRequestOptions = {}): Promise<QrRequest> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const profile = resolveProfile(options);
  const { response: ticketResponse, body: ticket } = await fetchJsonWithTimeout<{
    signature?: unknown;
    timeStamp?: unknown;
  }>(
    fetchImpl,
    `${WEREAD}/wxticket?nonceStr=weread`,
    { headers: profile.versionHeaders },
    options.signal,
    timeoutMs,
    "WeRead QR ticket",
  );
  if (!ticketResponse.ok || typeof ticket.signature !== "string" || ticket.timeStamp === undefined) {
    throw new AuthError("WeRead QR ticket request failed");
  }

  const url = new URL("https://open.weixin.qq.com/connect/sdk/qrconnect");
  url.search = new URLSearchParams({
    appid: WX_APPID,
    noncestr: "weread",
    timestamp: String(ticket.timeStamp),
    scope: SCOPE,
    signature: ticket.signature,
  }).toString();
  const { response: qrResponse, body: qr } = await fetchJsonWithTimeout<{
    errcode?: unknown;
    uuid?: unknown;
  }>(
    fetchImpl,
    url,
    { headers: { "User-Agent": profile.versionHeaders["User-Agent"] ?? "" } },
    options.signal,
    timeoutMs,
    "WeChat qrconnect",
  );
  if (!qrResponse.ok || qr.errcode !== 0 || typeof qr.uuid !== "string" || qr.uuid.length === 0) {
    throw new AuthError(`WeChat qrconnect failed: ${String(qr.errcode ?? qrResponse.status)}`);
  }
  return {
    uuid: qr.uuid,
    confirmUrl: `https://open.weixin.qq.com/connect/confirm?uuid=${encodeURIComponent(qr.uuid)}`,
  };
}

export type LoginStatus = "scanned" | "confirmed";

export interface PollOptions extends AuthRequestOptions {
  pollTimeoutMs?: number;
  deadlineMs?: number;
  pollDelayMs?: number;
  onStatus?: (status: LoginStatus) => void | Promise<void>;
}

function abortableDelay(ms: number, signal: AbortSignal | undefined, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(toTransportError(signal.reason, label));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(toTransportError(signal?.reason, label));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollForCode(
  uuid: string,
  fetchImpl: typeof fetch = fetch,
  options: PollOptions = {},
): Promise<string> {
  const pollTimeoutMs = options.pollTimeoutMs ?? 65_000;
  const pollDelayMs = options.pollDelayMs ?? 1_000;
  const deadline = Date.now() + (options.deadlineMs ?? 5 * 60_000);
  let last: number | undefined;
  for (;;) {
    if (options.signal?.aborted) {
      throw toTransportError(options.signal.reason, "WeChat QR poll");
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new AuthError("WeRead QR login timed out — rerun login");
    }

    const url = new URL("https://long.open.weixin.qq.com/connect/l/qrconnect");
    url.searchParams.set("f", "json");
    url.searchParams.set("uuid", uuid);
    if (last !== undefined) url.searchParams.set("last", String(last));

    let response: Response;
    let result: { wx_errcode?: unknown; wx_code?: unknown };
    try {
      ({ response, body: result } = await fetchJsonWithTimeout<{
        wx_errcode?: unknown;
        wx_code?: unknown;
      }>(
        fetchImpl,
        url,
        { headers: { "User-Agent": "Mozilla/5.0" } },
        options.signal,
        Math.min(pollTimeoutMs, remaining),
        "WeChat QR poll",
      ));
    } catch (error) {
      if (error instanceof TransportError && !options.signal?.aborted && Date.now() >= deadline) {
        throw new AuthError("WeRead QR login timed out — rerun login");
      }
      throw error;
    }
    if (!response.ok) throw new AuthError(`WeChat QR poll failed: HTTP ${response.status}`);

    const code = Number(result.wx_errcode);
    if (code === 405) {
      if (typeof result.wx_code !== "string" || result.wx_code.length === 0) {
        throw new AuthError("WeChat QR confirmation omitted wx_code");
      }
      await options.onStatus?.("confirmed");
      return result.wx_code;
    }
    if (code === 404) {
      await options.onStatus?.("scanned");
    } else if (code === 402) {
      throw new AuthError("QR expired — rerun login");
    } else if (code === 403) {
      throw new AuthError("QR login declined in WeChat — rerun login");
    } else if (code === 408) {
      const backoff = Math.min(pollDelayMs, deadline - Date.now());
      if (backoff > 0) await abortableDelay(backoff, options.signal, "WeChat QR poll");
    } else {
      throw new AuthError(`WeChat QR poll returned unknown status: ${String(code)}`);
    }
    last = code;
  }
}

function requireIdentityValue(value: unknown, field: string): string {
  if (typeof value === "string") {
    if (value.length === 0) throw new AuthError(`WeRead QR login returned an empty ${field}`);
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  throw new AuthError(`WeRead QR login returned a non-scalar ${field}`);
}

export async function exchange(
  wxCode: string,
  deviceId: string,
  fetchImpl: typeof fetch = fetch,
  options: AuthRequestOptions = {},
): Promise<Credentials> {
  const profile = resolveProfile(options);
  const timestamp = Date.now();
  const random = randomInt(1000);
  const body = {
    appFirstInstall: 1,
    code: wxCode,
    deviceId,
    deviceName: profile.deviceName,
    installId: profile.newInstallId(),
    isAutoLogout: 0,
    isFromQrcode: 1,
    random,
    signature: createHash("sha256").update(`${timestamp}${deviceId}${random}`).digest("hex"),
    timestamp,
    trackId: "",
    ...profile.loginBodyExtras(),
    deviceType: profile.deviceType,
  };
  const { response, body: result } = await fetchJsonWithTimeout<{
    vid?: unknown;
    accessToken?: unknown;
    refreshToken?: unknown;
    errCode?: unknown;
    errMsg?: unknown;
  }>(
    fetchImpl,
    `${WEREAD}/login`,
    {
      method: "POST",
      headers: {
        ...profile.versionHeaders,
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(body),
    },
    options.signal,
    options.timeoutMs ?? 30_000,
    "WeRead QR login",
  );
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new AuthError("WeRead QR login returned an unusable response body");
  }
  if (
    !response.ok ||
    typeof result.accessToken !== "string" ||
    result.accessToken.length === 0 ||
    typeof result.refreshToken !== "string" ||
    result.refreshToken.length === 0
  ) {
    throw new AuthError(
      `WeRead QR login failed: ${String(result.errCode ?? response.status)} ${String(result.errMsg ?? "")}`.trim(),
    );
  }
  return {
    vid: requireIdentityValue(result.vid, "vid"),
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    deviceId,
  };
}

export interface LoginOptions extends PollOptions {
  deviceId?: string;
  fetchImpl?: typeof fetch;
  onQr?: (confirmUrl: string) => void | Promise<void>;
}

export async function login(options: LoginOptions = {}): Promise<Credentials> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const profile = resolveProfile(options);
  const authOptions = { ...options, profile };
  const deviceId = options.deviceId ?? profile.newDeviceId();
  const qr = await requestQr(fetchImpl, authOptions);
  await options.onQr?.(qr.confirmUrl);
  const wxCode = await pollForCode(qr.uuid, fetchImpl, authOptions);
  return exchange(wxCode, deviceId, fetchImpl, authOptions);
}
