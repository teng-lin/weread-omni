import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildApiSurface,
  distIsBuilt,
  distIsStale,
  readEntryPoints,
  readProjectRootFiles,
  repoRoot,
  snapshotPath,
} from "../support/api-surface.js";

// Public API drift guardrail.
//
// The canonical operation registry is asserted in both directions elsewhere, but the *type* surface
// is not. `src/index.ts` now enumerates the exported types by name rather than re-exporting a
// whole module, which stops a *new* declaration from becoming public by accident — but it says
// nothing about the shape of the types already on the list, nor about the other published entry
// points (./cli, ./plugin). Renaming a field on any DTO, widening a parameter, or changing a method
// signature still changes what consumers compile against with no review step. This test renders
// the built declarations of every published entry point into one canonical document and compares
// it to the committed snapshot, so such a change has to be looked at and re-blessed on purpose.
//
// Re-bless an intentional change with:
//
//     npm run build && npm run api-surface:update
//
// then read test/api-surface.snapshot.md in the diff before committing it.

const snapshotName = relative(repoRoot, snapshotPath);
const updateRequested = process.env.UPDATE_API_SNAPSHOT === "1";

// Rendering the surface runs the TypeScript compiler over every published declaration, which takes
// ~5s on an idle machine — close enough to vitest's 5000ms default that a loaded machine reddens the
// drift guardrail for a reason that has nothing to do with the API. A guardrail that fails randomly
// is one people learn to re-run rather than read, so give the compiler room it will not normally use.
const SURFACE_TIMEOUT_MS = 60_000;

describe("public API surface", () => {
  it("covers every declaration file the package exports", (context) => {
    if (!distIsBuilt()) {
      // Skipping is a convenience for a local run against an unbuilt tree, never for CI: a
      // guardrail that silently no-ops reports green precisely when it has checked nothing.
      // `npm run build` also deletes dist/ before recreating it, so a concurrent build is one
      // way to land here.
      if (process.env.CI) throw new Error("dist/ is not built — CI must run `npm run build` before `npm test`");
      context.skip(`dist/ is not built — run \`npm run build\` before \`npm test\` to run the API drift guardrail`);
      return;
    }
    // Two independent lists of the published declarations: one derived from package.json
    // `exports`, one from the extractor's TypeScript project. A new subpath that reaches only
    // the first would otherwise be absent from the snapshot without anything failing.
    expect(readProjectRootFiles()).toEqual(
      readEntryPoints()
        .map((entry) => entry.declaration)
        .sort(),
    );
  });

  it(
    "matches the committed snapshot",
    (context) => {
      if (!distIsBuilt()) {
        // Skipping is a convenience for a local run against an unbuilt tree, never for CI: a
        // guardrail that silently no-ops reports green precisely when it has checked nothing.
        // `npm run build` also deletes dist/ before recreating it, so a concurrent build is one
        // way to land here.
        if (process.env.CI) throw new Error("dist/ is not built — CI must run `npm run build` before `npm test`");
        context.skip(`dist/ is not built — run \`npm run build\` before \`npm test\` to run the API drift guardrail`);
        return;
      }
      expect(
        distIsStale(),
        "dist/ is older than src/, so this would compare the previous build's API. Run `npm run build`.",
      ).toBe(false);

      const actual = buildApiSurface();

      if (updateRequested) {
        writeFileSync(snapshotPath, actual);
        // Writing and asserting nothing would let `UPDATE_API_SNAPSHOT=1 npm test` pass in CI
        // while re-blessing whatever drifted, so the update path is a hard failure of its own.
        throw new Error(
          `${snapshotName} regenerated. Review the diff, commit it, and re-run without UPDATE_API_SNAPSHOT.`,
        );
      }

      const expected = readFileSync(snapshotPath, "utf8");
      if (actual !== expected) throw new Error(driftReport(expected, actual));
    },
    SURFACE_TIMEOUT_MS,
  );

  it(
    "names no private member, so an internal refactor cannot move the public surface",
    (context) => {
      if (!distIsBuilt()) {
        if (process.env.CI) throw new Error("dist/ is not built — CI must run `npm run build` before `npm test`");
        context.skip(`dist/ is not built — run \`npm run build\` before \`npm test\` to run the API drift guardrail`);
        return;
      }
      const surface = buildApiSurface();

      // `tsc` emits a `private` member into the declarations as an untyped `private foo;`, so the
      // extractor could see and render it. It must not: a consumer cannot reach it, and a
      // guardrail that fires on private renames is a guardrail people learn to re-bless blind.
      // `#private` is exempt — it is the nominal brand for a JS `#field`, and it names nothing.
      expect(surface.split("\n").filter((line) => /(?:^|\s)private\s/.test(line))).toEqual([]);

      // Anchored on a real class with both kinds of member, so the assertion above cannot be
      // satisfied by an extractor that has quietly stopped rendering class members at all.
      expect(surface).toContain("class TokenManager {");
      expect(surface).toMatch(/get: \(force\?: boolean/);
      expect(surface).not.toContain("retryPersistence");
      // What private members *do* change is assignability, and that survives as a presence-only
      // fact: it appears when a class gains its first one and never moves again.
      expect(surface).toContain("// nominal: not assignable from a structurally identical object");
    },
    SURFACE_TIMEOUT_MS,
  );
});

/** A full diff of a multi-thousand-line snapshot is unreadable in a CI log, so report the
 *  lines that appeared and disappeared instead, capped. */
function driftReport(expected: string, actual: string): string {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const removed = difference(expectedLines, actualLines);
  const added = difference(actualLines, expectedLines);

  const report = [
    `The public API surface no longer matches ${snapshotName}.`,
    "",
    "This is a public compatibility change. Review it against docs/api-stability-policy.md,",
    "decide whether it is additive, compatible, or breaking, then re-bless it deliberately:",
    "",
    "    npm run build && npm run api-surface:update",
    "",
    `Lines removed from the public surface (${removed.length}):`,
    ...preview(removed),
    "",
    `Lines added to the public surface (${added.length}):`,
    ...preview(added),
  ];
  return report.join("\n");
}

function difference(from: string[], other: string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of other) counts.set(line, (counts.get(line) ?? 0) + 1);
  const result: string[] = [];
  for (const line of from) {
    const remaining = counts.get(line) ?? 0;
    if (remaining > 0) counts.set(line, remaining - 1);
    else if (line.trim() !== "") result.push(line);
  }
  return result;
}

function preview(lines: string[], limit = 40): string[] {
  const shown = lines.slice(0, limit).map((line) => `    ${line}`);
  if (lines.length > limit) shown.push(`    … and ${lines.length - limit} more`);
  return shown.length > 0 ? shown : ["    (none)"];
}
