import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  applyConnectAttemptTimeout,
  connectAttemptTimeoutMs,
  DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS,
} from "../../src/connect-timeout.js";

describe("connect attempt timeout resolution", () => {
  it("defaults to the raised budget when the variable is absent or blank", () => {
    expect(connectAttemptTimeoutMs({})).toBe(DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS);
    expect(connectAttemptTimeoutMs({ WEREAD_CONNECT_ATTEMPT_TIMEOUT_MS: "" })).toBe(DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS);
    expect(connectAttemptTimeoutMs({ WEREAD_CONNECT_ATTEMPT_TIMEOUT_MS: "   " })).toBe(
      DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS,
    );
  });

  it("accepts a positive integer of milliseconds, with surrounding whitespace", () => {
    expect(connectAttemptTimeoutMs({ WEREAD_CONNECT_ATTEMPT_TIMEOUT_MS: "2500" })).toBe(2500);
    expect(connectAttemptTimeoutMs({ WEREAD_CONNECT_ATTEMPT_TIMEOUT_MS: " 2500 " })).toBe(2500);
  });

  it("treats an explicit 0 as the documented opt-out", () => {
    expect(connectAttemptTimeoutMs({ WEREAD_CONNECT_ATTEMPT_TIMEOUT_MS: "0" })).toBeUndefined();
  });

  // Unlike WEREAD_STORAGE_TIMEOUT_MS this must not throw: it is read before argument parsing, so a
  // typo would otherwise break every command rather than costing the fix it was meant to tune.
  it.each(["-1", "1.5", "later", "1e3", "NaN", "Infinity"])(
    "falls back to Node's own default for the invalid value %s",
    (value) => {
      expect(connectAttemptTimeoutMs({ WEREAD_CONNECT_ATTEMPT_TIMEOUT_MS: value })).toBeUndefined();
    },
  );

  // net.setDefaultAutoSelectFamilyAttemptTimeout throws ERR_OUT_OF_RANGE past int32, so a value
  // Node would reject has to be filtered here rather than crash the binary at startup.
  it("accepts Node's own maximum and falls back past it", () => {
    expect(connectAttemptTimeoutMs({ WEREAD_CONNECT_ATTEMPT_TIMEOUT_MS: "2147483647" })).toBe(2_147_483_647);
    expect(connectAttemptTimeoutMs({ WEREAD_CONNECT_ATTEMPT_TIMEOUT_MS: "2147483648" })).toBeUndefined();
  });

  // The other end of the range is Node's business, not this parser's: it accepts anything positive
  // and Node silently clamps 1–9 up to 10. Passing it through is what keeps that Node's decision.
  it("passes a below-clamp value through rather than second-guessing Node", () => {
    expect(connectAttemptTimeoutMs({ WEREAD_CONNECT_ATTEMPT_TIMEOUT_MS: "1" })).toBe(1);
  });
});

describe("applying the connect attempt timeout", () => {
  it("sets the resolved value and reports it", () => {
    const setAttemptTimeout = vi.fn();
    expect(applyConnectAttemptTimeout({}, setAttemptTimeout)).toBe(DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS);
    expect(setAttemptTimeout).toHaveBeenCalledWith(DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS);
  });

  it("leaves Node untouched when the fix is disabled", () => {
    const setAttemptTimeout = vi.fn();
    expect(applyConnectAttemptTimeout({ WEREAD_CONNECT_ATTEMPT_TIMEOUT_MS: "0" }, setAttemptTimeout)).toBeUndefined();
    expect(setAttemptTimeout).not.toHaveBeenCalled();
  });

  it("leaves Node untouched when the value is unparseable", () => {
    const setAttemptTimeout = vi.fn();
    expect(
      applyConnectAttemptTimeout({ WEREAD_CONNECT_ATTEMPT_TIMEOUT_MS: "soon" }, setAttemptTimeout),
    ).toBeUndefined();
    expect(setAttemptTimeout).not.toHaveBeenCalled();
  });
});

// The design rests on one rule — only a process entry point mutates this Node-wide default — and
// until now that rule was comments and nothing else. Every test stayed green whether the call was
// deleted from the entry point (the fix silently disappears, and the symptom is the intermittent
// `network error` it took an interleaved A/B to diagnose) or added to src/api/client.ts (the
// library starts reconfiguring its host application's networking). Pinned so the next such change
// has to defeat an assertion rather than a comment.
describe("only the CLI binary mutates the process-wide default", () => {
  const sourceRoot = new URL("../../src/", import.meta.url);

  it("is called from src/cli.ts, and nowhere else in src/", async () => {
    const paths = (await readdir(sourceRoot, { recursive: true })).filter(
      (path) => path.endsWith(".ts") && path !== "connect-timeout.ts",
    );
    const callers: string[] = [];
    for (const path of paths) {
      const source = await readFile(new URL(path, sourceRoot), "utf8");
      if (source.includes("applyConnectAttemptTimeout(")) callers.push(path);
    }
    expect(callers.sort()).toEqual(["cli.ts"]);
  });

  it("calls it only under the isMain() guard, so importing either module changes nothing", async () => {
    for (const entry of ["cli.ts"]) {
      const source = await readFile(new URL(entry, sourceRoot), "utf8");
      expect(source.indexOf("applyConnectAttemptTimeout()")).toBeGreaterThan(source.indexOf("if (isMain()) {"));
    }
  });
});
