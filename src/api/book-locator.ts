import { Parser } from "htmlparser2";
import type { BookTextMatch } from "./types.js";

const BLOCKS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "section", "article", "br", "hr"]);
const EXCLUDED = new Set(["head", "script", "style", "noscript", "template", "svg"]);
const whitespace = /\s/u;

/** 保留服务端 HTML 的 UTF-16 坐标；不能先清理 HTML 再用纯文本下标。 */
export function locateInChapterHtml(html: string, keyword: string): BookTextMatch[] {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  const skipped: boolean[] = [];
  let inBody = false;
  const boundary = () => {
    text += "\0";
    starts.push(-1);
    ends.push(-1);
  };
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === "body") inBody = true;
        skipped.push(
          Boolean(skipped.at(-1)) ||
            EXCLUDED.has(name) ||
            "hidden" in attributes ||
            /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes.style ?? ""),
        );
        if (BLOCKS.has(name)) boundary();
      },
      onclosetag(name) {
        if (name === "body") inBody = false;
        skipped.pop();
        if (BLOCKS.has(name)) boundary();
      },
      ontext(value) {
        if (!inBody || skipped.at(-1)) return;
        const start = parser.startIndex;
        const end = parser.endIndex + 1;
        const literal = end - start === value.length && html.slice(start, end) === value;
        for (let index = 0; index < value.length; index++) {
          const char = whitespace.test(value[index] ?? "") ? " " : value[index];
          const from = literal ? start + index : start;
          const to = literal ? from + 1 : end;
          if (char === " " && text.endsWith(" ")) {
            ends[ends.length - 1] = to;
          } else {
            text += char;
            starts.push(from);
            ends.push(to);
          }
        }
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  const needle = keyword.replace(/\s+/gu, " ").trim();
  if (!needle || needle.includes("\0")) throw new TypeError("keyword must contain searchable text");
  const matches: BookTextMatch[] = [];
  for (let offset = text.indexOf(needle); offset !== -1; offset = text.indexOf(needle, offset + 1)) {
    const start = starts[offset];
    const end = ends[offset + needle.length - 1];
    if (start === undefined || end === undefined || start < 0 || end <= start) continue;
    // 实体可能解码成多个码点，拒绝仅选中实体的一部分而伪造范围。
    if (starts[offset - 1] === start || ends[offset + needle.length] === end) continue;
    matches.push({
      range: `${start}-${end}`,
      start,
      end,
      markText: needle,
      context: text
        .slice(Math.max(0, offset - 70), offset + needle.length + 70)
        .replace(/\0/g, "\n")
        .trim(),
    });
  }
  return matches;
}
