import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

describe("public scaffold", () => {
  it("declares only the root package surface and approved dependencies", async () => {
    const manifest = JSON.parse(await readFile(new URL("package.json", `file://${root}/`), "utf8")) as {
      name: string;
      version: string;
      repository: { url: string };
      homepage: string;
      bugs: string;
      exports: Record<string, unknown>;
      files: string[];
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };

    expect(manifest).toMatchObject({
      name: "weread-omni",
      version: expect.stringMatching(
        /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.[1-9]\d*)?$/,
      ),
      repository: { url: "git+https://github.com/teng-lin/weread-omni.git" },
      homepage: "https://github.com/teng-lin/weread-omni#readme",
      bugs: "https://github.com/teng-lin/weread-omni/issues",
      exports: { ".": expect.any(Object) },
    });
    // The packed surface (files/exports/bin) is the release contract; test/unit/release.test.ts
    // owns it. This test stays scoped to the scaffold identity, dependencies, and build scripts.
    expect(Object.keys(manifest.dependencies).sort()).toEqual(
      ["@teng-lin/agent-fetch", "@types/node", "commander", "cos-nodejs-sdk-v5", "feed", "qrcode-terminal"].sort(),
    );
    expect(manifest.scripts.build).toMatch(/^npm run clean && /);
    expect(manifest.scripts.prepare).toBe("npm run build");
    expect(manifest.scripts.prepack).toBe("npm run build");
  });
});
