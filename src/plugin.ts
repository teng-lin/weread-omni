import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { CanonicalClient } from "./api/client.js";
import { PUBLIC_OPERATIONS } from "./api/operations.js";

export const CLIENT_PLUGIN_API_VERSION = 1 as const;
export const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ClientIdentity {
  vid: string;
  deviceId?: string;
}

export interface ClientLoginContext {
  previousState?: JsonValue;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  onQr(url: string, stage?: string): Promise<void> | void;
  onStatus(status: string, stage?: string): Promise<void> | void;
  onOtp(): Promise<string> | string;
}

export interface ClientOpenContext {
  state: JsonValue;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  saveState(state: JsonValue): Promise<void>;
}

export interface ClientLoginResult {
  state: JsonValue;
  identity: ClientIdentity;
}

/**
 * API v1 plugins may predate `search.suggest`. The account boundary adapts that one missing
 * operation before exposing the full canonical client to callers.
 */
type PluginCanonicalClient = Omit<CanonicalClient, "search"> & {
  readonly search: Omit<CanonicalClient["search"], "suggest"> & Partial<Pick<CanonicalClient["search"], "suggest">>;
};

export interface ClientOpenResult {
  client: PluginCanonicalClient;
  identity: ClientIdentity;
}

export interface ClientProvider {
  login(context: ClientLoginContext): Promise<ClientLoginResult>;
  open(context: ClientOpenContext): Promise<ClientOpenResult>;
}

export interface ClientPlugin {
  meta: {
    name: string;
    version: string;
    apiVersion: typeof CLIENT_PLUGIN_API_VERSION;
  };
  clients: Readonly<Record<string, ClientProvider>>;
}

export interface RegisteredClient {
  id: string;
  provider: ClientProvider;
  plugin: ClientPlugin["meta"];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function provider(value: unknown, label: string): asserts value is ClientProvider {
  if (!object(value) || typeof value.login !== "function" || typeof value.open !== "function") {
    throw new TypeError(`${label} must provide login() and open()`);
  }
}

export function validateClientPlugin(value: unknown, source = "client plugin"): ClientPlugin {
  if (!object(value) || !object(value.meta) || !object(value.clients)) {
    throw new TypeError(`${source} must default-export a client plugin descriptor`);
  }
  const { meta } = value;
  if (typeof meta.name !== "string" || !meta.name.trim()) throw new TypeError(`${source} has an invalid name`);
  if (typeof meta.version !== "string" || !meta.version.trim()) throw new TypeError(`${source} has an invalid version`);
  if (meta.apiVersion !== CLIENT_PLUGIN_API_VERSION) {
    throw new TypeError(`${source} requires unsupported client plugin API ${String(meta.apiVersion)}`);
  }
  for (const [id, candidate] of Object.entries(value.clients)) {
    if (!CLIENT_ID_PATTERN.test(id)) throw new TypeError(`${source} has invalid client id ${JSON.stringify(id)}`);
    provider(candidate, `${source} client ${JSON.stringify(id)}`);
  }
  return value as unknown as ClientPlugin;
}

export function registerClientPlugins(
  builtins: Readonly<Record<string, ClientProvider>>,
  plugins: readonly ClientPlugin[],
): ReadonlyMap<string, RegisteredClient> {
  const clients = new Map<string, RegisteredClient>();
  const add = (id: string, providerValue: ClientProvider, meta: ClientPlugin["meta"]): void => {
    if (!CLIENT_ID_PATTERN.test(id)) throw new TypeError(`invalid client id ${JSON.stringify(id)}`);
    if (clients.has(id)) throw new TypeError(`duplicate client id: ${id}`);
    provider(providerValue, `client ${JSON.stringify(id)}`);
    clients.set(id, Object.freeze({ id, provider: providerValue, plugin: Object.freeze({ ...meta }) }));
  };
  const core = { name: "weread-omni", version: PACKAGE_VERSION, apiVersion: CLIENT_PLUGIN_API_VERSION } as const;
  for (const [id, value] of Object.entries(builtins)) add(id, value, core);
  for (const candidate of plugins) {
    const plugin = validateClientPlugin(candidate);
    for (const [id, value] of Object.entries(plugin.clients)) add(id, value, plugin.meta);
  }
  return clients;
}

function importSpecifier(value: string): string {
  if (value.startsWith("file:")) return value;
  return isAbsolute(value) ? pathToFileURL(value).href : value;
}

export function pluginSpecifiers(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.WEREAD_PLUGINS ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function loadClientPlugins(specifiers: readonly string[]): Promise<ClientPlugin[]> {
  const plugins: ClientPlugin[] = [];
  for (const specifier of specifiers) {
    let module: Record<string, unknown>;
    try {
      module = (await import(importSpecifier(specifier))) as Record<string, unknown>;
    } catch (cause) {
      throw new Error(`could not load client plugin ${JSON.stringify(specifier)}`, { cause });
    }
    plugins.push(validateClientPlugin(module.default, `client plugin ${JSON.stringify(specifier)}`));
  }
  return plugins;
}

export function assertCanonicalClient(value: unknown, label = "client"): asserts value is CanonicalClient {
  if (!object(value)) throw new TypeError(`${label} must be an object`);
  for (const [resource, methods] of Object.entries(PUBLIC_OPERATIONS)) {
    const namespace = value[resource];
    if (!object(namespace)) throw new TypeError(`${label}.${resource} must be an object`);
    for (const method of methods) {
      if (typeof namespace[method] !== "function") {
        throw new TypeError(`${label}.${resource}.${method} must be callable`);
      }
    }
  }
}
