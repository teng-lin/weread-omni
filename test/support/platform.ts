/**
 * Platform differences the end-to-end suites have to account for.
 *
 * These suites drive `npm` and the installed `weread` bin as real child processes, and both are
 * spelled differently on Windows:
 *
 * * `npm` is `npm.cmd`. Since the fix for CVE-2024-27980, Node refuses to run a `.cmd` through
 *   `execFile`/`spawn` unless `shell` is set, so a bare `execFile("npm", …)` fails with ENOENT
 *   rather than running anything. `.github/workflows/ci.yml` already carries the same workaround
 *   for its inline packing step.
 * * `node_modules/.bin/weread` is a shell script Windows cannot execute. The runnable entry point
 *   is the generated `weread.cmd` beside it.
 *
 * Everything here is a no-op off Windows, so the POSIX path keeps executing the binary directly
 * with no shell in between.
 */
import { join } from "node:path";

const isWindows = process.platform === "win32";

/**
 * Options for running a command that resolves to a `.cmd` shim on Windows.
 *
 * `shell` hands the command line to `cmd.exe`, which quotes arguments differently from a direct
 * exec. Callers here pass paths and simple flags, so that is safe; an argument containing `"` or
 * `&` would not be.
 */
export const shellOnWindows = isWindows ? ({ shell: true } as const) : ({} as const);

/** The runnable path of an installed bin, which carries a `.cmd` extension on Windows. */
export const binPath = (binDir: string, bin: string): string => join(binDir, isWindows ? `${bin}.cmd` : bin);
