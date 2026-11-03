/**
 * The reward mint worker behind GET /api/cron/mint. Each pass claims the next batch of
 * queued mints (src/server/db/outbox.ts: at most 20, in per-account nonce order), sends
 * it with the operator key in one `mint_rewards` call, and records what the contract
 * said about each: applied and duplicate are done, out_of_order waits for its
 * predecessor, full and failed back off and retry.
 *
 * Safe on any schedule, twice at once, or after a crash:
 * - a claim is all or nothing, so two workers never send overlapping batches;
 * - every mint keeps its nonce for life, so a resend after a lost answer is "duplicate";
 * - a worker that dies mid-send leaves rows in "sending", which the sweep cron requeues.
 *
 * A row the contract would refuse outright (a malformed payload) would sink the whole
 * batch, so it is checked first and set aside as dead; that player's later mints in the
 * batch go back to the queue untouched.
 */
import type { Db } from "@/server/db/client";
import {
  REWARD_BATCH_SIZE,
  buryRewardOps,
  claimRewardBatch,
  releaseRewardClaims,
  rewardFromOp,
  settleRewardResults,
  type RewardOutcome,
} from "@/server/db/outbox";
import type { ChainOp } from "@/server/db/schema";

import { sendRewards, toRewardMint, type Reward, type RewardResult } from "./operator";

/** How many batches one pass may send: a backlog drains five times faster, and a pass stays well inside a minute. */
export const MAX_BATCHES_PER_PASS = 5;

/** The contract's limits on one reward entry (contracts/wgp/src/lib.rs). */
const MAX_ITEM_AMOUNT = 1000;
const MAX_LEVEL = 1000;
const SLUG = /^[a-z0-9-]{1,32}$/;

export type SendRewards = (rewards: Reward[]) => Promise<RewardResult[]>;

export interface MintReport {
  batches: number;
  claimed: number;
  applied: number;
  duplicate: number;
  outOfOrder: number;
  full: number;
  failed: number;
  /** Malformed rows set aside for an operator. */
  dead: number;
  /** Rows handed back unsent because an earlier mint of the same player was set aside. */
  released: number;
  txHashes: string[];
}

const emptyReport = (): MintReport => ({
  batches: 0,
  claimed: 0,
  applied: 0,
  duplicate: 0,
  outOfOrder: 0,
  full: 0,
  failed: 0,
  dead: 0,
  released: 0,
  txHashes: [],
});

/** Throws on anything the contract's `mint_rewards` would refuse, which would sink the whole batch. */
function checkReward(r: Reward): void {
  toRewardMint(r);
  for (const { item, amount } of r.items) {
    if (!SLUG.test(item)) throw new Error(`Bad item id ${item}`);
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_ITEM_AMOUNT) throw new Error(`Bad amount for ${item}`);
  }
  if (r.level !== undefined && (!Number.isInteger(r.level) || r.level < 1 || r.level > MAX_LEVEL)) throw new Error("Level out of range");
  for (const b of r.badges ?? []) if (!SLUG.test(b)) throw new Error(`Bad badge id ${b}`);
}

/**
 * Splits claimed rows (in send order) into rewards to send, rows to set aside as dead, and
 * rows to hand back because an earlier nonce of the same player was set aside. Pure.
 */
export function prepareRewards(ops: ChainOp[]): { send: Reward[]; dead: { key: string; error: string }[]; release: string[] } {
  const send: Reward[] = [];
  const dead: { key: string; error: string }[] = [];
  const release: string[] = [];
  const blocked = new Set<string>();
  for (const op of ops) {
    const player = op.playerId ?? op.id;
    if (blocked.has(player)) {
      release.push(op.id);
      continue;
    }
    try {
      const reward = rewardFromOp(op);
      checkReward(reward);
      send.push(reward);
    } catch (error) {
      dead.push({ key: op.id, error: `malformed: ${(error as Error).message}` });
      blocked.add(player);
    }
  }
  return { send, dead, release };
}

/** Sends rewards, turning a thrown error or a missing answer into "failed" results. */
async function sendAll(send: SendRewards, rewards: Reward[]): Promise<RewardResult[]> {
  if (rewards.length === 0) return [];
  let results: RewardResult[];
  try {
    results = await send(rewards);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return rewards.map((r) => ({ key: r.key, status: "failed" as const, error: message.slice(0, 500) }));
  }
  const answered = new Set(results.map((r) => r.key));
  const missing = rewards.filter((r) => !answered.has(r.key)).map((r) => ({ key: r.key, status: "failed" as const, error: "No answer for this reward" }));
  return [...results, ...missing];
}

const COUNTER: Record<RewardOutcome, keyof Pick<MintReport, "applied" | "duplicate" | "outOfOrder" | "full" | "failed">> = {
  applied: "applied",
  duplicate: "duplicate",
  out_of_order: "outOfOrder",
  full: "full",
  failed: "failed",
};

/**
 * Sends queued mints until the queue is empty, MAX_BATCHES_PER_PASS batches went out, or
 * a whole batch failed (the chain or the RPC is in trouble: leave it to the next pass).
 * `send` defaults to the operator; tests pass a fake chain.
 */
export async function drainRewards(
  db: Db,
  opts: { send?: SendRewards; clock?: () => Date; maxBatches?: number; batchSize?: number } = {},
): Promise<MintReport> {
  const send = opts.send ?? sendRewards;
  const clock = opts.clock ?? (() => new Date());
  const size = opts.batchSize ?? REWARD_BATCH_SIZE;
  const report = emptyReport();

  for (let i = 0; i < (opts.maxBatches ?? MAX_BATCHES_PER_PASS); i++) {
    const claimedAt = clock();
    const ops = await claimRewardBatch(db, claimedAt, size);
    if (ops.length === 0) break;
    report.batches += 1;
    report.claimed += ops.length;

    const plan = prepareRewards(ops);
    await buryRewardOps(db, plan.dead, claimedAt);
    await releaseRewardClaims(db, plan.release, claimedAt);
    report.dead += plan.dead.length;
    report.released += plan.release.length;

    const results = await sendAll(send, plan.send);
    await settleRewardResults(db, results, clock());
    for (const r of results) {
      report[COUNTER[r.status]] += 1;
      if (r.txHash && r.status !== "failed" && !report.txHashes.includes(r.txHash)) report.txHashes.push(r.txHash);
    }

    if (ops.length < size) break;
    if (results.length > 0 && results.every((r) => r.status === "failed")) break;
  }
  return report;
}
