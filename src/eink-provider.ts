import { WeReadClient } from "./api/client.js";
import { createEinkClient } from "./api/mobile-client.js";
import { type Credentials, loadCredentials } from "./auth/credentials.js";
import { AuthError } from "./errors.js";
import type { ClientIdentity, ClientOpenContext, ClientProvider, JsonValue } from "./plugin.js";
import { einkProfile } from "./profile.js";

interface EinkState {
  version: 1;
  eink: Credentials;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function credentials(value: unknown): Credentials {
  const record = object(value);
  if (!record || !["vid", "refreshToken", "deviceId"].some((field) => field in record)) {
    throw new AuthError("E-Ink account credentials are invalid");
  }
  return loadCredentials({ credentials: record as Partial<Credentials>, env: {} });
}

function state(value: unknown): EinkState {
  const record = object(value);
  if (record?.version !== 1) throw new AuthError("E-Ink account state has an unsupported version");
  return { version: 1, eink: credentials(record.eink) };
}

function jsonCredentials(value: Credentials): JsonValue {
  return {
    vid: value.vid,
    refreshToken: value.refreshToken,
    deviceId: value.deviceId,
    ...(value.accessToken ? { accessToken: value.accessToken } : {}),
  };
}

function jsonState(value: EinkState): JsonValue {
  return { version: 1, eink: jsonCredentials(value.eink) };
}

function identity(value: EinkState): ClientIdentity {
  return { vid: value.eink.vid, deviceId: value.eink.deviceId };
}

export const einkProvider: ClientProvider = {
  async login(context) {
    const previous = context.previousState === undefined ? undefined : state(context.previousState);
    const einkClient = createEinkClient({
      env: context.env,
      fetchImpl: context.fetchImpl,
      ...(previous ? { credentials: previous.eink } : {}),
    });
    const eink = await einkClient.login({
      signal: context.signal,
      deviceId: previous?.eink.deviceId ?? einkProfile().newDeviceId(),
      onQr: (url) => context.onQr(url, "eink"),
      onStatus: (status) => context.onStatus(status, "eink"),
      onCredentials: () => undefined,
    });
    const result: EinkState = { version: 1, eink };
    return { state: jsonState(result), identity: identity(result) };
  },

  async open(context: ClientOpenContext) {
    let current = state(context.state);
    let tail = Promise.resolve();
    const update = (mutate: (previous: EinkState) => EinkState): Promise<void> => {
      current = state(mutate(current));
      const snapshot = jsonState(current);
      const write = tail.then(() => context.saveState(snapshot));
      tail = write.catch(() => undefined);
      return write;
    };
    const eink = createEinkClient({
      env: context.env,
      fetchImpl: context.fetchImpl,
      credentials: current.eink,
      onCredentials: (next) => update((previous) => ({ ...previous, eink: next })),
    });
    return {
      client: new WeReadClient({ eink }),
      identity: identity(current),
    };
  },
};
