import { describe, expect, it, vi } from "vitest";
import { output } from "../../src/cli/output.js";

describe("CLI output", () => {
  it("writes raw single-line JSON without invoking the human formatter", () => {
    const write = vi.fn();
    const human = vi.fn(() => "human");

    output({ a: 1 }, { json: true, stdout: { write } }, human);

    expect(write).toHaveBeenCalledWith('{"a":1}\n');
    expect(human).not.toHaveBeenCalled();
  });

  it("writes the human formatter result with exactly one trailing newline", () => {
    const write = vi.fn();
    const human = vi.fn(() => "human\n");

    output({ a: 1 }, { json: false, stdout: { write } }, human);

    expect(human).toHaveBeenCalledWith({ a: 1 });
    expect(write).toHaveBeenCalledWith("human\n");
  });
});
