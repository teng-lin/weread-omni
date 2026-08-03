import { statSync } from "node:fs";
import { expect } from "vitest";

export function expectPosixMode(path: string, expected: number, mask = 0o777): void {
  if (process.platform !== "win32") expect(statSync(path).mode & mask).toBe(expected);
}
