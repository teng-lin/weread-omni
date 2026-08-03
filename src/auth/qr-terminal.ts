import qrcode from "qrcode-terminal";

export function printQr(url: string): Promise<void> {
  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (output) => {
      process.stderr.write(output);
      resolve();
    });
  });
}
