/**
 * Redaction of secret-bearing text.
 *
 * A single-pass scanner rather than a stack of regexes. A ~400,000-input randomized audit showed
 * the regex cascade could not converge: recovering a value's boundary needs quote and escape state
 * that a lexical pattern does not carry, and every widening that reached one leak corrupted
 * ordinary content elsewhere ("Basic Econometrics", "const password = prompt()"). This tracks the
 * state instead of guessing at it.
 *
 * Understood: both quote styles with backslash escapes, one level of JSON-in-a-string escaping
 * (a secret nested inside an escaped JSON payload), truncated values, keys written in encoded form
 * (\u0077, %77), and the delimiter the surrounding syntax implies — & in a query, ; in a cookie,
 * , } ] inside JSON, and end of line for a .env or YAML entry that owns its line.
 *
 * Still an allowlist of key names, so this remains defence in depth rather than a guarantee. Two
 * limits are known and accepted, both because the alternative is worse:
 *   - `const password = prompt();` in source text is redacted; those bytes are indistinguishable
 *     from a config line leaking one.
 *   - a bare `Basic YWFhYTphYWFh` in free text is not, because a short all-letter credential is
 *     indistinguishable from a title like "Basic Econometrics". Inside an explicit
 *     `Authorization:` header it IS redacted, whatever it looks like.
 */

/**
 * Key names whose value is a secret. An allowlist: entropy heuristics corrupt ids and hashes.
 *
 * Some names outlive the feature that produced them -- web cookies, API keys, MCP and S3
 * credentials. They stay deliberately: this list decides what a log line is allowed to reveal, so a
 * plugin, an old config, or a pasted diagnostic can still put such a value in front of it. Removing
 * a name only ever makes redaction weaker.
 */
const SECRET_KEYS = new Set([
  "mcp_upload_signing_key",
  "mcp_bearer_token",
  "mcp_oauth_password",
  "weread_access_token",
  "weread_refresh_token",
  "weread_device_id",
  "weread_web_cookie",
  "weread_api_key",
  "weread_api_keys",
  "s3_secret_key",
  "s3_access_key",
  "secretaccesskey",
  "accesskeyid",
  "tmpsecretkey",
  "securitytoken",
  "signingkey",
  "secretkey",
  "accesskey",
  "refreshtoken",
  "accesstoken",
  "deviceid",
  "refresh_token",
  "access_token",
  "client_secret",
  "code_verifier",
  "authorization",
  "password",
  "passwd",
  "api_key",
  "apikey",
  "wr_skey",
  "wr_rt",
  "skey",
]);

/**
 * `Token` is a real COS credential field on this product's wire, but also an ordinary word
 * ("Token: A Novel"). Accept it only where a machine wrote it — a quoted key, or `Token=`.
 */
const QUOTED_ONLY_KEYS = new Set(["token"]);

const PLACEHOLDER = "[REDACTED]";
const isKeyChar = (character: string): boolean => /[A-Za-z0-9_]/.test(character);
const isSpace = (character: string): boolean => character === " " || character === "\t";

/** Decodes `\uXXXX` and `%XX` so an encoded key cannot slip past the allowlist. */
const decodeKey = (raw: string): string =>
  raw
    .replace(/\\u([0-9a-f]{4})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));

/** A quote token: `"`, `'`, or their one-level-escaped forms inside a JSON string. */
function quoteAt(text: string, index: number): { quote: string; length: number } | undefined {
  if (text.startsWith('\\"', index)) return { quote: '\\"', length: 2 };
  if (text.startsWith("\\'", index)) return { quote: "\\'", length: 2 };
  const character = text[index];
  if (character === '"' || character === "'") return { quote: character, length: 1 };
  return undefined;
}

interface KeyMatch {
  name: string;
  end: number;
  quoted: boolean;
}

/** Reads a possibly quoted, possibly percent/unicode-encoded key name starting at `index`. */
function readKey(text: string, index: number): KeyMatch | undefined {
  let cursor = index;
  const open = quoteAt(text, cursor);
  if (open) cursor += open.length;
  const start = cursor;
  // Real key names are short. Without a cap, a message of repeated \uXXXX or %XX fragments makes
  // every start position re-consume the whole encoded suffix — quadratic, 50s on 131KB.
  let decoded = 0;
  while (cursor < text.length && decoded < 64) {
    if (text.startsWith("\\u", cursor) && /^[0-9a-f]{4}$/i.test(text.slice(cursor + 2, cursor + 6))) {
      cursor += 6;
      decoded += 1;
      continue;
    }
    if (text[cursor] === "%" && /^[0-9a-f]{2}$/i.test(text.slice(cursor + 1, cursor + 3))) {
      cursor += 3;
      decoded += 1;
      continue;
    }
    if (isKeyChar(text[cursor] as string)) {
      cursor += 1;
      decoded += 1;
      continue;
    }
    break;
  }
  if (cursor === start) return undefined;
  const name = decodeKey(text.slice(start, cursor)).toLowerCase();
  if (open) {
    const close = quoteAt(text, cursor);
    if (!close || close.quote !== open.quote) return undefined;
    cursor += close.length;
  }
  return { name, end: cursor, quoted: Boolean(open) };
}

const isSecretKey = (match: KeyMatch, separator: string): boolean =>
  SECRET_KEYS.has(match.name) || (QUOTED_ONLY_KEYS.has(match.name) && (match.quoted || separator === "="));

/**
 * Returns where a value ends. Quoted values run to their closing quote, or to end of line when the
 * text was truncated before it. Unquoted values run to the delimiter the surrounding syntax
 * implies, so a query string keeps its later parameters and a YAML value keeps its spaces.
 */
function readValueEnd(
  text: string,
  index: number,
  braceDepth: number,
  ownsLine: boolean,
  delimitersAreData = false,
): number {
  const open = quoteAt(text, index);
  if (open) {
    let cursor = index + open.length;
    let lineEnd = -1;
    while (cursor < text.length) {
      const character = text[cursor] as string;
      // A raw newline inside a quoted value is not legal JSON, but this is error text, not a
      // document. Remember where the line ended and keep looking for the real closing quote;
      // only fall back to the line if the value turns out to be truncated.
      if ((character === "\n" || character === "\r") && lineEnd === -1) {
        lineEnd = cursor;
        if (NEXT_LINE_IS_A_KEY.test(text.slice(cursor, cursor + 96))) return cursor;
      }
      // `\\` is an escaped backslash, not the start of a closing `\"`. Consume the pair first or
      // an embedded escaped quote ends the value early and the rest of the secret survives.
      if (open.length === 2 && text.startsWith("\\\\\\\\", cursor)) {
        cursor += 4;
        continue;
      }
      if (open.length === 2 && text.startsWith('\\\\\\"', cursor)) {
        cursor += 4;
        continue;
      }
      if (character === "\\" && text[cursor + 1] === "\\") {
        cursor += 2;
        continue;
      }
      if (character === "\\" && open.length === 1 && cursor + 1 < text.length) {
        cursor += 2;
        continue;
      }
      const close = quoteAt(text, cursor);
      if (close && close.quote === open.quote) return cursor + close.length;
      cursor += 1;
    }
    return lineEnd === -1 ? text.length : lineEnd;
  }
  if (text[index] === "{" || text[index] === "[")
    return readCompositeEnd(
      text,
      index,
      text.startsWith('\\"', index + 1) || /\\"/.test(text.slice(index, index + 12)),
    );
  // A YAML block scalar: the value is the indented block that follows, not the marker.
  const block = /^[|>](?:[+-][0-9]*|[0-9]*[+-]?)[ \t]*(\r?\n)/.exec(text.slice(index, index + 8));
  if (block) return readBlockScalarEnd(text, index + (block[0] as string).length);
  let cursor = index;
  while (cursor < text.length) {
    const character = text[cursor] as string;
    if (character === "\n" || character === "\r" || ((character === "&" || character === ";") && !delimitersAreData))
      break;
    if (braceDepth > 0 && (character === "," || character === "}" || character === "]")) break;
    if (character === '"' || character === "'") break;
    // Only a key that opens its own line (a .env or YAML entry) owns the spaces in its value.
    // Anywhere else — prose, JSON, a brace block — whitespace ends it, or the redaction eats
    // the words that follow.
    if (!ownsLine && isSpace(character)) break;
    cursor += 1;
  }
  return cursor;
}

/** A line that starts a new `key:`/`key=` entry, used to detect a truncated quoted value. */
const NEXT_LINE_IS_A_KEY = /^[\r\n]+[ \t]*(?:-[ \t]+|export[ \t]+)?[A-Za-z_][A-Za-z0-9_.-]*[ \t]*[:=]/;

/** Consumes a balanced `{...}` or `[...]` value, ignoring delimiters inside strings. */
function readCompositeEnd(text: string, index: number, escapedJson: boolean): number {
  const openChar = text[index];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let cursor = index;
  let quote = "";
  while (cursor < text.length) {
    const character = text[cursor] as string;
    // Inside a one-level escaped payload the string delimiters are `\"`, not `"`. Treating them
    // as raw quotes left the balancer stuck in quote state and it ran to the end of the message,
    // dropping every field after the secret.
    const token = escapedJson ? quoteAt(text, cursor) : undefined;
    if (quote) {
      if (escapedJson && token && token.quote === quote) {
        cursor += token.length;
        quote = "";
        continue;
      }
      if (character === "\\" && !escapedJson) cursor += 1;
      else if (!escapedJson && character === quote) quote = "";
    } else if (escapedJson && token) {
      quote = token.quote;
      cursor += token.length;
      continue;
    } else if (!escapedJson && (character === '"' || character === "'")) quote = character;
    else if (character === openChar) depth += 1;
    else if (character === closeChar) {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
    cursor += 1;
  }
  return text.length;
}

/** Consumes the indented body of a YAML block scalar. */
function readBlockScalarEnd(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length) {
    const lineEnd = text.indexOf("\n", cursor);
    const stop = lineEnd === -1 ? text.length : lineEnd;
    const line = text.slice(cursor, stop);
    if (line.trim() !== "" && !/^[ \t]/.test(line)) return cursor === index ? cursor : cursor - 1;
    if (lineEnd === -1) return text.length;
    cursor = lineEnd + 1;
  }
  return text.length;
}

/** `Bearer`/`Basic` carry the credential positionally rather than as `key=value`. */
// Sticky, not anchored-on-a-slice: slicing the message at every index made this O(n^2).
const SCHEME = /(Bearer|Basic)([ \t]+)([A-Za-z0-9._~+/=-]+)/iy;
const HEADER_CONTEXT = /(?:^|[\s,;{[])(?:proxy-)?authorization[ \t]*[:=][ \t]*$/i;

export function redact(message: string): string {
  // Coerce rather than pass through: returning a non-string unchanged would be a fail-open
  // redactor, and the callers that hand this an `unknown` are error paths.
  if (typeof message !== "string") return redact(String(message));
  if (message === "") return message;
  const out: string[] = [];
  let index = 0;
  let braceDepth = 0;
  let previous = "";
  // Quote state, so a brace inside a string literal cannot disturb the structural depth that
  // decides whether a .env/YAML value owns its line.
  let stringQuote = "";
  let escaped = false;

  while (index < message.length) {
    const character = message[index] as string;
    if (stringQuote) {
      // Track the escape without consuming it: an escaped quote is how a nested JSON document
      // marks its own strings, and key detection below still has to see those bytes.
      if (character === "\\") escaped = !escaped;
      else {
        if (character === stringQuote && !escaped) stringQuote = "";
        escaped = false;
      }
    } else if (character === '"' || character === "'") {
      stringQuote = character;
    } else if (character === "{" || character === "[") braceDepth += 1;
    else if (character === "}" || character === "]") braceDepth = Math.max(0, braceDepth - 1);

    if (previous === "" || !isKeyChar(previous)) {
      let scheme: RegExpExecArray | null = null;
      if (character === "B" || character === "b") {
        SCHEME.lastIndex = index;
        scheme = SCHEME.exec(message);
      }
      if (scheme && previous !== "/" && previous !== "." && previous !== "-") {
        const credential = scheme[3] as string;
        // In an explicit authorization header the next token IS the credential, whatever it looks
        // like. Bare in free text it must carry a non-letter: every ASCII word is in the
        // credential alphabet, so a length rule alone redacts titles.
        const inHeader = HEADER_CONTEXT.test(message.slice(Math.max(0, index - 48), index));
        const bearer = (scheme[1] as string).toLowerCase() === "bearer";
        if (
          inHeader ||
          (bearer && credential.length >= 3) ||
          (credential.length >= 8 && /[0-9._~+/=-]/.test(credential)) ||
          credential.length >= 16
        ) {
          out.push(scheme[1] as string, scheme[2] as string, PLACEHOLDER);
          index += (scheme[0] as string).length;
          previous = "D";
          continue;
        }
      }

      const key = readKey(message, index);
      if (key) {
        let cursor = key.end;
        while (cursor < message.length && isSpace(message[cursor] as string)) cursor += 1;
        const separator = message[cursor];
        if (separator === ":" || separator === "=") {
          let valueStart = cursor + 1;
          while (valueStart < message.length && isSpace(message[valueStart] as string)) valueStart += 1;
          // Walk back over blank space only — slicing to the line start and trimming copied the whole
          // preceding message on every hit, which is quadratic on input without newlines.
          let back = index;
          while (back > 0 && isSpace(message[back - 1] as string)) back -= 1;
          // A bare key at the start of its line owns that line, so a .env or YAML value keeps its
          // spaces. A YAML list item ("- key:") or an `export` prefix still counts as line start.
          // A QUOTED key does not own the line: that is how JSON writes keys, and there the
          // delimiters do the work. Brace depth is deliberately not consulted — an unclosed brace
          // on an earlier line used to disable redaction for the rest of the message.
          const prefix = /(?:^|[\n\r])[ \t]*(?:-[ \t]*|export[ \t]*)$/;
          const atLineStart =
            back === 0 ||
            message[back - 1] === "\n" ||
            message[back - 1] === "\r" ||
            prefix.test(message.slice(Math.max(0, back - 24), back));
          const ownsLine = atLineStart && !key.quoted;
          // A cookie value is itself a Cookie header, so its semicolons belong to one value rather
          // than separating fields. This package no longer reads one; the key stays because a plugin
          // or an old config can still put a cookie somewhere this redactor sees.
          const end =
            valueStart < message.length
              ? readValueEnd(message, valueStart, braceDepth, ownsLine, key.name === "weread_web_cookie")
              : valueStart;
          if (isSecretKey(key, separator) && end > valueStart) {
            const open = quoteAt(message, valueStart);
            out.push(message.slice(index, valueStart));
            out.push(open ? `${open.quote}${PLACEHOLDER}${open.quote}` : PLACEHOLDER);
            index = end;
            previous = "D";
            continue;
          }
        }
      }
    }

    out.push(character);
    previous = character;
    index += 1;
  }
  return out.join("");
}

export const stripErrorPrefix = (message: string): string => message.replace(/^\s*error:\s*/i, "");
