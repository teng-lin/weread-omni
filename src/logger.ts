import { redact } from "./redact.js";

export type Logger = Partial<Record<"debug" | "info" | "warn" | "error", (message: string) => void>>;

export function emitLog(logger: Logger | undefined, level: keyof Logger, message: string): void {
  try {
    logger?.[level]?.(redact(message).replaceAll("\r", "\\r").replaceAll("\n", "\\n"));
  } catch {
    // Diagnostics must never change the operation they describe.
  }
}
