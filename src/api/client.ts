import { captureClientSession, type MobileApiClient, registerClientSessionProvider } from "./mobile-client.js";

export type CanonicalBook = MobileApiClient["book"];

/** Structural full-client contract shared by the canonical client and extension clients. */
export interface CanonicalClient {
  readonly search: MobileApiClient["search"];
  readonly book: CanonicalBook;
  readonly shelf: MobileApiClient["shelf"];
  readonly publicAccounts: MobileApiClient["publicAccounts"];
  readonly notes: MobileApiClient["notes"];
  readonly review: MobileApiClient["review"];
  readonly readData: MobileApiClient["readData"];
  readonly discover: MobileApiClient["discover"];
  readonly ai: MobileApiClient["ai"];
  readonly import: MobileApiClient["import"];
}

export interface WeReadClientOptions {
  eink: MobileApiClient;
}

/**
 * The canonical account client.
 *
 * Every operation runs on the E-Ink backend, which implements the whole canonical surface. The
 * class remains the seam extension clients build on -- it owns the session provider that lets a
 * multi-call operation pin one mobile session -- rather than a routing table over several backends.
 */
export class WeReadClient implements CanonicalClient {
  readonly search: CanonicalClient["search"];
  readonly book: CanonicalBook;
  readonly shelf: CanonicalClient["shelf"];
  readonly publicAccounts: CanonicalClient["publicAccounts"];
  readonly notes: CanonicalClient["notes"];
  readonly review: CanonicalClient["review"];
  readonly readData: CanonicalClient["readData"];
  readonly discover: CanonicalClient["discover"];
  readonly ai: CanonicalClient["ai"];
  readonly import: CanonicalClient["import"];

  constructor({ eink }: WeReadClientOptions) {
    this.search = eink.search;
    this.book = eink.book;
    this.shelf = eink.shelf;
    this.publicAccounts = eink.publicAccounts;
    this.notes = eink.notes;
    this.review = eink.review;
    this.readData = eink.readData;
    this.discover = eink.discover;
    this.ai = eink.ai;
    this.import = eink.import;
    registerClientSessionProvider(this, () => captureClientSession(eink));
  }
}
