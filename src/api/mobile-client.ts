import { type Credentials, loadCredentials, saveCredentials } from "../auth/credentials.js";
import { type LoginOptions, login as qrLogin } from "../auth/qrlogin.js";
import { TokenManager, type TokenManagerOptions } from "../auth/token.js";
import { AuthError } from "../errors.js";
import type { Logger } from "../logger.js";
import { type ClientProfile, einkProfile } from "../profile.js";
import { type MobileCallOptions, MobileClient, type MobileResponse } from "./mobile.js";
import { createMobileResources, type MobileResourceDependencies } from "./resources/index.js";
import type { MobileTransport } from "./types.js";

type MobileResources = ReturnType<typeof createMobileResources>;

interface ClientSession {
  mobile: MobileClient;
  resources: MobileResources;
}

const clientSessionProviders = new WeakMap<object, () => ClientSession>();

/** @internal Captures one mobile session for a multi-call logical operation. */
export function captureClientSession(client: object): ClientSession {
  const provider = clientSessionProviders.get(client);
  if (provider) return provider();
  if (client instanceof MobileApiClient) return { mobile: client.mobile, resources: client };
  if ("mobile" in client && client.mobile && typeof client.mobile === "object") {
    return { mobile: client.mobile as MobileClient, resources: client as unknown as MobileResources };
  }
  throw new TypeError("client does not expose a mobile session");
}

/** @internal Lets a wrapping client reuse one underlying mobile session for upload/import flows. */
export function registerClientSessionProvider(client: object, provider: () => ClientSession): void {
  clientSessionProviders.set(client, provider);
}

export interface MobileApiClientOptions {
  credentials?: Credentials;
  env?: NodeJS.ProcessEnv;
  profile?: ClientProfile;
  store?: string;
  fetchImpl?: typeof fetch;
  mobileBaseUrl?: string;
  mobileTimeoutMs?: number;
  logger?: Logger;
  onCredentials?: TokenManagerOptions["onCredentials"];
  resources?: MobileResourceDependencies;
}

export class MobileApiClient {
  readonly search: MobileResources["search"];
  readonly book: MobileResources["book"];
  readonly shelf: MobileResources["shelf"];
  readonly publicAccounts: MobileResources["publicAccounts"];
  readonly notes: MobileResources["notes"];
  readonly review: MobileResources["review"];
  readonly readData: MobileResources["readData"];
  readonly discover: MobileResources["discover"];
  readonly ai: MobileResources["ai"];
  readonly import: MobileResources["import"];

  readonly #credentials?: Credentials;
  readonly #env: NodeJS.ProcessEnv;
  readonly #profile: ClientProfile;
  readonly #store: string;
  readonly #fetchImpl: typeof fetch;
  readonly #mobileBaseUrl?: string;
  readonly #mobileTimeoutMs?: number;
  readonly #logger?: Logger;
  readonly #onCredentials?: TokenManagerOptions["onCredentials"];
  #loggedInCredentials?: Credentials;
  /**
   * The `onCredentials` the current session was logged in with. Retained because that caller chose
   * where this session's secret goes; a later rotation of the SAME session falling back to the
   * constructor callback — or to the credential file — would write it somewhere they avoided.
   */
  #loginOnCredentials?: TokenManagerOptions["onCredentials"];
  #mobileClient?: MobileClient;
  #credentialEpoch = 0;
  #credentialWriteTail: Promise<void> = Promise.resolve();

  constructor(options: MobileApiClientOptions = {}) {
    this.#credentials = options.credentials ? { ...options.credentials } : undefined;
    this.#env = options.env ?? process.env;
    this.#profile = options.profile ?? einkProfile();
    // The credential file this client reads. `weread-omni login` writes accounts elsewhere, so this
    // names a file for a direct SDK client or a `createProgram` embedder -- never for the shipped
    // `weread-omni` binary, which routes through AccountManager. An explicit "" is a deliberate request
    // for the unsuffixed store and is preserved; only an absent option falls back.
    this.#store = options.store ?? "eink";
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#mobileBaseUrl = options.mobileBaseUrl;
    this.#mobileTimeoutMs = options.mobileTimeoutMs;
    this.#logger = options.logger;
    this.#onCredentials = options.onCredentials;

    const lazyMobile: MobileTransport = {
      call: <T = unknown>(method: string, path: string, callOptions?: MobileCallOptions): Promise<MobileResponse<T>> =>
        this.mobile.call<T>(method, path, callOptions),
    };
    const resourceDependencies = {
      ...options.resources,
      env: options.resources?.env ?? this.#env,
    };
    const resources = createMobileResources(lazyMobile, resourceDependencies);
    clientSessionProviders.set(this, () => {
      const mobile = this.mobile;
      return { mobile, resources: createMobileResources(mobile, resourceDependencies) };
    });
    const operationResources = (): MobileResources => {
      let mobile: MobileClient | undefined;
      const pinnedMobile: MobileTransport = {
        call: <T = unknown>(
          method: string,
          path: string,
          callOptions?: MobileCallOptions,
        ): Promise<MobileResponse<T>> => {
          mobile ??= captureClientSession(this).mobile;
          return mobile.call<T>(method, path, callOptions);
        },
      };
      return createMobileResources(pinnedMobile, resourceDependencies);
    };
    this.search = resources.search;
    this.book = resources.book;
    this.shelf = resources.shelf;
    this.publicAccounts = resources.publicAccounts;
    this.notes = resources.notes;
    this.review = resources.review;
    this.readData = resources.readData;
    this.discover = resources.discover;
    this.ai = {
      ...resources.ai,
      askBook: async (input) => operationResources().ai.askBook(input),
    };
    this.import = {
      ...resources.import,
      book: async (input) => operationResources().import.book(input),
    };
  }

  get mobile(): MobileClient {
    if (!this.#mobileClient) {
      const explicit = this.#credentials !== undefined;
      const credentials =
        this.#loggedInCredentials ??
        loadCredentials({
          credentials: this.#credentials,
          env: this.#env,
          store: this.#store,
        });
      const onCredentials =
        this.#loginOnCredentials ??
        this.#onCredentials ??
        (explicit ? undefined : (next: Credentials) => saveCredentials(next, { env: this.#env, store: this.#store }));
      const sessionEpoch = this.#credentialEpoch;
      const tokenManager = new TokenManager(credentials, {
        fetchImpl: this.#fetchImpl,
        onCredentials: onCredentials
          ? (next) =>
              this.#enqueueCredentialWrite(() => {
                if (sessionEpoch !== this.#credentialEpoch) return;
                return onCredentials(next);
              })
          : undefined,
        baseUrl: this.#mobileBaseUrl,
        timeoutMs: this.#mobileTimeoutMs,
        profile: this.#profile,
        logger: this.#logger,
      });
      this.#mobileClient = new MobileClient({
        tokenManager,
        fetchImpl: this.#fetchImpl,
        baseUrl: this.#mobileBaseUrl,
        timeoutMs: this.#mobileTimeoutMs,
        profile: this.#profile,
        logger: this.#logger,
      });
    }
    return this.#mobileClient;
  }

  async login(options: ClientLoginOptions = {}): Promise<Credentials> {
    let deviceId = options.deviceId ?? this.#loggedInCredentials?.deviceId;
    if (deviceId === undefined) {
      try {
        deviceId = loadCredentials({
          credentials: this.#credentials,
          env: this.#env,
          store: this.#store,
        }).deviceId;
      } catch (error) {
        const cause = (error as { cause?: NodeJS.ErrnoException } | null)?.cause;
        if (!(error instanceof AuthError && cause?.code === "ENOENT")) throw error;
      }
    }
    const credentials = await qrLogin({
      ...options,
      deviceId,
      fetchImpl: options.fetchImpl ?? this.#fetchImpl,
      profile: this.#profile,
    });
    const persist = options.onCredentials ?? this.#onCredentials;
    await this.#enqueueCredentialWrite(async () => {
      if (persist) {
        await persist({ ...credentials });
      } else if (this.#credentials === undefined) {
        saveCredentials(credentials, { env: this.#env, store: this.#store });
      }
      this.#credentialEpoch += 1;
      this.#loginOnCredentials = options.onCredentials;
      this.#loggedInCredentials = { ...credentials };
      this.#mobileClient = undefined;
    });
    return credentials;
  }

  #enqueueCredentialWrite(write: () => Promise<void> | void): Promise<void> {
    const queued = this.#credentialWriteTail.then(write);
    this.#credentialWriteTail = queued.catch(() => undefined);
    return queued;
  }

  reloadCredentials(): void {
    this.#credentialEpoch += 1;
    this.#loggedInCredentials = undefined;
    this.#loginOnCredentials = undefined;
    this.#mobileClient = undefined;
  }
}

export type ClientLoginOptions = Omit<LoginOptions, "profile"> & {
  onCredentials?: (credentials: Credentials) => Promise<void> | void;
};

export type EinkClientOptions = Omit<MobileApiClientOptions, "profile">;

export const createEinkClient = (options: EinkClientOptions = {}): MobileApiClient =>
  new MobileApiClient({ ...options, profile: einkProfile() });
