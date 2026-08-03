import qrcode from "qrcode-terminal";
import { describe, expect, it, vi } from "vitest";
import { printQr } from "../../src/auth/qr-terminal.js";

describe("terminal QR rendering", () => {
  it("renders a compact QR code to stderr", async () => {
    const generate = vi.spyOn(qrcode, "generate").mockImplementation((...args) => {
      const callback = args.at(-1);
      if (typeof callback === "function") callback("qr-output");
    });
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await printQr("https://example.test/confirm");
    expect(generate).toHaveBeenCalledWith("https://example.test/confirm", { small: true }, expect.any(Function));
    expect(write).toHaveBeenCalledWith("qr-output");
  });
});
