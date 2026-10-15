import { createHash, randomInt } from "node:crypto";
import { AuthError, toTransportError, WeReadApiError } from "../errors.js";
import { locateInChapterHtml } from "./book-locator.js";
import type { TokenProvider } from "./mobile.js";
import { ResponseBodyTooLargeError, readResponseBody } from "./response-body.js";
import { requestSignal } from "./signal.js";
import type { BookSearchOptions, BookSearchResponse, BookTextMatch } from "./types.js";

const ORIGIN = "https://weread.qq.com";
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 20;
const md5 = (value: string) => createHash("md5").update(value).digest("hex");

/** 网页的 ID 编码属于协议字段，并不是原始书籍/章节 ID。 */
export function encodeReaderId(input: string | number): string {
  const value = String(input);
  const hash = md5(value);
  const numeric = /^\d+$/.test(value);
  const parts = numeric
    ? (value.match(/.{1,9}/g) ?? []).map((part) => Number(part).toString(16))
    : [
        Array.from(value)
          .map((char) => char.charCodeAt(0).toString(16))
          .join(""),
      ];
  let result = `${hash.slice(0, 3)}${numeric ? "3" : "4"}2${hash.slice(-2)}`;
  result += parts.map((part) => part.length.toString(16).padStart(2, "0") + part).join("g");
  if (result.length < 20) result += hash.slice(0, 20 - result.length);
  return result + md5(result).slice(0, 3);
}

export function readerChecksum(payload: Record<string, string | number>): string {
  const text = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(payload[key] ?? "")}`)
    .join("&");
  let left = 0x15051505;
  let right = left;
  for (let index = text.length - 1; index > 0; index -= 2) {
    left = 0x7fffffff & (left ^ (text.charCodeAt(index) << ((text.length - index) % 30)));
    right = 0x7fffffff & (right ^ (text.charCodeAt(index - 1) << (index % 30)));
  }
  return (left + right).toString(16);
}

function failure(path: string, message: string, status = 200): WeReadApiError {
  return new WeReadApiError(`reader ${path}: ${message}`, { path, status });
}

/** 仅处理服务端已授权返回的网页正文片段；不读取本地 EPUB 或浏览器状态。 */
export function decodeChapterParts(parts: string[]): string {
  const checked = parts
    .map((part) => {
      if (part.length <= 32 || part.slice(0, 32) !== md5(part.slice(32)).toUpperCase()) {
        throw failure("/web/book/chapter", "chapter checksum mismatch");
      }
      return part.slice(32);
    })
    .join("");
  const value = checked.slice(1);
  const length = value.length;
  const swaps: number[] = [];
  if (length >= 4 && length < 11) swaps.push(0, 2);
  else if (length >= 11) {
    const count = Math.min(4, Math.ceil(length / 10));
    let seed = "";
    for (let index = length - 1; index > length - 1 - count; index--)
      seed += Number.parseInt(value.charCodeAt(index).toString(2), 4);
    const modulus = length - count - 2;
    const width = String(modulus).length;
    for (let index = 0; swaps.length < 10 && index + width < seed.length; index += width) {
      swaps.push(Number.parseInt(seed.slice(index, index + width), 10) % modulus);
      swaps.push(Number.parseInt(seed.slice(index + 1, index + 1 + width), 10) % modulus);
    }
  }
  const chars = value.split("");
  for (let index = swaps.length - 1; index >= 1; index -= 2) {
    for (let shift = 1; shift >= 0; shift--) {
      const first = (swaps[index] ?? 0) + shift;
      const second = (swaps[index - 1] ?? 0) + shift;
      [chars[first], chars[second]] = [chars[second] ?? "", chars[first] ?? ""];
    }
  }
  const encoded = chars.join("");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
    throw failure("/web/book/chapter", "invalid chapter encoding");
  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(encoded, "base64"));
  } catch {
    throw failure("/web/book/chapter", "invalid chapter text");
  }
  if (!/<body(?:\s|>)/i.test(html) || html.length > MAX_BYTES)
    throw failure("/web/book/chapter", "missing or oversized EPUB body");
  return html;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 一个搜索调用拥有独立的内存 cookie，不持久化或导出网页会话。 */
export class WebReader {
  constructor(
    private readonly tokens: TokenProvider,
    private readonly fetchImpl: typeof fetch,
    private readonly timeoutMs: number,
  ) {}

  async search(bookId: string, keyword: string, options: BookSearchOptions): Promise<BookSearchResponse> {
    const combined = requestSignal(options.signal, this.timeoutMs);
    let cookie = "";
    const request = async (
      path: string,
      method: "GET" | "POST",
      payload?: Record<string, string | number | boolean>,
      raw = false,
    ): Promise<unknown> => {
      const url = new URL(path, ORIGIN);
      if (method === "GET" && payload)
        for (const [key, value] of Object.entries(payload)) url.searchParams.set(key, String(value));
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          redirect: "error",
          signal: combined.signal,
          headers: {
            "user-agent": "Mozilla/5.0",
            origin: ORIGIN,
            referer: `${ORIGIN}/`,
            accept: "application/json",
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
            ...(method === "POST" ? { "x-wrpa-0": "2097d7b063d6f8b5" } : {}),
          },
          ...(method === "POST" ? { body: JSON.stringify(payload ?? {}) } : {}),
        });
      } catch (error) {
        throw toTransportError(error, `reader ${path}`);
      }
      if (response.status === 401 || response.status === 403)
        throw new AuthError(`reader ${path}: authentication rejected`);
      if (!response.ok) throw failure(path, "request failed", response.status);
      let text: string;
      try {
        text = new TextDecoder().decode(await readResponseBody(response, MAX_BYTES));
      } catch (error) {
        if (error instanceof ResponseBodyTooLargeError) throw failure(path, "response is too large", response.status);
        throw toTransportError(error, `reader ${path}`);
      }
      if (raw) return text;
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw failure(path, "invalid JSON response", response.status);
      }
      const body = record(data);
      const code = body.errCode ?? body.errcode;
      if (code === -2010 || code === -2012 || code === -2013)
        throw new AuthError(`reader ${path}: session expired; run doctor/login`);
      if (code !== undefined && code !== 0) throw failure(path, `upstream error ${String(code)}`, response.status);
      if (path === "/web/login/session/init") {
        if (body.success !== 1) throw new AuthError("reader session initialization failed");
        const allowed = new Set(["wr_vid", "wr_skey", "wr_rt", "wr_pf", "wr_ql"]);
        cookie = response.headers
          .getSetCookie()
          .map((entry) => entry.split(";", 1)[0] ?? "")
          .filter((entry) => allowed.has(entry.split("=", 1)[0] ?? ""))
          .join("; ");
        if (!cookie.includes("wr_skey=")) throw new AuthError("reader session cookie missing");
      }
      return data;
    };
    try {
      const token = await this.tokens.get(false, combined.signal);
      await request("/web/login/session/init", "POST", {
        vid: token.vid,
        skey: token.accessToken,
        rt: token.refreshToken,
        pf: 2,
        ql: false,
      });
      const base = { bookId, chapterUid: options.chapterUid, keyword };
      if (bookId.startsWith("CB_")) {
        const book = encodeReaderId(bookId);
        const chapter = encodeReaderId(options.chapterUid);
        const page = String(await request(`/web/reader/${book}k${chapter}`, "GET", undefined, true));
        const encodedTimestamp = page.match(/"psvts":("[^"]*"|\d+)/)?.[1];
        const ps: unknown = encodedTimestamp ? JSON.parse(encodedTimestamp) : undefined;
        if (typeof ps !== "string" || !ps) throw failure("/web/reader", "reader timestamp missing");
        const pc = encodeReaderId(Math.floor(Date.now() / 1000));
        const parts: string[] = [];
        for (const index of [0, 1, 3]) {
          const payload: Record<string, string | number> = {
            b: book,
            c: chapter,
            r: randomInt(10000) ** 2,
            st: 0,
            ct: Math.floor(Date.now() / 1000),
            ps,
            pc,
            sc: 0,
          };
          payload.s = readerChecksum(payload);
          const path = `/web/book/chapter/e_${index}`;
          const part = String(await request(path, "POST", payload, true));
          if (part.startsWith("{")) {
            const data = record(JSON.parse(part));
            const code = data.errCode ?? data.errcode;
            if (code === -2010 || code === -2012 || code === -2013)
              throw new AuthError(`reader ${path}: session expired`);
            throw failure(path, `chapter unavailable${code === undefined ? "" : ` (${String(code)})`}`);
          }
          parts.push(part.startsWith('"') ? (JSON.parse(part) as string) : part);
        }
        const html = decodeChapterParts(parts);
        return {
          ...base,
          source: "reader-html",
          complete: true,
          chapterSha256: createHash("sha256").update(html).digest("hex"),
          matches: locateInChapterHtml(html, keyword),
        };
      }
      const matches = new Map<string, BookTextMatch>();
      const seen = new Set<string>();
      let posBegin = 0;
      let posEnd = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const path = "/web/book/search_v2";
        const data = record(await request(path, "GET", { ...base, posBegin, posEnd, mode: "scrollDown", count: 50 }));
        if (data.scrollDownHasMore !== 0 && data.scrollDownHasMore !== 1)
          throw failure(path, "pagination flag missing");
        if (data.results !== undefined && !Array.isArray(data.results)) throw failure(path, "invalid search results");
        const rows = (data.results ?? []) as unknown[];
        let reachedNextChapter = false;
        for (const item of rows) {
          const row = record(item);
          if (
            !Number.isSafeInteger(row.chapterUid) ||
            !Number.isSafeInteger(row.posBegin) ||
            !Number.isSafeInteger(row.posEnd) ||
            (row.chapterUid as number) < 1 ||
            (row.posBegin as number) < 0 ||
            (row.posEnd as number) <= (row.posBegin as number) ||
            typeof row.text !== "string" ||
            !Array.isArray(row.matchWords)
          )
            throw failure(path, "invalid search coordinates");
          if (row.chapterUid !== options.chapterUid) {
            reachedNextChapter = true;
            continue;
          }
          for (const item of row.matchWords) {
            const word = record(item);
            const start = word.posBegin;
            const end = word.posEnd;
            if (
              !Number.isSafeInteger(start) ||
              !Number.isSafeInteger(end) ||
              typeof word.word !== "string" ||
              (start as number) < (row.posBegin as number) ||
              (end as number) <= (start as number) ||
              (end as number) > (row.posEnd as number)
            )
              throw failure(path, "invalid match coordinates");
            if (word.word !== keyword) continue;
            const range = `${start}-${end}`;
            matches.set(range, {
              range,
              start: start as number,
              end: end as number,
              markText: word.word,
              context: row.text,
            });
          }
        }
        if (data.scrollDownHasMore === 0 || reachedNextChapter)
          return { ...base, source: "reader-search", complete: true, matches: [...matches.values()] };
        const last = record(rows.at(-1));
        const cursor = `${last.chapterUid}:${last.posBegin}:${last.posEnd}`;
        if (rows.length === 0 || seen.has(cursor)) throw failure(path, "search cursor did not advance");
        seen.add(cursor);
        posBegin = last.posBegin as number;
        posEnd = last.posEnd as number;
      }
      return { ...base, source: "reader-search", complete: false, matches: [...matches.values()] };
    } finally {
      cookie = "";
      combined.dispose();
    }
  }
}
