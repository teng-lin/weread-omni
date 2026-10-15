import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli.js";
import { MobileApiClient } from "../../src/index.js";

const html =
  "<html><head><title>target</title></head><body><p>A &amp; B; <em>bright</em> idea; target, target.</p></body></html>";

// 用协议的正向交换构造模拟响应；真实 R07 的五个范围另作只读验收。
function encodedParts(text: string): string[] {
  const value = Buffer.from(text).toString("base64");
  const size = value.length;
  let seed = "";
  const count = Math.min(4, Math.ceil(size / 10));
  for (let index = size - 1; index >= size - count; index--)
    seed += Number.parseInt(value.charCodeAt(index).toString(2), 4);
  const modulus = size - count - 2;
  const width = String(modulus).length;
  const pairs: number[] = [];
  for (let index = 0; pairs.length < 10 && index + width < seed.length; index += width)
    pairs.push(
      Number.parseInt(seed.slice(index, index + width), 10) % modulus,
      Number.parseInt(seed.slice(index + 1, index + 1 + width), 10) % modulus,
    );
  const chars = value.split("");
  for (let index = 0; index < pairs.length; index += 2)
    for (let shift = 0; shift <= 1; shift++) {
      const first = (pairs[index] ?? 0) + shift;
      const second = (pairs[index + 1] ?? 0) + shift;
      [chars[first], chars[second]] = [chars[second] ?? "", chars[first] ?? ""];
    }
  const encoded = `n${chars.join("")}`;
  const split = Math.floor(encoded.length / 3);
  return [encoded.slice(0, split), encoded.slice(split, 2 * split), encoded.slice(2 * split)].map(
    (part) => createHash("md5").update(part).digest("hex").toUpperCase() + part,
  );
}

function setup(responses: unknown[] = [], customHtml = html) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const parts = encodedParts(customHtml);
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/web/login/session/init")
      return Response.json({ success: 1 }, { headers: { "set-cookie": "wr_skey=fake; Path=/; HttpOnly" } });
    if (url.pathname.startsWith("/web/reader/")) return new Response('"psvts":"server-time"');
    if (url.pathname.startsWith("/web/book/chapter/e_"))
      return new Response(parts[{ e_0: 0, e_1: 1, e_3: 2 }[url.pathname.split("/").at(-1) as "e_0"]]);
    if (url.pathname === "/web/book/search_v2") return Response.json(responses.shift() ?? {});
    throw new Error(`unexpected path ${url.pathname}`);
  });
  const client = new MobileApiClient({
    credentials: { vid: "123", accessToken: "fake", refreshToken: "fake-refresh", deviceId: "fake-device" },
    fetchImpl,
    env: {},
  });
  return { client, calls, fetchImpl };
}

const row = (chapterUid: number, start: number) => ({
  chapterUid,
  chapterIdx: chapterUid,
  posBegin: start - 2,
  posEnd: start + 10,
  text: "a target!",
  matchWords: [{ posBegin: start, posEnd: start + 6, word: "target" }],
});

describe("无需浏览器的书内搜索", () => {
  it("自传 EPUB 经过会话初始化、正文校验后返回真实 HTML 范围", async () => {
    const { client, calls } = setup();
    const result = await client.book.search("CB_personal", "bright idea", { chapterUid: 15 });
    expect(result).toMatchObject({
      bookId: "CB_personal",
      chapterUid: 15,
      source: "reader-html",
      complete: true,
      matches: [{ range: `${html.indexOf("bright")}-${html.indexOf("; target")}`, markText: "bright idea" }],
    });
    expect(result.chapterSha256).toBe(createHash("sha256").update(html).digest("hex"));
    expect(calls).toHaveLength(5);
    expect(calls.every(({ url }) => url.origin === "https://weread.qq.com")).toBe(true);
    for (const { init } of calls.slice(1)) expect(new Headers(init?.headers).get("cookie")).toBe("wr_skey=fake");
    const payload = JSON.parse(String(calls[2]?.init?.body));
    expect(payload.pc).not.toBe(0);
    expect(payload.sc).toBe(0);
  });

  it("分页去重并在进入下一章后结束，保留服务端范围而非摘要下标", async () => {
    const { client, calls } = setup([
      { results: [row(15, 100)], scrollDownHasMore: 1 },
      { results: [row(15, 100), row(15, 200), row(16, 300)], scrollDownHasMore: 1 },
    ]);
    const result = await client.book.search("book", "target", { chapterUid: 15 });
    expect(result).toMatchObject({
      complete: true,
      source: "reader-search",
      matches: [{ range: "100-106" }, { range: "200-206" }],
    });
    expect(calls[2]?.url.searchParams.get("posEnd")).toBe("110");
  });

  it.each([
    { results: "bad", scrollDownHasMore: 0 },
    { results: [] },
    { results: [row(15, -1)], scrollDownHasMore: 0 },
  ])("拒绝无法信任的搜索响应 %j", async (response) => {
    const { client } = setup([response]);
    await expect(client.book.search("book", "target", { chapterUid: 15 })).rejects.toThrow("reader");
  });

  it("游标不前进时失败，不把不完整结果当作唯一命中", async () => {
    const response = { results: [row(15, 100)], scrollDownHasMore: 1 };
    const { client } = setup([response, response]);
    await expect(client.book.search("book", "target", { chapterUid: 15 })).rejects.toThrow("cursor");
  });

  it("无命中可明确返回空列表", async () => {
    const { client } = setup([{ scrollDownHasMore: 0 }]);
    expect(await client.book.search("book", "target", { chapterUid: 15 })).toMatchObject({
      complete: true,
      matches: [],
    });
  });

  it("达到分页上限时标记不完整，登录失效时不重试或换账户", async () => {
    const many = setup(
      Array.from({ length: 20 }, (_, index) => ({ results: [row(15, 100 + index * 20)], scrollDownHasMore: 1 })),
    );
    expect(await many.client.book.search("book", "target", { chapterUid: 15 })).toMatchObject({ complete: false });
    const expired = setup([{ errCode: -2012 }]);
    await expect(expired.client.book.search("book", "target", { chapterUid: 15 })).rejects.toThrow("session expired");
    expect(expired.calls).toHaveLength(2);
  });

  it("参数错误不发送请求，取消不执行后续请求", async () => {
    const { client, fetchImpl } = setup();
    expect(() => client.book.search("book", "", { chapterUid: 15 })).toThrow("keyword");
    expect(() => client.book.search("book", "target", { chapterUid: 0 })).toThrow("chapterUid");
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(
      client.book.search("book", "target", { chapterUid: 15, signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("CLI 在只读模式仍能定位；不调用划线或批注写接口", async () => {
    const { client, calls } = setup();
    let output = "";
    const stderr = { write: vi.fn() };
    const code = await runCli(
      ["node", "weread-omni", "book", "search", "CB_personal", "target", "--chapter-uid", "15", "--json"],
      {
        getClient: () => client,
        env: { WEREAD_READONLY: "1" },
        stdout: {
          write: (chunk) => {
            output += chunk;
          },
        },
        stderr,
        isTTY: false,
      },
    );
    expect(code).toBe(0);
    expect(stderr.write).not.toHaveBeenCalled();
    expect(JSON.parse(output).matches).toHaveLength(2);
    expect(calls.some(({ url }) => /review|Bookmark/.test(url.pathname))).toBe(false);
  });
});
