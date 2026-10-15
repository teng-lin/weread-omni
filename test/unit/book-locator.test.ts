import { describe, expect, it } from "vitest";
import { locateInChapterHtml } from "../../src/api/book-locator.js";
import { decodeChapterParts, encodeReaderId } from "../../src/api/web-reader.js";

describe("章节原文坐标", () => {
  it("保留跨标签、实体、中文和 UTF-16 的原始范围", () => {
    const html =
      "<html><head><title>bright idea</title></head><body><p>中文😀 A &amp; B <em>bright</em> idea</p></body></html>";
    for (const [quote, raw] of [
      ["中文😀", "中文😀"],
      ["A & B", "A &amp; B"],
      ["bright idea", "bright</em> idea"],
    ]) {
      const match = locateInChapterHtml(html, quote ?? "")[0];
      const start = html.indexOf(raw ?? "");
      expect(match).toMatchObject({ markText: quote, range: `${start}-${start + (raw?.length ?? 0)}` });
    }
  });

  it("实体和格式空白不改变后续字符的真实坐标", () => {
    const html = "<body><p>A&#x1f600; B\n  bright\t idea!</p></body>";
    expect(locateInChapterHtml(html, "😀 B")[0]?.range).toBe(`${html.indexOf("&#x")}-${html.indexOf(" B") + 2}`);
    expect(locateInChapterHtml(html, "bright idea")[0]?.range).toBe(`${html.indexOf("bright")}-${html.indexOf("!")}`);
  });

  it("返回所有重复命中，排除元数据、脚本、隐藏文字和跨段误拼接", () => {
    const html =
      '<html><head><title>target</title></head><body><p>target</p><p>target</p><script>target</script><p hidden>target</p><p style="display:none">target</p><p>not</p><p>joined</p></body></html>';
    expect(locateInChapterHtml(html, "target")).toHaveLength(2);
    expect(locateInChapterHtml(html, "notjoined")).toEqual([]);
    expect(locateInChapterHtml(html, "not joined")).toEqual([]);
    expect(locateInChapterHtml(html, "absent")).toEqual([]);
    expect(() => locateInChapterHtml(html, " ")).toThrow("keyword");
  });

  it("拒绝损坏正文，采用已验证的章节 ID 编码", () => {
    expect(encodeReaderId(15)).toBe("9bf32f301f9bf31c7ff0a60");
    expect(() => decodeChapterParts(["broken"])).toThrow("checksum");
  });
});
