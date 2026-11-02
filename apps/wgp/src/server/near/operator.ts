/**
 * The operator: sends verified rewards and season results to the game contract.
 *
 * Rewards are idempotent per account: each carries a nonce, and the contract applies
 * one only when it is that account's `reward_nonce + 1`, reporting "duplicate" for one
 * it already applied. So the outbox can resend a batch after any failure without ever
 * minting twice, as long as each reward keeps the nonce it was first given. Assign the
 * nonce once, in the same transaction that queues the reward, and store it with it.
 *
 * NEAR caps a call's logs at 16 KB, so batches hold at most 20 rewards (8 items and
 * 2 badges each); `sendRewards` splits larger lists.
 */
import { actions, type Account } from "near-api-js";

import { TGAS } from "../../lib/near/policy";
import { viewFunction } from "../../lib/near/rpc";
import { chainEnv, operatorEnv } from "./env";
import { summarizeOutcome } from "./relay";
import { keyedAccount, provider } from "./rpc";

export const MAX_REWARD_BATCH = 20;
export const MAX_ITEMS_PER_REWARD = 8;
/** A full batch burns about 9 Tgas in the sandbox; leave room. */
const MINT_GAS = 100n * TGAS;
const SEASON_GAS = 100n * TGAS;

const HEX32 = /^[0-9a-f]{64}$/;

export type RewardStatus = "applied" | "duplicate" | "out_of_order" | "full";

export interface Reward {
  /** Your id for this reward (e.g. the chain_ops row id), echoed back in the result. */
  key: string;
  accountId: string;
  /** The account's reward nonce for this mint, starting at 1. */
  nonce: number;
  /** Game item ids ("fee-bomb"), not token ids. */
  items: { item: string; amount: number }[];
  level?: number;
  badges?: string[];
  /** sha256 hex of the verified run. */
  digest: string;
}

export interface RewardResult {
  key: string;
  status: RewardStatus | "failed";
  txHash?: string;
  error?: string;
}

/** Maps the outbox's `{ tokenId: "item:x", amount }` list to contract items. */
export function itemsFromTokens(tokens: { tokenId: string; amount: number }[]): { item: string; amount: number }[] {
  return tokens.map(({ tokenId, amount }) => {
    if (!tokenId.startsWith("item:")) throw new Error(`Only items are minted as rewards, not ${tokenId}`);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000) throw new Error(`Bad amount for ${tokenId}`);
    return { item: tokenId.slice(5), amount };
  });
}

/** The contract's RewardMint JSON. Throws on anything the contract would refuse. */
export function toRewardMint(r: Reward): Record<string, unknown> {
  if (!Number.isInteger(r.nonce) || r.nonce < 1) throw new Error(`Bad nonce for ${r.key}`);
  if (!HEX32.test(r.digest)) throw new Error(`Digest for ${r.key} must be 64 lowercase hex characters`);
  if (r.items.length > MAX_ITEMS_PER_REWARD) throw new Error(`Too many items in ${r.key}`);
  if ((r.badges?.length ?? 0) > 2) throw new Error(`Too many badges in ${r.key}`);
  return {
    account_id: r.accountId,
    nonce: r.nonce,
    items: r.items,
    ...(r.level !== undefined ? { level: r.level } : {}),
    ...(r.badges?.length ? { badges: r.badges } : {}),
    digest: r.digest,
  };
}

/**
 * Orders rewards so each account's nonces ascend, then splits into contract-sized
 * batches. Pure.
 */
export function planBatches(rewards: Reward[], size = MAX_REWARD_BATCH): Reward[][] {
  const sorted = [...rewards].sort((a, b) => (a.accountId === b.accountId ? a.nonce - b.nonce : a.accountId < b.accountId ? -1 : 1));
  const out: Reward[][] = [];
  for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size));
  return out;
}

function operatorAccount(): Account {
  const env = operatorEnv();
  return keyedAccount(env.accountId, env.privateKey);
}

/** Sends rewards in batches. A failed batch marks its rewards "failed"; resend them as they are. */
export async function sendRewards(rewards: Reward[]): Promise<RewardResult[]> {
  const { contractId } = chainEnv();
  const account = operatorAccount();
  const results: RewardResult[] = [];
  for (const batch of planBatches(rewards)) {
    try {
      const outcome = await account.signAndSendTransaction({
        receiverId: contractId,
        actions: [actions.functionCall("mint_rewards", { batch: batch.map(toRewardMint) }, MINT_GAS, 0n)],
        waitUntil: "EXECUTED_OPTIMISTIC",
        throwOnFailure: false,
      });
      const summary = summarizeOutcome(outcome as unknown as Parameters<typeof summarizeOutcome>[0]);
      const statuses = Array.isArray(summary.result) ? (summary.result as RewardStatus[]) : null;
      if (!summary.ok || !statuses || statuses.length !== batch.length) {
        for (const r of batch) results.push({ key: r.key, status: "failed", txHash: summary.txHash, error: summary.error ?? "Unexpected result" });
        continue;
      }
      batch.forEach((r, i) => results.push({ key: r.key, status: statuses[i]!, txHash: summary.txHash }));
    } catch (error) {
      for (const r of batch) results.push({ key: r.key, status: "failed", error: (error as Error).message });
    }
  }
  return results;
}

export interface SeasonRecord {
  seasonId: string;
  root: string;
  top10: string[];
  digest: string;
}

/** Records a season once, forever (the contract refuses a second time). */
export async function recordSeason(s: SeasonRecord): Promise<{ txHash: string }> {
  if (!HEX32.test(s.root) || !HEX32.test(s.digest)) throw new Error("root and digest must be 64 lowercase hex characters");
  if (s.top10.length < 1 || s.top10.length > 10) throw new Error("top10 holds 1 to 10 accounts");
  const { contractId } = chainEnv();
  const outcome = await operatorAccount().signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.functionCall("record_season", { season_id: s.seasonId, root: s.root, top10: s.top10, digest: s.digest }, SEASON_GAS, 0n)],
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: false,
  });
  const summary = summarizeOutcome(outcome as unknown as Parameters<typeof summarizeOutcome>[0]);
  if (!summary.ok) throw new Error(`record_season failed: ${summary.error}`);
  return { txHash: summary.txHash };
}

/** The last reward nonce the contract applied for an account (0 if none). */
export async function rewardNonce(accountId: string): Promise<number> {
  return viewFunction<number>(provider(), chainEnv().contractId, "reward_nonce", { account_id: accountId });
}

/** A player's on-chain state (hero, level, tokens), or null. */
export async function playerOnChain(accountId: string): Promise<unknown> {
  return viewFunction(provider(), chainEnv().contractId, "get_player", { account_id: accountId });
}
