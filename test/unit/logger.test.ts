import { describe, expect, it, vi } from "vitest";
import { emitLog } from "../../src/logger.js";

describe("emitLog", () => {
  it("redacts messages and contains logger failures", () => {
    const warn = vi.fn(() => {
      throw new Error("sink failed");
    });

    expect(() => emitLog({ warn }, "warn", "retry failed\naccessToken=secret-value-123")).not.toThrow();
    expect(warn).toHaveBeenCalledWith("retry failed\\naccessToken=[REDACTED]");
    expect(() => emitLog({}, "debug", "ignored")).not.toThrow();
  });
});
