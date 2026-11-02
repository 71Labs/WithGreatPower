/**
 * NEAR JSON-RPC with failover, for the browser and the server.
 *
 * near-api-js ships a FailoverRpcProvider, but it switches endpoint on every error,
 * including answers like "account does not exist" or "invalid nonce", and wraps them in
 * FailoverRpcError. That breaks `Account`'s retry on InvalidNonceError and hides real
 * failures. This one moves to the next endpoint only when the endpoint itself failed
 * (network error, 5xx, 408, 429, retries exhausted, node syncing) and rethrows anything
 * the chain actually answered.
 */
import { JsonRpcProvider, type Provider } from "near-api-js";
import {
  AccessKeyDoesNotExistError,
  AccountDoesNotExistError,
  InternalRpcError,
  NoSyncedBlocksError,
  NodeIsSyncingError,
  NotSyncedYetError,
  RpcError,
  UnavailableShardError,
} from "near-api-js/rpc-errors";

/** True when the endpoint failed rather than the chain answering. */
export function isTransportError(error: unknown): boolean {
  if (
    error instanceof InternalRpcError ||
    error instanceof NodeIsSyncingError ||
    error instanceof NotSyncedYetError ||
    error instanceof NoSyncedBlocksError ||
    error instanceof UnavailableShardError
  ) {
    return true;
  }
  return !(error instanceof RpcError);
}

/** A Provider that tries each URL in turn, sticking with the last one that worked. */
export function makeProvider(urls: readonly string[]): Provider {
  if (urls.length === 0) throw new Error("No NEAR RPC URLs configured");
  const providers = urls.map((url) => new JsonRpcProvider({ url }, { retries: 2, wait: 250, backoff: 2 }));
  let current = 0;
  return new Proxy({} as Provider, {
    get(_target, prop) {
      return async (...args: unknown[]) => {
        let lastError: unknown;
        for (let attempt = 0; attempt < providers.length; attempt++) {
          const provider = providers[current] as unknown as Record<PropertyKey, (...a: unknown[]) => Promise<unknown>>;
          const method = provider[prop];
          if (typeof method !== "function") throw new TypeError(`Provider has no method ${String(prop)}`);
          try {
            return await method.apply(provider, args);
          } catch (error) {
            if (!isTransportError(error)) throw error;
            lastError = error;
            current = (current + 1) % providers.length;
          }
        }
        throw lastError;
      };
    },
  });
}

/** Calls a view method and parses its JSON result. */
export async function viewFunction<T>(provider: Provider, contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction<never>({ contractId, method, args })) as T;
}

/** The latest final block height. */
export async function finalBlockHeight(provider: Provider): Promise<bigint> {
  const block = await provider.viewBlock({ finality: "final" });
  return BigInt(block.header.height);
}

/** The access key's nonce, or null when the key (or the account) doesn't exist. */
export async function accessKeyNonce(provider: Provider, accountId: string, publicKey: string): Promise<bigint | null> {
  try {
    const key = await provider.viewAccessKey({ accountId, publicKey, finalityQuery: { finality: "optimistic" } });
    return BigInt(key.nonce);
  } catch (error) {
    if (error instanceof AccessKeyDoesNotExistError || error instanceof AccountDoesNotExistError) return null;
    throw error;
  }
}

/** Whether an account exists on chain. */
export async function accountExists(provider: Provider, accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId, blockQuery: { finality: "optimistic" } });
    return true;
  } catch (error) {
    if (error instanceof AccountDoesNotExistError) return false;
    throw error;
  }
}
