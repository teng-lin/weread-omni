import { describe, expect, it } from "vitest";

import { redact, stripErrorPrefix } from "../../src/redact.js";

describe("redact", () => {
  it("scrubs bearer and access/refresh token material", () => {
    expect(redact("auth failed: Bearer sk-secret-value")).toBe("auth failed: Bearer [REDACTED]");
    expect(redact('{"accessToken":"a1b2","refreshToken":"c3d4"}')).toBe(
      '{"accessToken":"[REDACTED]","refreshToken":"[REDACTED]"}',
    );
  });

  it.each([
    ["MCP_UPLOAD_SIGNING_KEY=super-secret-key", "MCP_UPLOAD_SIGNING_KEY=[REDACTED]"],
    ["config has signingKey=abc123def and more", "config has signingKey=[REDACTED] and more"],
    ["S3_SECRET_KEY=aws-secret-value", "S3_SECRET_KEY=[REDACTED]"],
    ["S3_ACCESS_KEY=AKIA1234", "S3_ACCESS_KEY=[REDACTED]"],
    [
      '{"secretAccessKey":"wJalrXUtn","accessKeyId":"AKIA"}',
      '{"secretAccessKey":"[REDACTED]","accessKeyId":"[REDACTED]"}',
    ],
    ["credentials { secretKey: hunter2 }", "credentials { secretKey: [REDACTED] }"],
    ["MCP_BEARER_TOKEN=super-secret-bearer", "MCP_BEARER_TOKEN=[REDACTED]"],
    ["WEREAD_ACCESS_TOKEN=access-secret-value", "WEREAD_ACCESS_TOKEN=[REDACTED]"],
    ["WEREAD_REFRESH_TOKEN=refresh-secret-value", "WEREAD_REFRESH_TOKEN=[REDACTED]"],
    ["WEREAD_WEB_COOKIE=wr_vid=123; wr_skey=session&tail; wr_rt=refresh; wr_ql=0", "WEREAD_WEB_COOKIE=[REDACTED]"],
    ["Cookie: wr_skey=session; wr_rt=refresh", "Cookie: wr_skey=[REDACTED]; wr_rt=[REDACTED]"],
    ["COS creds { TmpSecretKey: cos-temp-key }", "COS creds { TmpSecretKey: [REDACTED] }"],
    ['{"SecurityToken":"cos-session-token"}', '{"SecurityToken":"[REDACTED]"}'],
  ])("scrubs the credential label in %s", (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it.each([
    ["MCP_OAUTH_PASSWORD env", "MCP_OAUTH_PASSWORD=SUPERSECRETV"],
    ["MCP_OAUTH_PASSWORD JSON", '{"MCP_OAUTH_PASSWORD":"SUPERSECRETV"}'],
    ["MCP_OAUTH_PASSWORD YAML", "MCP_OAUTH_PASSWORD: SUPERSECRETV"],
    ["WEREAD_DEVICE_ID env", "WEREAD_DEVICE_ID=SUPERSECRETV"],
    ["WEREAD_DEVICE_ID JSON", '{"WEREAD_DEVICE_ID":"SUPERSECRETV"}'],
    ["WEREAD_DEVICE_ID YAML", "WEREAD_DEVICE_ID: SUPERSECRETV"],
    ["deviceId JSON", '{"deviceId":"SUPERSECRETV"}'],
  ])("scrubs %s", (_label, input) => {
    expect(redact(input)).not.toContain("SUPERSECRETV");
  });

  it("leaves benign labels without an assigned value untouched", () => {
    expect(redact("invalid accessKey provided")).toBe("invalid accessKey provided");
  });

  it("scrubs both official API key environment values in full", () => {
    expect(redact("WEREAD_API_KEY=wrk-single-secret")).toBe("WEREAD_API_KEY=[REDACTED]");
    expect(redact('WEREAD_API_KEYS={"work":"wrk-map-secret"}')).toBe("WEREAD_API_KEYS=[REDACTED]");
  });
});

describe("stripErrorPrefix", () => {
  it("removes one leading error label case-insensitively", () => {
    expect(stripErrorPrefix(" ERROR: request failed")).toBe("request failed");
    expect(stripErrorPrefix("request failed")).toBe("request failed");
  });
});

describe("redact covers the shapes this product actually leaks", () => {
  const SECRET = "SUPERSECRETVALUE_9f8e7d6c5b4a3210";
  it.each([
    ["WeRead session key", `skey=${SECRET}`],
    ["WeRead cookie name", `wr_skey=${SECRET}`],
    ["Cookie header", `Cookie: wr_skey=${SECRET}; wr_vid=123`],
    ["set-cookie header", `set-cookie: wr_skey=${SECRET}`],
    ["OAuth snake_case refresh token", `refresh_token=${SECRET}`],
    ["OAuth snake_case access token", `access_token=${SECRET}`],
    ["OAuth client secret", `client_secret=${SECRET}`],
    ["PKCE verifier", `code_verifier=${SECRET}`],
    ["authorization as a key", `authorization=${SECRET}`],
    ["password", `password=${SECRET}`],
    ["api key", `api_key=${SECRET}`],
    ["json snake_case body", JSON.stringify({ refresh_token: SECRET })],
  ])("redacts %s", (_label, input) => {
    expect(redact(input)).not.toContain("SUPERSECRETVALUE");
  });

  it("still leaves ordinary text alone", () => {
    expect(redact("bookId=12345 title=Dune")).toBe("bookId=12345 title=Dune");
  });
});

describe("redact does not corrupt legitimate text", () => {
  it.each([
    ["a title containing skey", "Whiskey: A History"],
    ["a title containing token", "Token: A Novel"],
    ["an unrelated camelCase field", 'continuationToken: "abc123"'],
    ["ordinary fields", "bookId=12345 title=Dune"],
  ])("leaves %s unchanged", (_label, input) => {
    expect(redact(input)).toBe(input);
  });

  it("redacts a quoted secret whole, including any semicolon inside it", () => {
    expect(redact(JSON.stringify({ refresh_token: "alpha;bravo" }))).not.toContain("bravo");
    expect(redact(JSON.stringify({ password: "alpha;omega" }))).not.toContain("omega");
  });

  it("redacts one cookie without swallowing the rest of the header", () => {
    const out = redact("Cookie: wr_skey=SECRETVALUE; wr_vid=123");
    expect(out).not.toContain("SECRETVALUE");
    expect(out).toContain("wr_vid=123");
  });
});

describe("quoted secrets are redacted whole", () => {
  it.each([
    ["spaces", JSON.stringify({ password: "a b SECRETV" })],
    ["semicolons", JSON.stringify({ refresh_token: "alpha;SECRETV" })],
    ["equals", JSON.stringify({ client_secret: "abc=SECRETV" })],
    ["commas", JSON.stringify({ access_token: "a,SECRETV" })],
  ])("does not leak a quoted value containing %s", (_label, input) => {
    expect(redact(input)).not.toContain("SECRETV");
  });

  it("redacts in bounded time on a pathological input", () => {
    const started = Date.now();
    redact(`password=${"a".repeat(60_000)}!`);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

// Every case below is a leak or corruption an audit actually reproduced against an earlier
// version of this file. They are kept as a table so the next change to these patterns has to
// clear all of them at once.
describe("redaction shapes found by audit", () => {
  const S = "SUPERSECRETV";
  it.each([
    ["value with spaces", `{"password":"alpha bravo ${S}"}`],
    ["value with commas", `{"access_token":"alpha,bravo,${S}"}`],
    ["value with semicolon", `{"refresh_token":"alpha;${S}"}`],
    ["value with an apostrophe", JSON.stringify({ password: `don't leak ${S}` })],
    ["value with an escaped quote", `{"password":"alpha\\"bravo ${S}"}`],
    ["multiline value", `{"password":"alpha\nbravo ${S}"}`],
    ["Basic scheme", `authorization: Basic ${S}`],
    ["Bearer in compact json", `{"h":"Bearer sk-9f8e-${S}","x":1}`],
    ["bare Token key", `Token=${S}`],
    ["quoted Token key", `{"Token":"${S}"}`],
    ["cos SecurityToken", `{"SecurityToken":"${S}"}`],
    ["url query param", `https://x/y?access_token=${S}&bookId=123`],
  ])("does not leak %s", (_label, input) => {
    expect(redact(input)).not.toContain(S);
  });

  it.each([
    ["a title containing skey", "Whiskey: A History"],
    ["an unrelated camelCase field", 'continuationToken: "abc123"'],
    ["a longer camelCase field", 'previousAccessToken: "public-value"'],
    ["ordinary fields", "bookId=12345 title=Dune"],
  ])("leaves %s unchanged", (_label, input) => {
    expect(redact(input)).toBe(input);
  });

  it("keeps url params that follow a redacted one", () => {
    const out = redact("https://x/y?access_token=SUPERSECRETV&bookId=123&title=Dune");
    expect(out).toContain("bookId=123");
    expect(out).toContain("title=Dune");
  });

  it("keeps json fields that follow a redacted bearer token", () => {
    expect(redact('{"h":"Bearer sk-9f8e-SUPERSECRETV","x":1}')).toContain('"x":1');
  });
});

it("redacts a value whose closing quote was truncated away", () => {
  // A clipped log line or error body leaves an opening quote with no closing one; neither the
  // quoted nor the unquoted rule matches that, so the value used to survive in clear.
  expect(redact('{"password":"SUPERSECRETV')).not.toContain("SUPERSECRETV");
  expect(redact("prefix {'api_key':'SUPERSECRETV")).not.toContain("SUPERSECRETV");
});

describe("scheme credentials versus ordinary prose", () => {
  it.each([
    ["single-quoted Token", "{'Token':'SINK_SECRETVAL'}"],
    ["unquoted single-quoted Token", "Token='SINK_SECRETVAL'"],
    ["Basic credential", "authorization: Basic SINK_SECRETVALmore"],
    ["Bearer credential", "Authorization: Bearer SINK_SECRETVAL"],
  ])("redacts %s", (_label, input) => {
    expect(redact(input)).not.toContain("SINK_SECRETVAL");
  });

  it.each([
    ["a film title", "Basic Instinct"],
    ["a phrase", "Bearer of Bad News"],
    ["prose", "The bearer of this letter may enter."],
    ["a file path", "/library/Basic Instinct/cover.jpg"],
  ])("leaves %s unchanged", (_label, input) => {
    expect(redact(input)).toBe(input);
  });
});

// Regression rows from a ~400k-input randomized audit of this file.
describe("audit iteration 5 regressions", () => {
  const S = "SINK_SECRET_123456789";
  it.each([
    ["a quoted cookie value", `skey="prefix ${S} suffix"`],
    ["a single-quoted cookie value", `wr_skey='q ${S}'`],
    ["a truncated value containing an apostrophe", `password="don't leak ${S}`],
    ["a truncated value containing an escaped quote", `api_key="prefix \\" ${S}`],
    ["a bare credential with punctuation", `Bearer sk-${S}`],
  ])("does not leak %s", (_label, input) => {
    expect(redact(input)).not.toContain(S);
  });

  it.each([
    ["a 12-letter word after Basic", "Basic Econometrics"],
    ["documentation prose", "Use Basic Authentication in the documentation example."],
    ["a parenthesised path", "/library/(Basic Extraordinary)/cover.jpg"],
  ])("leaves %s unchanged", (_label, input) => {
    expect(redact(input)).toBe(input);
  });

  it("does not let a scheme swallow a line break", () => {
    expect(redact("Basic\r\nAuthentication")).toBe("Basic\r\nAuthentication");
  });

  it("still redacts an unquoted cookie without eating the next one", () => {
    const out = redact(`skey=${S}; wr_vid=1`);
    expect(out).not.toContain(S);
    expect(out).toContain("wr_vid=1");
  });
});

// These three classes are why the regex cascade was replaced with a scanner: each needs quote,
// escape or encoding state that a lexical pattern cannot carry.
describe("shapes that required a scanner", () => {
  const S = "SINKV0123456789";
  it.each([
    ["a secret inside an escaped JSON string", `Error body="{\\"password\\":\\"${S}\\"}"`],
    ["a unicode-escaped key name", `{"pass\\u0077ord":"${S}"}`],
    ["a percent-encoded key name", `pass%77ord=${S}&x=1`],
    ["a leading percent-encoded character", `%70assword=${S}`],
    ["a multi-word YAML value", `password: alpha bravo ${S}`],
    ["a multi-word .env value", `API_KEY=alpha bravo ${S}`],
    ["an indented YAML value", `  password: alpha ${S}`],
  ])("redacts %s", (_label, input) => {
    expect(redact(input)).not.toContain(S);
  });

  it("still ends a value at the delimiter its syntax implies", () => {
    expect(redact(`password=${S}&bookId=123`)).toContain("bookId=123");
    expect(redact(`skey=${S}; wr_vid=1`)).toContain("wr_vid=1");
    expect(redact(`{"password":"${S}","bookId":42}`)).toContain('"bookId":42');
    expect(redact(`config has signingKey=${S} and more`)).toContain("and more");
  });

  it("redacts in linear time", () => {
    const started = Date.now();
    redact('{"password":"abc"},'.repeat(50_000));
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

it("fails closed on a non-string input rather than passing it through", () => {
  const carrier = { toString: () => 'password="SINKV0123456789"' };
  expect(redact(carrier as unknown as string)).not.toContain("SINKV0123456789");
});

// Reproductions from a 420,000-input randomized verification of the scanner. Each row is a leak
// or a structural corruption that run actually observed.
describe("scanner verification regressions", () => {
  it.each([
    ["an escaped quote inside escaped JSON", 'body="{\\"password\\":\\"a\\\\\\"SECRETV1\\",\\"x\\":1}"', "SECRETV1"],
    ["an object value", '{"password":{"raw":"SECRETV2"},"later":1}', "SECRETV2"],
    ["an array value", '{"password":["SECRETV3"],"later":1}', "SECRETV3"],
    ["a YAML list item", "items:\n  - password: alpha SECRETV4 omega\n", "SECRETV4"],
    ["an export-prefixed assignment", "export password=alpha SECRETV5 omega\n", "SECRETV5"],
    ["a brace inside a quoted string", '{"note":"{"}\npassword: first SECRETV6 last\n', "SECRETV6"],
    ["an unclosed brace on an earlier line", "context {\npassword: first SECRETV7 last\n", "SECRETV7"],
    ["a YAML block scalar", "password: |\n  SECRETV8 first\n  second\n", "SECRETV8"],
    ["a long all-letter bearer credential", "rejected Bearer SECRETTOKENVALUE", "SECRETTOKENVALUE"],
  ])("does not leak %s", (_label, input, sentinel) => {
    expect(redact(input)).not.toContain(sentinel);
  });

  it("does not consume the next CRLF line when a quoted value is truncated", () => {
    expect(redact('password="SECRETV9\r\nlater: "kept"\r\nend')).toContain("later: ");
  });

  it("keeps the sibling after a composite value", () => {
    expect(redact('{"password":{"raw":"x"},"later":1}')).toContain('"later":1');
  });

  it("stays linear on repeated encoded fragments", () => {
    // This was 50 seconds on 131KB before the key scan was bounded.
    const started = Date.now();
    redact("\\u0061".repeat(22_000));
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

// Reproductions from the code review on PR #1.
describe("PR review findings", () => {
  const escaped = (key: string) => [...key].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");

  it("keeps the sibling key when an escaped value ends in a literal backslash", () => {
    const input = 'body="{\\"password\\":\\"FIRST\\\\\\\\\\",\\"access_token\\":\\"SECONDSECRET\\"}"';
    const out = redact(input);
    expect(out).not.toContain("SECONDSECRET");
    expect(out).toContain("access_token");
  });

  it("redacts a fully unicode-escaped key name", () => {
    // 12 characters becomes 72 raw, which a raw-length cap silently skipped.
    expect(redact(`{"${escaped("access_token")}":"SECRETC2"}`)).not.toContain("SECRETC2");
  });

  it("redacts a short all-letter bearer credential", () => {
    // MCP_BEARER_TOKEN accepts any non-empty value, and the sample config uses "bearer".
    expect(redact("request rejected: Bearer bearer")).not.toContain("Bearer bearer");
  });

  it("keeps fields after a composite value inside escaped JSON", () => {
    const out = redact('body="{\\"password\\":{\\"raw\\":\\"secretc4\\"},\\"later\\":1}"');
    expect(out).not.toContain("secretc4");
    expect(out).toContain("later");
  });

  it.each([
    ["indentation before chomping", "password: |2-\n  SECRETC6A\n", "SECRETC6A"],
    ["chomping before indentation", "password: |-2\n  SECRETC6B\n", "SECRETC6B"],
    ["keep chomping", "password: >2+\n  SECRETC6C\n", "SECRETC6C"],
  ])("redacts a YAML block scalar with %s", (_label, input, sentinel) => {
    expect(redact(input)).not.toContain(sentinel);
  });
});
