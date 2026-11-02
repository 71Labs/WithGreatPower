/**
 * The server's NEAR connection: one failover provider per process (FastNEAR, then the
 * public RPC, or NEAR_RPC_URLS), and Accounts for the factory, relayer and operator
 * keys. Accounts are cached so near-api-js's nonce manager survives between requests
 * on a warm instance.
 */
import { Account, KeyPairSigner, type Provider } from "near-api-js";

import { makeProvider } from "../../lib/near/rpc";
import { chainEnv } from "./env";

let cached: { key: string; provider: Provider } | null = null;

export function provider(): Provider {
  const { rpcUrls } = chainEnv();
  const key = rpcUrls.join(",");
  if (cached?.key !== key) cached = { key, provider: makeProvider(rpcUrls) };
  return cached.provider;
}

const accounts = new Map<string, Account>();

/** An Account signing with one key. Cached per (account, key). */
export function keyedAccount(accountId: string, privateKey: `ed25519:${string}`): Account {
  const id = `${accountId}|${privateKey}`;
  let account = accounts.get(id);
  if (!account) {
    account = new Account(accountId, provider(), KeyPairSigner.fromSecretKey(privateKey));
    accounts.set(id, account);
  }
  return account;
}

/** A new Account for the key (fresh nonce state), replacing the cached one. */
export function freshKeyedAccount(accountId: string, privateKey: `ed25519:${string}`): Account {
  const account = new Account(accountId, provider(), KeyPairSigner.fromSecretKey(privateKey));
  accounts.set(`${accountId}|${privateKey}`, account);
  return account;
}

/** Test hook: drop cached connections after changing the environment. */
export function resetConnections(): void {
  cached = null;
  accounts.clear();
}
