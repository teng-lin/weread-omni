/**
 * `qrcode-terminal` ships types for its terminal renderer only, but the encoder it vendors exposes
 * the finished module matrix — which is what an SVG (or any non-terminal) renderer needs. Declaring
 * that surface here lets the QR renderer use it typed instead of casting through `any`, and keeps
 * the dependency count at zero for a second renderer.
 *
 * Mirrors qrcode-terminal/vendor/QRCode/index.js as used by its own lib/main.js.
 */
declare module "qrcode-terminal/vendor/QRCode/index.js" {
  export default class QRCode {
    /** `typeNumber` -1 selects the smallest version that fits; `errorCorrectLevel` 1 is level L. */
    constructor(typeNumber: number, errorCorrectLevel: number);
    addData(text: string): void;
    /** Lays out the symbol. Must be called after `addData` and before the accessors below. */
    make(): void;
    getModuleCount(): number;
    isDark(row: number, column: number): boolean;
  }
}
