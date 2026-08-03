export const DEFAULT_STORAGE_TIMEOUT_MS = 30_000;

export function storageTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.WEREAD_STORAGE_TIMEOUT_MS || DEFAULT_STORAGE_TIMEOUT_MS);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("WEREAD_STORAGE_TIMEOUT_MS must be a positive integer");
  }
  return value;
}
