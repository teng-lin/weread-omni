import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AuthError } from "../errors.js";

export interface Credentials {
  vid: string;
  accessToken?: string;
  refreshToken: string;
  deviceId: string;
}

export interface LoadCredentialsOptions {
  credentials?: Partial<Credentials>;
  env?: NodeJS.ProcessEnv;
  store?: string;
}

export interface SaveCredentialsOptions {
  env?: NodeJS.ProcessEnv;
  store?: string;
}

const requiredFields = ["vid", "refreshToken", "deviceId"] as const;
const fields = [...requiredFields, "accessToken"] as const;

function completeCredentials(
  source: Partial<Record<(typeof fields)[number], unknown>>,
  label: string,
  names: readonly string[] = requiredFields,
  accessTokenName = "accessToken",
): Credentials {
  const missing = requiredFields.flatMap((field, index) =>
    typeof source[field] === "string" && source[field].length > 0 ? [] : [names[index]],
  );
  if (missing.length > 0) {
    throw new AuthError(`incomplete ${label} credentials: missing ${missing.join(", ")}`);
  }
  if (source.accessToken !== undefined && (typeof source.accessToken !== "string" || source.accessToken.length === 0)) {
    throw new AuthError(`invalid ${label} credentials: ${accessTokenName} must be a non-empty string`);
  }
  return {
    vid: source.vid as string,
    ...(source.accessToken === undefined ? {} : { accessToken: source.accessToken }),
    refreshToken: source.refreshToken as string,
    deviceId: source.deviceId as string,
  };
}

const STORE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Resolve the credential file for a store name, or the unsuffixed default when none is given. */
export function storePath(env: NodeJS.ProcessEnv = process.env, store?: string): string {
  const directory = env.WEREAD_CONFIG_DIR || join(homedir(), ".config", "weread");
  // An explicit "" is a deliberate request for the unsuffixed store, not an absent argument.
  if (store === undefined || store === "") {
    return join(directory, "credentials.json");
  }
  if (!STORE_NAME.test(store)) {
    throw new AuthError(
      `invalid credential store name ${JSON.stringify(store)}: use letters, digits, "-" or "_" (max 64)`,
    );
  }
  return join(directory, `credentials.${store}.json`);
}

export function loadCredentials(options: LoadCredentialsOptions = {}): Credentials {
  const env = options.env ?? process.env;
  const explicit = options.credentials;
  if (explicit && fields.some((field) => explicit[field] !== undefined)) {
    return completeCredentials(explicit, "constructor");
  }

  const path = storePath(env, options.store);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const fromEnv = {
        vid: env.WEREAD_VID || undefined,
        accessToken: env.WEREAD_ACCESS_TOKEN || undefined,
        refreshToken: env.WEREAD_REFRESH_TOKEN || undefined,
        deviceId: env.WEREAD_DEVICE_ID || undefined,
      };
      if (fields.some((field) => fromEnv[field] !== undefined)) {
        return completeCredentials(
          fromEnv,
          "environment",
          ["WEREAD_VID", "WEREAD_REFRESH_TOKEN", "WEREAD_DEVICE_ID"],
          "WEREAD_ACCESS_TOKEN",
        );
      }
      throw new AuthError(`WeRead credentials not found at ${path}`, { cause: error });
    }
    if (error instanceof SyntaxError) {
      throw new AuthError(`WeRead credentials at ${path} are not valid JSON`, { cause: error });
    }
    // Every other exit from this function throws AuthError; letting EACCES/EISDIR escape as a
    // bare Error meant a caller catching the documented type silently missed them.
    throw new AuthError(`WeRead credentials at ${path} could not be read`, { cause: error });
  }
  return completeCredentials((parsed ?? {}) as Partial<Credentials>, "file");
}

export function saveCredentials(credentials: Credentials, options: SaveCredentialsOptions = {}): void {
  const env = options.env ?? process.env;
  const path = storePath(env, options.store);
  const directory = dirname(path);
  const temporary = join(directory, `.credentials.${process.pid}.${randomUUID()}.tmp`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temporary, `${JSON.stringify(completeCredentials(credentials, "file"), null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
