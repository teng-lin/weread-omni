import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Each core directory must independently clear 80 on all four metrics, so no
// directory can hide below 80 behind the others' aggregate. There is no
// `src/crypto/**` entry because the public package has no custom crypto.
const perDirectoryFloor = {
  statements: 80,
  branches: 80,
  functions: 80,
  lines: 80,
};

export default defineConfig({
  test: {
    // Broad enough that `npx vitest run test/e2e/pack-smoke` can select the slow
    // packed-artifact suite directly; `npm test` and `npm run test:cov` narrow to
    // test/unit + test/integration so packing never runs inside the coverage gate.
    include: ["test/**/*.test.ts"],
    // `libraryRoot` falls back to the real home directory, and `homedir()` reads the OS rather
    // than the env object a test hands it. Without this a test that reaches the content library
    // through an injected env creates a SQLite store under the developer's actual $HOME and never
    // removes it. Set here so no suite can opt out by forgetting.
    env: { WEREAD_LIBRARY_DIR: join(tmpdir(), "weread-vitest-library") },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // `test/**` is listed because the v8 provider reports every non-excluded module a test
      // loads, not only the ones `include` names: without it, test/support/api-surface.ts is
      // measured as if it were shipped code and moves the thresholds below.
      exclude: ["test/**"],
      // Ratchets set just below the measured floor of this branch
      // (91.62/84.91/94.04/94.13) so they catch regressions without flaking.
      //
      // Re-baselined downward when the official backend and the stock-store adapter were removed.
      // Nothing became less tested: official-api.ts carried 94.71% branch coverage against an 86.02%
      // average, and stock-store.ts had a dedicated suite, so deleting both pulled the mean down
      // arithmetically. Lower the numbers to match reality rather than leave a gate that fails for
      // a reason unrelated to test quality.
      thresholds: {
        statements: 91,
        branches: 84,
        functions: 94,
        lines: 94,
        "src/auth/**": perDirectoryFloor,
        "src/api/**": perDirectoryFloor,
        "src/library/**": perDirectoryFloor,
      },
    },
  },
});
