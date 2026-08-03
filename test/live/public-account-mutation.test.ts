import { beforeAll, describe, expect, it } from "vitest";

import { applyConnectAttemptTimeout } from "../../src/connect-timeout.js";
import { createEinkClient, TransportError, WeReadApiError } from "../../src/index.js";

const enabled = process.env.WEREAD_LIVE_PUBLIC_ACCOUNT_MUTATION === "1";

describe.skipIf(!enabled)("public-account mutation live probe", () => {
  beforeAll(() => {
    applyConnectAttemptTimeout();
  });

  it("subscribes a dedicated absent account once and restores the absent baseline", async () => {
    const accountId = process.env.WEREAD_LIVE_MUTATION_PUBLIC_ACCOUNT_ID;
    if (!accountId || !/^MP_WXS_[0-9]+$/.test(accountId)) {
      throw new TypeError("WEREAD_LIVE_MUTATION_PUBLIC_ACCOUNT_ID must be an exact MP_WXS_<digits> ID");
    }
    const client = createEinkClient();
    const subscribed = async (): Promise<boolean> =>
      (
        await client.publicAccounts.subscriptions({
          count: Number.MAX_SAFE_INTEGER,
          offset: 0,
          signal: AbortSignal.timeout(15_000),
        })
      ).accounts.some((account) => account.accountId === accountId);
    const ambiguous = (error: unknown): boolean =>
      (error instanceof WeReadApiError || error instanceof TransportError) && error.ambiguous;

    expect(await subscribed(), "the dedicated mutation ID must initially be absent").toBe(false);
    let operationFailure: unknown;
    let cleanupFailure: unknown;
    try {
      try {
        await client.publicAccounts.subscribe(accountId, { signal: AbortSignal.timeout(15_000) });
      } catch (error) {
        if (!ambiguous(error)) throw error;
        // Never retry an ambiguous write; reconcile from the shelf snapshot below.
      }
      expect(await subscribed(), "subscribe did not reconcile to present").toBe(true);
    } catch (error) {
      operationFailure = error;
    } finally {
      try {
        if (await subscribed()) {
          try {
            await client.publicAccounts.unsubscribe(accountId, { signal: AbortSignal.timeout(15_000) });
          } catch (error) {
            if (!ambiguous(error)) cleanupFailure = error;
            // Never retry an ambiguous delete; the final shelf snapshot is authoritative.
          }
        }
        if (await subscribed()) {
          cleanupFailure ??= new Error("mutation probe failed to restore the absent baseline");
        }
      } catch (error) {
        cleanupFailure ??= error;
      }
    }
    if (cleanupFailure !== undefined) throw cleanupFailure;
    if (operationFailure !== undefined) throw operationFailure;
  }, 90_000);
});
