#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";

// Resolves to the package root from both src/cli.ts and dist/cli.js, so the shipped binary and
// doctor report identify the package that was actually published.
const CLI_METADATA: { package: string; version: string } = (() => {
  try {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
    return {
      package: typeof manifest.name === "string" ? manifest.name : "weread-omni",
      version: typeof manifest.version === "string" ? manifest.version : "0.0.0",
    };
  } catch {
    return { package: "weread-omni", version: "0.0.0" };
  }
})();

import { AccountManager, type AccountSummary, type OpenAccount } from "./accounts.js";
import type { CanonicalClient } from "./api/client.js";
import { createEinkClient, type MobileApiClient } from "./api/mobile-client.js";
import { isAmbiguousImportOutcome } from "./api/resources/import.js";
import type { PublicAccountLibrary, PublicAccountLibraryMode } from "./api/types.js";
import { loadCredentials, storePath } from "./auth/credentials.js";
import {
  CLI_OPERATIONS,
  type CliClientFor,
  type CliOperation,
  type CliOperationsClient,
  type CommandContext,
  human,
  registerReadCommands,
  registerWriteCommands,
  retainCliOperations,
} from "./cli/commands.js";
import { type OutputWriter, output } from "./cli/output.js";
import { applyConnectAttemptTimeout, connectAttemptTimeoutMs } from "./connect-timeout.js";
import { AuthError, TransportError, WeReadApiError } from "./errors.js";
import { withContentLibrary } from "./library/cached-client.js";
import { libraryRoot } from "./library/paths.js";
import { ContentLibrary } from "./library/store.js";
import { gateDisabledMessage, operationEnabled, operationGate } from "./operation-policy.js";
import { loadClientPlugins, pluginSpecifiers } from "./plugin.js";
import { PublicAccountArtifactError } from "./public-accounts.js";
import { redact, stripErrorPrefix } from "./redact.js";

const loginRecoveryHint = (store: string): string => {
  const selector = STORE_NAME.test(store) ? ` --account ${store}` : "";
  return `Run weread-omni${selector} login --json, scan the QR codes, then retry.`;
};

function authRecoveryHint(error: AuthError, store: string, loginSupported: boolean): string {
  if (!loginSupported) {
    return `Re-authenticate store ${JSON.stringify(store)} through the client that supplies it, then retry.`;
  }
  return /(?:credentials .*not valid JSON|credentials .*could not be read|(?:incomplete|invalid) (?:environment|file) credentials|invalid credential store name)/i.test(
    error.message,
  )
    ? `Correct or remove the invalid credential source, then ${loginRecoveryHint(store).replace(/^Run /, "run ")}`
    : loginRecoveryHint(store);
}

export type { Command } from "commander";
// A terminal ANSI renderer, so it belongs to the terminal surface. It was a root SDK export, where
// it promised something an SDK consumer cannot use: it writes half-block glyphs to `process.stderr`,
// and nothing an SDK embeds has a terminal attached. The `./cli` subpath already exists, so this
// costs no new permanent contract.
export { printQr } from "./auth/qr-terminal.js";
export type { CliOperationsClient, CommandContext } from "./cli/commands.js";
// Values an extension needs so its commands print and parse identically to the built-in ones.
// Without these an extension has to reimplement them, which is how the two surfaces drift apart.
export { integer, port } from "./cli/commands.js";
export type { OutputOptions, OutputWriter } from "./cli/output.js";
export { output } from "./cli/output.js";

export interface CliIdentity {
  vid: string;
  deviceId: string;
  source: "environment" | "file";
}

export interface CliStoreIdentity {
  vid?: string;
  deviceId?: string;
  source?: CliIdentity["source"];
}

export interface CliStore {
  readonly name: string;
  readonly backend: string;
  readonly clientProfile?: string;
  readonly client: CliOperationsClient;
  readonly readIdentity?: () => CliStoreIdentity | Promise<CliStoreIdentity>;
}

export type ExtendProgram<TClient extends CliOperationsClient = MobileApiClient> = (
  program: Command,
  context: CommandContext<TClient>,
) => void;

export interface CliStoreCommandContext {
  getStore: () => CliStore;
  stdout: OutputWriter;
  confirm: (message: string) => Promise<boolean>;
  isTTY: boolean;
  signal?: AbortSignal;
}

export type ExtendStoreProgram = (program: Command, context: CliStoreCommandContext) => void;

export interface CliDependencies<TClient extends CliOperationsClient = MobileApiClient> {
  getClient?: () => TClient;
  stores?: readonly CliStore[];
  stdout?: OutputWriter;
  stderr?: OutputWriter;
  env?: NodeJS.ProcessEnv;
  store?: string;
  renderQr?: (text: string) => Promise<string | undefined>;
  getIdentity?: () => CliIdentity;
  confirm?: (message: string) => Promise<boolean>;
  isTTY?: boolean;
  signal?: AbortSignal;
  extendProgram?: ExtendProgram<TClient>;
  extendStoreProgram?: ExtendStoreProgram;
  /** Account mode is explicit so SDK imports never load environment plugins. */
  accountManager?: AccountManager;
  /**
   * The open content library, when there is one.
   *
   * Passed separately from the client because article bodies are fetched by module-private
   * helpers inside the public-account paths, which a client decorator cannot reach.
   */
  library?: PublicAccountLibrary;
  /** Whether stored articles are read. `--refresh` still writes; it only declines to read. */
  libraryMode?: PublicAccountLibraryMode;
}

interface NormalizedCliStore {
  readonly store: CliStore;
  readonly operations: ReadonlySet<CliOperation>;
}

const STORE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const operationMember = (client: CliOperationsClient, operation: CliOperation): unknown => {
  const [resource, method] = operation.split(".") as [keyof CliOperationsClient, string];
  const namespace = client[resource];
  return namespace && typeof namespace === "object" ? (namespace as Record<string, unknown>)[method] : undefined;
};

function normalizeCliStores(stores: readonly CliStore[]): readonly NormalizedCliStore[] {
  if (stores.length === 0) throw new Error("CLI stores must contain at least one store");
  const names = new Set<string>();
  return Object.freeze(
    stores.map((store) => {
      if (!STORE_NAME.test(store.name)) {
        throw new Error(
          `invalid CLI store name ${JSON.stringify(store.name)}: use letters, digits, "-" or "_" (max 64)`,
        );
      }
      if (names.has(store.name)) throw new Error(`duplicate CLI store name: ${store.name}`);
      names.add(store.name);
      if (typeof store.backend !== "string" || !store.backend.trim()) {
        throw new Error(`CLI store ${JSON.stringify(store.name)} needs a backend label`);
      }
      if (
        store.clientProfile !== undefined &&
        (typeof store.clientProfile !== "string" || !store.clientProfile.trim())
      ) {
        throw new Error(`CLI store ${JSON.stringify(store.name)} has a blank clientProfile`);
      }
      if (!store.client || typeof store.client !== "object") {
        throw new Error(`CLI store ${JSON.stringify(store.name)} needs an operations client`);
      }
      if (store.readIdentity !== undefined && typeof store.readIdentity !== "function") {
        throw new Error(`CLI store ${JSON.stringify(store.name)} readIdentity must be callable`);
      }
      const operations = new Set<CliOperation>();
      for (const operation of CLI_OPERATIONS) {
        const [resource] = operation.split(".") as [keyof CliOperationsClient];
        const namespace = store.client[resource];
        if (namespace !== undefined && (!namespace || typeof namespace !== "object")) {
          throw new Error(`CLI store ${JSON.stringify(store.name)} client.${String(resource)} must be an object`);
        }
        const method = operationMember(store.client, operation);
        if (method === undefined) continue;
        if (typeof method !== "function") {
          throw new Error(`CLI store ${JSON.stringify(store.name)} client.${operation} must be callable`);
        }
        operations.add(operation);
      }
      return {
        store: Object.freeze({ ...store }),
        operations,
      };
    }),
  );
}

function requireOperations<const Operations extends readonly [CliOperation, ...CliOperation[]]>(
  client: CliOperationsClient,
  store: string,
  env: NodeJS.ProcessEnv,
  ...operations: Operations
): CliClientFor<Operations[number]> {
  for (const operation of operations) {
    const gate = operationGate(operation);
    if (gate && !operationEnabled(operation, env)) throw new Error(gateDisabledMessage(gate));
    if (typeof operationMember(client, operation) !== "function") {
      throw new Error(`store ${JSON.stringify(store)} does not support ${operation}`);
    }
  }
  // The runtime checks above narrow every requested member before a built-in can reach it.
  return client as CliClientFor<Operations[number]>;
}

const selectedStores = (command: Command): readonly string[] => {
  const options = command.optsWithGlobals();
  const selected = options.account;
  return Array.isArray(selected) ? selected.filter((value): value is string => typeof value === "string") : [];
};

const collectStore = (value: string, previous: readonly string[] = []): readonly string[] => [...previous, value];

const projectStoreIdentity = (identity: CliStoreIdentity): CliStoreIdentity => ({
  ...(typeof identity.vid === "string" && identity.vid ? { vid: identity.vid } : {}),
  ...(typeof identity.deviceId === "string" && identity.deviceId ? { deviceId: identity.deviceId } : {}),
  ...(identity.source === "environment" || identity.source === "file" ? { source: identity.source } : {}),
});

function jsonError(error: unknown, message: string, store: string, loginSupported: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = { error: message };
  if (error instanceof AuthError) {
    payload.cli = CLI_METADATA;
    payload.hint = authRecoveryHint(error, store, loginSupported);
  } else if (error instanceof WeReadApiError) {
    if (error.errCode !== undefined) payload.errCode = error.errCode;
    payload.status = error.status;
    payload.path = error.path;
    // The whole point of `ambiguous` is that a machine consumer must not blindly retry; leaving
    // it out of the structured payload forces them to parse prose to find that out.
    if (error.ambiguous) payload.ambiguous = true;
  } else if (error instanceof TransportError) {
    // Same contract, third taxonomy: a write lost in flight, or whose response was cut off, may
    // still have landed. It carries no status or path, so `ambiguous` is the whole of what a
    // machine consumer can act on — and reading it only off `WeReadApiError` left it as prose.
    if (error.ambiguous) payload.ambiguous = true;
  } else if (isAmbiguousImportOutcome(error)) {
    // `weread-omni import book` can fail after `/cos/notify` with the book still created. Same
    // must-not-retry contract as above, different error taxonomy.
    payload.ambiguous = true;
    payload.phase = error.phase;
  } else if (error instanceof PublicAccountArtifactError) {
    payload.code = error.code;
    payload.path = error.path;
    if (error.incomplete) payload.incomplete = true;
    if (error.incompletePath) payload.incompletePath = error.incompletePath;
    if (error.authenticationHint) {
      payload.authenticationHint = loginSupported
        ? loginRecoveryHint(store)
        : `Re-authenticate store ${JSON.stringify(store)} through the client that supplies it, then retry.`;
    }
    if (error.status !== undefined) payload.upstreamStatus = error.status;
    if (error.upstreamPath) payload.upstreamPath = error.upstreamPath;
    if (error.errCode !== undefined) payload.errCode = error.errCode;
    if (error.ambiguous) payload.ambiguous = true;
  }
  return payload;
}

export function createProgram<TClient extends CliOperationsClient = MobileApiClient>(
  dependencies: CliDependencies<TClient> = {},
): Command {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const env = dependencies.env ?? process.env;
  const policyEnv = { ...env };
  const accountManager = dependencies.accountManager;
  const registryMode = dependencies.stores !== undefined;
  // `store` names the default registry entry when a command omits `--account`. It used to be
  // rejected here because it also selected a credential file, which a registry never reads; with
  // that meaning gone it is the only way an embedder can point at a default, so it is allowed.
  if (
    registryMode &&
    (dependencies.getClient !== undefined ||
      dependencies.getIdentity !== undefined ||
      dependencies.extendProgram !== undefined)
  ) {
    throw new Error("CLI stores cannot be mixed with getClient, getIdentity, or extendProgram");
  }
  if (!registryMode && dependencies.extendStoreProgram !== undefined) {
    throw new Error("extendStoreProgram requires CLI stores");
  }
  const registry = registryMode ? normalizeCliStores(dependencies.stores as readonly CliStore[]) : undefined;
  const registryByName = new Map(registry?.map((entry) => [entry.store.name, entry]));
  const fallbackStore = dependencies.store ?? "eink";
  const renderQr =
    dependencies.renderQr ??
    (async (url: string) => {
      const { default: qrcode } = await import("qrcode-terminal");
      return new Promise<string>((resolve) => qrcode.generate(url, { small: true }, resolve));
    });
  const confirm =
    dependencies.confirm ??
    (async (message: string) => {
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return /^(?:y|yes)$/i.test((await prompt.question(`${message} [y/N] `)).trim());
      } finally {
        prompt.close();
      }
    });
  const isTTY = dependencies.isTTY ?? process.stdin.isTTY === true;
  const program = new Command()
    .name("weread-omni")
    .description("WeChat Reading command line interface")
    .version(CLI_METADATA.version, "-V, --version", "print the installed version")
    .option("--json", "write raw JSON")
    .option("--account <name>", "select a configured account", collectStore)
    .option("--no-library", "do not read or write the local content library")
    .option("--refresh", "refetch content even when the local library holds it")
    .configureOutput({
      writeOut: (text) => stdout.write(text),
      writeErr: (text) => {
        if (text.startsWith("Usage:") && !program.opts().json) stdout.write(text);
      },
    })
    .exitOverride();

  const explicitStores = (command: Command = program): readonly string[] => selectedStores(command);
  const selectedStore = (command: Command = program): string => explicitStores(command)[0] ?? fallbackStore;
  const selectedRegistryEntry = (command: Command = program): NormalizedCliStore => {
    const name = selectedStore(command);
    const entry = registryByName.get(name);
    if (!entry) throw new Error(`unknown CLI store ${JSON.stringify(name)}`);
    return entry;
  };

  const fixedInjectedClient = dependencies.getClient !== undefined || dependencies.getIdentity !== undefined;
  const getClient = (dependencies.getClient ??
    (() => createEinkClient({ env, store: selectedStore() }))) as () => TClient;
  const getIdentity =
    dependencies.getIdentity ??
    (() => {
      const store = selectedStore();
      const credentials = loadCredentials({ env, store });
      return {
        vid: credentials.vid,
        deviceId: credentials.deviceId,
        source: existsSync(storePath(env, store)) ? ("file" as const) : ("environment" as const),
      };
    });
  const readIdentity = async (): Promise<CliStoreIdentity> => {
    if (!registry) return getIdentity();
    const reader = selectedRegistryEntry().store.readIdentity;
    if (!reader) throw new Error(`store ${JSON.stringify(selectedStore())} does not expose identity`);
    return projectStoreIdentity(await reader());
  };

  program.hook("preAction", (_root, action) => {
    const explicit = explicitStores(action);
    for (const name of explicit) {
      if (!STORE_NAME.test(name)) {
        throw new Error(`invalid CLI store name ${JSON.stringify(name)}: use letters, digits, "-" or "_" (max 64)`);
      }
    }
    if (["login", "accounts", "clients"].includes(action.name()) && action.parent === program) return;
    if (action.parent?.name() === "accounts" && action.parent.parent === program) return;
    if (explicit.length > 1) throw new Error("ordinary CLI commands accept exactly one --account");
    if (registry) {
      selectedRegistryEntry(action);
      return;
    }
    storePath(env, selectedStore(action));
    if (fixedInjectedClient && explicit.length === 1 && explicit[0] !== fallbackStore) {
      throw new Error(
        `injected CLI client is fixed to store ${JSON.stringify(fallbackStore)} and cannot select ${JSON.stringify(explicit[0])}`,
      );
    }
  });

  const getClientFor = <const Operations extends readonly [CliOperation, ...CliOperation[]]>(
    ...operations: Operations
  ): CliClientFor<Operations[number]> => {
    for (const operation of operations) {
      const gate = operationGate(operation);
      if (gate && !operationEnabled(operation, policyEnv)) throw new Error(gateDisabledMessage(gate));
    }
    if (registry) {
      const entry = selectedRegistryEntry();
      return requireOperations(entry.store.client, entry.store.name, policyEnv, ...operations);
    }
    return requireOperations(getClient(), selectedStore(), policyEnv, ...operations);
  };

  const visibleOperations = new Set<CliOperation>(
    CLI_OPERATIONS.filter(
      (operation) =>
        operationEnabled(operation, policyEnv) &&
        (!registry || registry.some((entry) => entry.operations.has(operation))),
    ),
  );

  if (accountManager) {
    const accountAlias = (command: Command, create: boolean): string => {
      const explicit = explicitStores(command);
      if (explicit.length > 1) throw new Error("this command accepts exactly one --account");
      if (explicit[0]) return explicit[0];
      const configured = accountManager.accounts();
      if (configured.length === 1) return configured[0]?.account as string;
      if (configured.length === 0 && create) return "default";
      if (configured.length === 0) throw new Error("no WeRead accounts are configured; run weread-omni login");
      const preferred = accountManager.defaultAccount();
      if (preferred !== undefined) return preferred;
      throw new Error(
        `multiple WeRead accounts are configured (${configured.map(({ account }) => account).join(", ")}); pass --account, or set a default with "weread-omni accounts use <alias>"`,
      );
    };
    const accounts = program.command("accounts").description("List configured accounts");
    accounts.action((_options, command) => {
      const configured = accountManager.accounts();
      const preferred = accountManager.defaultAccount();
      const rows = configured.map((entry) => ({ ...entry, default: entry.account === preferred }));
      output(rows, { json: Boolean(command.optsWithGlobals().json), stdout }, (values) =>
        values.length === 0
          ? "No accounts configured"
          : values
              .map(({ account, client, default: isDefault }) => `${isDefault ? "*" : " "} ${account}\t${client}`)
              .join("\n"),
      );
    });
    accounts
      .command("use")
      .description("Set the account used when no --account is given")
      .argument("<alias>", "account alias")
      .action((alias: string, _options, command) => {
        const summary = accountManager.setDefaultAccount(alias);
        output(
          { ...summary, default: true },
          { json: Boolean(command.optsWithGlobals().json), stdout },
          (value) => `default account is now ${value.account}`,
        );
      });
    program
      .command("clients")
      .description("List available client providers")
      .action((_options, command) => {
        const clients = accountManager.clients();
        output(clients, { json: Boolean(command.optsWithGlobals().json), stdout }, (values) =>
          values.map(({ client, plugin, version }) => `${client}\t${plugin}@${version}`).join("\n"),
        );
      });
    program
      .command("login")
      .description("Log in and bind an account to a client")
      .option("--client <id>", "client provider to use")
      .action(async (options: { client?: string }, command) => {
        const account = accountAlias(command, true);
        const result = await accountManager.login(account, {
          client: options.client,
          signal: dependencies.signal,
          onQr: async (url, stage) => {
            if (stage) stderr.write(`${stage} login:\n`);
            const rendered = await renderQr(url);
            if (rendered) stderr.write(`${rendered.replace(/\n+$/, "")}\n`);
          },
          onStatus: (status, stage) => {
            stderr.write(`${stage ? `${stage}: ` : ""}${status}\n`);
          },
          onOtp: async () => {
            if (!isTTY) throw new AuthError("this client requires a four-digit OTP from an interactive terminal");
            const prompt = createInterface({ input: process.stdin, output: process.stderr });
            try {
              return (await prompt.question("Login OTP: ")).trim();
            } finally {
              prompt.close();
            }
          },
        });
        output(
          result,
          { json: Boolean(command.optsWithGlobals().json), stdout },
          (value) => `Logged in ${value.account} as ${value.vid} with ${value.client}`,
        );
      });
  }

  if (!registry || registry.some(({ store }) => store.readIdentity !== undefined)) {
    program
      .command("whoami")
      .description("Show the active credential identity")
      .action(async (_options, command) => {
        const identity = await readIdentity();
        output(identity, { json: Boolean(command.optsWithGlobals().json), stdout }, (value) => {
          const head = `${value.vid ?? "Identity unavailable"}${value.source ? ` (${value.source})` : ""}`;
          return value.deviceId ? `${head}\nDevice: ${value.deviceId}` : head;
        });
      });
  }

  if (
    !registry ||
    registry.some(({ store, operations }) => store.readIdentity !== undefined && operations.has("shelf.sync"))
  ) {
    program
      .command("doctor")
      .description("Check authentication and configuration")
      .action(async (_options, command) => {
        if (registry && !selectedRegistryEntry(command).store.readIdentity) {
          throw new Error(`store ${JSON.stringify(selectedStore(command))} does not expose identity`);
        }
        await getClientFor("shelf.sync").shelf.sync();
        const identity = await readIdentity();
        const report = {
          ok: true,
          cli: CLI_METADATA,
          auth: { status: "authenticated", ...identity },
          config: {
            credentialPath: registry ? null : storePath(env, selectedStore(command)),
            connectAttemptTimeoutMs: connectAttemptTimeoutMs(env) ?? null,
          },
        };
        output(report, { json: Boolean(command.optsWithGlobals().json), stdout }, ({ cli, auth, config }) => {
          const timeout =
            config.connectAttemptTimeoutMs === null ? "Node default" : `${config.connectAttemptTimeoutMs} ms`;
          return [
            `CLI: ${cli.package} ${cli.version}`,
            auth.vid
              ? `Authentication: ${auth.status} as ${auth.vid}`
              : `Authentication: ${auth.status} (identity unavailable)`,
            ...(auth.source ? [`Credential source: ${auth.source}`] : []),
            ...(config.credentialPath ? [`Credential path: ${config.credentialPath}`] : []),
            ...(auth.deviceId ? [`Device: ${auth.deviceId}`] : []),
            `Configured connect attempt timeout: ${timeout}`,
          ].join("\n");
        });
      });
  }

  const builtinContext = {
    getClientFor,
    stdout,
    confirm,
    isTTY,
    ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    ...(dependencies.library ? { library: dependencies.library } : {}),
    ...(dependencies.libraryMode ? { libraryMode: dependencies.libraryMode } : {}),
  };
  const artifactCapable =
    !registry ||
    registry.some(
      ({ operations }) =>
        operations.has("publicAccounts.articles") &&
        operations.has("publicAccounts.paidContent") &&
        operations.has("review.single"),
    );
  registerReadCommands(
    program,
    !artifactCapable
      ? builtinContext
      : {
          ...builtinContext,
          getFullClientFor: (
            ...operations: CliOperation[]
          ): Pick<import("./api/client.js").CanonicalClient, "publicAccounts" | "review"> => {
            if (registry) {
              const entry = selectedRegistryEntry();
              if (operations.length > 0) {
                requireOperations(
                  entry.store.client,
                  entry.store.name,
                  policyEnv,
                  operations[0] as CliOperation,
                  ...operations.slice(1),
                );
              }
              return entry.store.client as Pick<import("./api/client.js").CanonicalClient, "publicAccounts" | "review">;
            }
            const client = getClient();
            if (operations.length > 0) {
              requireOperations(
                client,
                selectedStore(),
                policyEnv,
                operations[0] as CliOperation,
                ...operations.slice(1),
              );
            }
            return client as Pick<import("./api/client.js").CanonicalClient, "publicAccounts" | "review">;
          },
        },
  );
  registerWriteCommands(program, builtinContext);
  retainCliOperations(program, visibleOperations);

  if (registry) {
    const storeContext: CliStoreCommandContext = {
      getStore: () => selectedRegistryEntry().store,
      stdout,
      confirm,
      isTTY,
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    };
    dependencies.extendStoreProgram?.(program, storeContext);
  } else {
    const commandContext: CommandContext<TClient> = {
      getClient,
      stdout,
      confirm,
      isTTY,
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    };
    dependencies.extendProgram?.(program, commandContext);
  }

  registerLibraryCommands(program, { env, stdout, readIdentity });

  return program;
}

/**
 * Local-library maintenance.
 *
 * These are lifecycle commands like `accounts` and `doctor`, not canonical operations: they touch
 * only the local store and never reach WeRead, so they are registered outside the operation table.
 */
function registerLibraryCommands(
  program: Command,
  context: {
    env: NodeJS.ProcessEnv;
    stdout: OutputWriter;
    readIdentity: (command?: Command) => Promise<CliStoreIdentity>;
  },
): void {
  const library = program.command("library").description("Inspect the local content library");
  const json = (command: Command): boolean => command.optsWithGlobals().json === true;

  library
    .command("path")
    .description("Print where downloaded content is stored")
    .action((_options, command: Command) => {
      const root = libraryRoot(context.env);
      output({ path: root, exists: existsSync(root) }, { json: json(command), stdout: context.stdout }, human);
    });

  library
    .command("status")
    .description("Summarise what the local content library holds")
    .action(async (_options, command: Command) => {
      const store = await openForMaintenance(context, command);
      try {
        output({ path: store.root, ...store.stats() }, { json: json(command), stdout: context.stdout }, human);
      } finally {
        store.close();
      }
    });

  library
    .command("verify")
    .description("Check the local content library for damage")
    .action(async (_options, command: Command) => {
      const store = await openForMaintenance(context, command);
      try {
        const report = await store.verify();
        output(report, { json: json(command), stdout: context.stdout }, human);
        if (!report.ok) throw new Error("the content library reported problems");
      } finally {
        store.close();
      }
    });
}

async function openForMaintenance(
  context: { env: NodeJS.ProcessEnv; readIdentity: (command?: Command) => Promise<CliStoreIdentity> },
  command: Command,
): Promise<ContentLibrary> {
  const identity = await context.readIdentity(command);
  if (!identity.vid) throw new Error("the selected account does not expose an identity");
  return ContentLibrary.open({ vid: identity.vid, env: context.env });
}

export async function runCli<TClient extends CliOperationsClient = MobileApiClient>(
  argv: string[] = process.argv,
  dependencies: CliDependencies<TClient> = {},
): Promise<number> {
  const stderr = dependencies.stderr ?? process.stderr;
  // Constructed inside the try: a throw from createProgram used to reject runCli itself, and the
  // entry point below has no catch, so it surfaced as an unhandled rejection.
  let program: Command | undefined;
  try {
    program = createProgram(dependencies);
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) return 0;
      if (error.code === "commander.help") {
        if (!program?.opts().json) return 0;
        stderr.write(`${JSON.stringify({ error: "missing command" })}\n`);
        return 1;
      }
    }
    // Ask the parser, not the raw argv: a positional argument that merely looks like the flag
    // (weread-omni shelf delete -- --json) must not switch the error format. The argv fallback applies
    // only when construction failed, so there is no parser to ask.
    const json = program ? Boolean(program.opts().json) : argv.includes("--json");
    const message = stripErrorPrefix(redact(error instanceof Error ? error.message : String(error)));
    const store = (program ? selectedStores(program)[0] : undefined) ?? dependencies.store ?? "eink";
    const loginSupported = dependencies.accountManager !== undefined;
    const hint =
      error instanceof AuthError
        ? authRecoveryHint(error, store, loginSupported)
        : error instanceof PublicAccountArtifactError
          ? error.authenticationHint
            ? loginSupported
              ? loginRecoveryHint(store)
              : `Re-authenticate store ${JSON.stringify(store)} through the client that supplies it, then retry.`
            : undefined
          : undefined;
    stderr.write(
      json
        ? `${JSON.stringify(jsonError(error, message, store, loginSupported))}\n`
        : `Error: ${message}${hint ? `\nHint: ${hint}` : ""}\n`,
    );
    return error instanceof CommanderError && error.exitCode > 0 ? error.exitCode : 1;
  }
}

function rootArguments(argv: readonly string[]): { command?: string; accounts: string[] } {
  const accounts: string[] = [];
  let command: string | undefined;
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index] as string;
    const selected = /^--account=(.+)$/.exec(value);
    if (selected?.[1]) {
      accounts.push(selected[1]);
      continue;
    }
    if (value === "--account") {
      const name = argv[index + 1];
      if (name !== undefined) {
        accounts.push(name);
        index += 1;
      }
      continue;
    }
    if (!command && !value.startsWith("-")) command = value;
  }
  return { command, accounts };
}

export interface AccountCliDependencies extends Omit<CliDependencies, "accountManager" | "stores" | "getClient"> {
  accountManager: AccountManager;
  /** Choose an account when an interactive command has several candidates and no default. */
  selectAccount?: AccountSelector;
}

export type AccountSelector = (accounts: readonly AccountSummary[]) => Promise<string> | string;

async function promptForAccount(accounts: readonly AccountSummary[], stderr: OutputWriter): Promise<string> {
  stderr.write("Multiple WeRead accounts are configured:\n");
  for (const [index, { account, client }] of accounts.entries()) {
    stderr.write(`  ${index + 1}. ${account} (${client})\n`);
  }

  const prompt = createInterface({
    input: process.stdin,
    // readline writes the question to `output`, and never writes anything but a string there, so a
    // one-method adapter is enough to keep the question on the same channel as the list above.
    output: { write: (chunk: string) => stderr.write(chunk) } as NodeJS.WritableStream,
    terminal: false,
  });
  // `question()` never settles when stdin reaches EOF -- Ctrl-D, or a closed pipe -- so without
  // this the CLI would hang forever and the `finally` below would never run. `close` does fire, so
  // it aborts the pending question and the catch turns that into an ordinary refusal.
  const cancelled = new AbortController();
  prompt.once("close", () => cancelled.abort());
  try {
    const answer = (
      await prompt.question("Select an account by number or alias: ", { signal: cancelled.signal })
    ).trim();
    // An alias made of digits is still an alias; the list position is only the fallback reading.
    const selected =
      accounts.find(({ account }) => account === answer) ??
      (/^\d+$/.test(answer) ? accounts[Number(answer) - 1] : undefined);
    if (!selected) throw new AuthError(`unknown account selection ${JSON.stringify(answer)}`);
    return selected.account;
  } catch (error) {
    if (cancelled.signal.aborted) throw new AuthError("no account was selected");
    throw error;
  } finally {
    prompt.close();
  }
}

export async function runAccountCli(
  argv: string[] = process.argv,
  dependencies: AccountCliDependencies,
): Promise<number> {
  const stderr = dependencies.stderr ?? process.stderr;
  let library: AttachedLibrary | undefined;
  try {
    const parsed = rootArguments(argv);
    let effectiveArgv = argv;
    // `library path` only resolves an environment path, so requiring an account would make it fail
    // exactly when someone is trying to find out where their content went -- before logging in, or
    // with several accounts and no default.
    const accountFree = parsed.command === "library" && argv.includes("path");
    const management =
      parsed.command === undefined ||
      accountFree ||
      ["login", "accounts", "clients"].includes(parsed.command) ||
      argv.includes("--help") ||
      argv.includes("-h") ||
      argv.includes("--version") ||
      argv.includes("-V");
    let stores: readonly CliStore[] | undefined;
    if (!management) {
      // Asking is the last resort: only when nothing else picks the account -- no --account, more
      // than one configured, no recorded default -- and only when someone is there to answer.
      //
      // `--json` disqualifies a caller even from a terminal. It declares the output machine-read,
      // the same way it already forces `--yes` on destructive commands, and a caller piping JSON
      // into another program still inherits the terminal's stdin: without this check that pipeline
      // blocks on a question nobody sees. Such callers keep the old "pass --account" error.
      //
      // Commander has not parsed yet here, so `--json` is read from argv the way the flags below are.
      const interactive =
        parsed.accounts.length === 0 &&
        !argv.includes("--json") &&
        (dependencies.isTTY ?? process.stdin.isTTY === true);
      const candidates = interactive ? dependencies.accountManager.accounts() : [];
      const shouldPrompt = candidates.length > 1 && dependencies.accountManager.defaultAccount() === undefined;
      const selectAccount = dependencies.selectAccount ?? ((accounts) => promptForAccount(accounts, stderr));
      const selected = dependencies.accountManager.select(
        shouldPrompt ? [await selectAccount(candidates)] : parsed.accounts,
      );
      if (selected.length !== 1) throw new AuthError("ordinary CLI commands accept exactly one account");
      const opened: OpenAccount = await dependencies.accountManager.open(selected[0] as string);
      // Commander has not parsed yet at this point, so the flags are read from argv directly --
      // the same approach the management check above uses for --help and --version.
      library = await attachContentLibrary(opened, {
        // `library` commands manage the store directly, so wrapping the client for them would open
        // a second connection in the same process for no benefit.
        disabled: argv.includes("--no-library") || parsed.command === "library",
        refresh: argv.includes("--refresh"),
        env: dependencies.env ?? process.env,
        stderr,
      });
      stores = [
        {
          name: opened.account,
          backend: opened.client,
          clientProfile: opened.client,
          client: library?.client ?? opened.canonical,
          readIdentity: () => ({ ...opened.identity, source: "file" as const }),
        },
      ];
      if (parsed.accounts.length === 0) {
        effectiveArgv = [argv[0] ?? "node", argv[1] ?? "weread-omni", "--account", opened.account, ...argv.slice(2)];
      }
    }
    return await runCli(effectiveArgv, {
      ...dependencies,
      accountManager: dependencies.accountManager,
      ...(stores ? { stores } : {}),
      ...(library ? { library: library.store, libraryMode: library.mode } : {}),
    });
  } catch (error) {
    const message = stripErrorPrefix(redact(error instanceof Error ? error.message : String(error)));
    stderr.write(argv.includes("--json") ? `${JSON.stringify({ error: message })}\n` : `Error: ${message}\n`);
    return 1;
  } finally {
    library?.close();
  }
}

interface AttachedLibrary {
  client: CanonicalClient;
  store: ContentLibrary;
  mode: PublicAccountLibraryMode;
  close(): void;
}

/**
 * Open the local content library and wrap the account's client with it.
 *
 * Returns undefined whenever the library cannot be used, so an unusable store costs a warning and
 * a repeated download rather than the command itself. The only thing written to stdout is the
 * command's own output; the first-run notice goes to stderr.
 */
async function attachContentLibrary(
  opened: OpenAccount,
  options: { disabled: boolean; refresh: boolean; env: NodeJS.ProcessEnv; stderr: OutputWriter },
): Promise<AttachedLibrary | undefined> {
  if (options.disabled) return undefined;
  const root = libraryRoot(options.env);
  const announce = !existsSync(root);
  try {
    // The store's own diagnostics -- a blob failing verification, a database that could not be
    // locked down -- are otherwise discarded, and they are the ones a user can act on.
    const logger = { warn: (message: string) => options.stderr.write(`Warning: ${message}\n`) };
    const library = await ContentLibrary.open({ vid: opened.identity.vid, env: options.env, logger });
    if (announce) options.stderr.write(`Storing downloaded content in ${root} (disable with --no-library)\n`);
    return {
      client: withContentLibrary(opened.canonical, {
        library,
        mode: options.refresh ? "refresh" : "prefer",
        logger,
      }),
      store: library,
      mode: options.refresh ? "refresh" : "prefer",
      close: () => library.close(),
    };
  } catch (error) {
    const message = stripErrorPrefix(redact(error instanceof Error ? error.message : String(error)));
    options.stderr.write(`Warning: continuing without the content library: ${message}\n`);
    return undefined;
  }
}

async function runCliMain(argv: string[] = process.argv): Promise<number> {
  const plugins = await loadClientPlugins(pluginSpecifiers());
  return runAccountCli(argv, { accountManager: new AccountManager({ plugins }) });
}

/**
 * Stop `node:sqlite`'s experimental notice from appearing on every invocation.
 *
 * Node prints warnings from its own listener, so adding one does not replace it -- the listener has
 * to be removed and the printing re-implemented. That takes over the process-wide warning channel,
 * which is why this is confined to the binary and never runs for an SDK embedder: `runCli` and
 * `createProgram` leave the caller's diagnostics alone.
 *
 * Matching on both the name and the message keeps the suppression to this one notice, so an
 * unrelated experimental or deprecation warning still reaches the user. Node 24 does not emit it at
 * all, where this becomes a no-op.
 */
function silenceSqliteExperimentalWarning(): void {
  // Node installs its printer only when warnings are enabled. Replacing it unconditionally would
  // start printing for users who had asked for silence -- the opposite of the intent.
  if (process.noDeprecation === true || process.env.NODE_NO_WARNINGS === "1") return;
  if (process.execArgv.includes("--no-warnings")) return;
  if (process.listenerCount("warning") === 0) return;
  process.removeAllListeners("warning");
  process.on("warning", (warning: Error) => {
    if (warning.name === "ExperimentalWarning" && warning.message.includes("SQLite")) return;
    const trace = process.execArgv.includes("--trace-warnings");
    process.stderr.write(
      trace && warning.stack
        ? `(node:${process.pid}) ${warning.stack}\n`
        : `(node:${process.pid}) ${warning.name}: ${warning.message}\n`,
    );
  });
}

export function isMain(moduleUrl: string = import.meta.url, entry: string | undefined = process.argv[1]): boolean {
  if (!entry) return false;
  if (pathToFileURL(entry).href === moduleUrl) return true;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isMain()) {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  // Only here, never from createProgram/runCli: those are exported, and an embedder that calls
  // them has not handed over its process-wide networking defaults. See connect-timeout.ts.
  applyConnectAttemptTimeout();
  silenceSqliteExperimentalWarning();
  runCliMain()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `Error: ${stripErrorPrefix(redact(error instanceof Error ? error.message : String(error)))}\n`,
      );
      process.exitCode = 1;
    });
}
