/**
 * Sandwich Man's NEAR wallet, from the environment. He is OFF on chain unless both are set:
 *
 *   NPC_TRADER_ACCOUNT_ID     his account, e.g. sandwich.wgpnear.near
 *   NPC_TRADER_PRIVATE_KEY    ed25519:… a key of that account
 *
 * Nothing else switches him on. The key is read only here and handed straight to the
 * signer; it is never logged, returned or stored. Setup: docs/npc-trader.md.
 */
import { z } from "zod";

import { isAccountId } from "../../lib/near/policy";
import { NearConfigError, type KeyedAccountEnv } from "../near/env";

/** His account in the simulated market, where no tokens move. */
export const NPC_SIM_ACCOUNT = "sandwich-man.sim";

const secretKey = z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{40,100}$/);

/** His account and key, or null when he isn't configured. Throws NearConfigError when a value is malformed. */
export function npcTraderEnv(env: Record<string, string | undefined> = process.env): KeyedAccountEnv | null {
  const accountId = env.NPC_TRADER_ACCOUNT_ID?.trim();
  const privateKey = env.NPC_TRADER_PRIVATE_KEY?.trim();
  if (!accountId || !privateKey) return null;
  if (!isAccountId(accountId)) throw new NearConfigError(["NPC_TRADER_ACCOUNT_ID (not a NEAR account id)"]);
  if (!secretKey.safeParse(privateKey).success) throw new NearConfigError(["NPC_TRADER_PRIVATE_KEY (must be ed25519:<base58>)"]);
  return { accountId, privateKey: privateKey as `ed25519:${string}` };
}

/**
 * Whether `accountId` is Sandwich Man's (in the simulated market, or his configured account
 * on chain). His trades are his own: they never count as a player's (the market quest, stats).
 */
export function isNpcAccount(accountId: string, env: Record<string, string | undefined> = process.env): boolean {
  return accountId === NPC_SIM_ACCOUNT || accountId === npcTraderAccount(env);
}

/** His account id on chain, or null when he's off or misconfigured. Never throws. */
export function npcTraderAccount(env: Record<string, string | undefined> = process.env): string | null {
  try {
    return npcTraderEnv(env)?.accountId ?? null;
  } catch {
    return null;
  }
}
