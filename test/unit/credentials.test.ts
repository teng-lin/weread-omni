import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Credentials, loadCredentials, saveCredentials, storePath } from "../../src/auth/credentials.js";
import { AuthError } from "../../src/errors.js";
import { expectPosixMode } from "../support/posix.js";

const roots: string[] = [];
const makeEnv = (): NodeJS.ProcessEnv => {
  const root = mkdtempSync(join(tmpdir(), "weread-credentials-"));
  roots.push(root);
  return { WEREAD_CONFIG_DIR: root };
};
const credentials: Credentials = { vid: "123", refreshToken: "refresh", deviceId: "device" };
const credentialsWithAccess: Credentials = { ...credentials, accessToken: "access" };

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("credential persistence", () => {
  it("round-trips a named store atomically with mode 0600", () => {
    const env = makeEnv();
    saveCredentials(credentials, { env, store: "eink" });
    const path = storePath(env, "eink");
    expect(loadCredentials({ env, store: "eink" })).toEqual(credentials);
    expectPosixMode(path, 0o600);
    expect(readFileSync(path, "utf8")).not.toContain(".tmp");
  });

  it("round-trips an optional access token without changing legacy files", () => {
    const env = makeEnv();
    saveCredentials(credentials, { env, store: "legacy" });
    saveCredentials(credentialsWithAccess, { env, store: "eink" });

    expect(loadCredentials({ env, store: "legacy" })).toEqual(credentials);
    expect(readFileSync(storePath(env, "legacy"), "utf8")).not.toContain("accessToken");
    expect(loadCredentials({ env, store: "eink" })).toEqual(credentialsWithAccess);
  });

  it("replaces a destination symlink instead of following it", () => {
    const env = makeEnv();
    const directory = env.WEREAD_CONFIG_DIR;
    if (!directory) throw new Error("missing test config directory");
    const target = join(directory, "outside.json");
    writeFileSync(target, "untouched");
    symlinkSync(target, storePath(env, "eink"));
    saveCredentials(credentials, { env, store: "eink" });
    expect(lstatSync(storePath(env, "eink")).isSymbolicLink()).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("untouched");
  });

  it("keeps an explicit unnamed store distinct from a named one", () => {
    // "" is a deliberate request for the unsuffixed file, not an absent argument, so it must not
    // collapse into the same path as omitting the option entirely.
    const env = makeEnv();
    saveCredentials(credentials, { env, store: "" });
    expect(storePath(env, "")).toMatch(/credentials\.json$/);
    expect(storePath(env)).toMatch(/credentials\.json$/);
    expect(storePath(env, "eink")).toMatch(/credentials\.eink\.json$/);
    expect(loadCredentials({ env, store: "" })).toEqual(credentials);
  });

  it("uses complete constructor credentials, then disk, then environment when disk is absent", () => {
    const env: NodeJS.ProcessEnv = {
      ...makeEnv(),
      WEREAD_VID: "env-vid",
      WEREAD_ACCESS_TOKEN: "env-access",
      WEREAD_REFRESH_TOKEN: "env-refresh",
      WEREAD_DEVICE_ID: "env-device",
    };
    saveCredentials(credentials, { env: { WEREAD_CONFIG_DIR: env.WEREAD_CONFIG_DIR }, store: "eink" });
    expect(loadCredentials({ credentials: { ...credentials, vid: "explicit" }, env, store: "eink" }).vid).toBe(
      "explicit",
    );
    expect(loadCredentials({ env, store: "eink" })).toEqual(credentials);
    expect(loadCredentials({ env, store: "missing" })).toEqual({
      vid: "env-vid",
      accessToken: "env-access",
      refreshToken: "env-refresh",
      deviceId: "env-device",
    });
    expect(
      loadCredentials({
        env: {
          WEREAD_CONFIG_DIR: env.WEREAD_CONFIG_DIR,
          WEREAD_VID: "",
          WEREAD_ACCESS_TOKEN: "",
          WEREAD_REFRESH_TOKEN: "",
          WEREAD_DEVICE_ID: "",
        },
        store: "eink",
      }),
    ).toEqual(credentials);
  });

  it("rejects incomplete sources, malformed files, and unsafe store names", () => {
    const env = makeEnv();
    expect(() => loadCredentials({ credentials: { vid: "only" }, env })).toThrow(AuthError);
    expect(() => loadCredentials({ credentials: { accessToken: "access" }, env })).toThrow(/incomplete constructor/);
    expect(() => loadCredentials({ credentials: { ...credentials, accessToken: "" }, env })).toThrow(/accessToken/);
    expect(() =>
      loadCredentials({
        env: { ...env, WEREAD_ACCESS_TOKEN: "access" },
      }),
    ).toThrow(/incomplete environment/);
    expect(() =>
      loadCredentials({
        env: {
          ...env,
          WEREAD_VID: "1",
          WEREAD_REFRESH_TOKEN: "r",
          WEREAD_DEVICE_ID: "d",
          WEREAD_ACCESS_TOKEN: 1 as never,
        },
      }),
    ).toThrow(/WEREAD_ACCESS_TOKEN/);
    expect(() => storePath(env, "../escape")).toThrow(AuthError);
    writeFileSync(storePath(env, ""), "{");
    chmodSync(storePath(env, ""), 0o600);
    expect(() =>
      loadCredentials({
        env: {
          ...env,
          WEREAD_VID: "env-vid",
          WEREAD_ACCESS_TOKEN: "env-access",
          WEREAD_REFRESH_TOKEN: "env-refresh",
          WEREAD_DEVICE_ID: "env-device",
        },
        store: "",
      }),
    ).toThrow(/not valid JSON/);
    writeFileSync(storePath(env, ""), JSON.stringify({ ...credentials, accessToken: null }));
    expect(() => loadCredentials({ env, store: "" })).toThrow(/accessToken/);
  });
});

describe("unreadable credential files fail with the documented type", () => {
  it("wraps a non-ENOENT read failure as AuthError without falling back to environment", () => {
    const env = {
      ...makeEnv(),
      WEREAD_VID: "env-vid",
      WEREAD_REFRESH_TOKEN: "env-refresh",
      WEREAD_DEVICE_ID: "env-device",
    };
    // A directory where the credential file belongs reproduces EISDIR, which previously escaped
    // as a bare Error while every other exit from loadCredentials threw AuthError.
    mkdirSync(storePath(env, "eink"), { recursive: true });
    expect(() => loadCredentials({ env, store: "eink" })).toThrow(/could not be read/);
  });
});
