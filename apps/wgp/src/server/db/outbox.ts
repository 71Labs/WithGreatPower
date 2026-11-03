/**
 * The chain outbox. Rows are written in the same transaction as the game state that
 * earns them; the mint worker (src/server/near/mint-worker.ts, GET /api/cron/mint)
 * claims pending mints and sends them with the operator key.
 *
 * Payloads, for Chain:
 * - `mint_reward`: { runId, playerId, accountId, items: [{ tokenId, amount }], level?, digest }
 * - `mint_import`: { playerId, accountId, items: [{ tokenId, amount }], trophy, level?, digest }
 * - `register_hero`: { accountId, name, suit }. Only the player's own key can send it, so
 *   it waits (pending, no nonce) for their session key; see src/server/near/heroes.ts.
 *
 * Reward nonces. The contract's `mint_rewards` applies a mint only when its nonce is
 * exactly the account's last applied nonce + 1 (anything lower is "duplicate", anything
 * higher "out_of_order"). So every mint takes `players.next_reward_nonce` when it is
 * queued, inside the transaction that earns it, and keeps it for life:
 * - nonces are gapless: the bump and the row commit or roll back together;
 * - a retry is idempotent: a resend carries the same nonce and the contract says "duplicate";
 * - batches keep each account's order: `claimRewardBatch` takes, per player, only an
 *   unbroken run of nonces starting at the lowest one not yet on chain.
 * A mint that dies (status "dead") blocks that player's later mints until an operator
 * resolves it; that is the contract's rule, not ours.
 */
import { createHash } from "node:crypto";

import { and, asc, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";

import type { ItemId } from "@wgp/game-core/types";

import type { Db } from "./client";
import { chainOps, players, type ChainOp } from "./schema";

export interface MintItem {
  /** NEP-245 token id, e.g. "item:fee-bomb". */
  tokenId: string;
  amount: number;
}

export const itemTokenId = (item: ItemId) => `item:${item}`;

/** Outbox kinds sent through the contract's `mint_rewards`, each with a reward nonce. */
export const MINT_KINDS = ["mint_reward", "mint_import"] as const;
export type MintKind = (typeof MINT_KINDS)[number];

/** What `mint_rewards` takes per entry; the contract refuses bigger batches. */
export const REWARD_BATCH_SIZE = 20;

/** Items gained between two inventories (losses are ignored: spending happens on chain). */
export function lootDiff(before: Partial<Record<ItemId, number>>, after: Partial<Record<ItemId, number>>): MintItem[] {
  const out: MintItem[] = [];
  for (const [item, n] of Object.entries(after) as [ItemId, number][]) {
    const gained = Math.floor((n ?? 0) - (before[item] ?? 0));
    if (gained > 0) out.push({ tokenId: itemTokenId(item), amount: gained });
  }
  return out.sort((a, b) => a.tokenId.localeCompare(b.tokenId));
}

/** sha256 hex, for digests a mint logs on chain. */
export const sha256Hex = (data: string) => createHash("sha256").update(data).digest("hex");

/** Queues a chain operation once per `dedupeKey`. Returns false if it was already queued. Not for mints: see enqueueRewardMint. */
export async function enqueueChainOp(
  tx: Db,
  op: { kind: string; dedupeKey: string; playerId: string | null; payload: Record<string, unknown> },
  now = new Date(),
): Promise<boolean> {
  const rows = await tx
    .insert(chainOps)
    .values({ kind: op.kind, dedupeKey: op.dedupeKey, playerId: op.playerId, payload: op.payload, nextAttemptAt: now, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: chainOps.dedupeKey })
    .returning({ id: chainOps.id });
  return rows.length > 0;
}

/**
 * Queues a mint once per `dedupeKey` and gives it the player's next reward nonce. Call it
 * inside the transaction that earns the reward. The player's row is locked first, so
 * concurrent mints for one player line up and take consecutive nonces, and a mint that
 * is already queued keeps its nonce without burning a new one.
 */
export async function enqueueRewardMint(
  tx: Db,
  op: { kind: MintKind; dedupeKey: string; playerId: string; payload: Record<string, unknown> },
  now = new Date(),
): Promise<{ queued: boolean; nonce: number }> {
  const [player] = await tx.select({ next: players.nextRewardNonce }).from(players).where(eq(players.id, op.playerId)).for("update");
  if (!player) throw new Error(`No player ${op.playerId} to mint for`);

  const [existing] = await tx.select({ nonce: chainOps.rewardNonce }).from(chainOps).where(eq(chainOps.dedupeKey, op.dedupeKey)).limit(1);
  if (existing) return { queued: false, nonce: existing.nonce ?? 0 };

  const nonce = player.next;
  await tx.insert(chainOps).values({
    kind: op.kind,
    dedupeKey: op.dedupeKey,
    playerId: op.playerId,
    payload: op.payload,
    rewardNonce: nonce,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await tx.update(players).set({ nextRewardNonce: nonce + 1 }).where(eq(players.id, op.playerId));
  return { queued: true, nonce };
}

/** Pending rows due now, oldest first. For Chain's worker. */
export function duePendingOps(db: Db, now = new Date(), limit = 20): Promise<ChainOp[]> {
  return db
    .select()
    .from(chainOps)
    .where(and(eq(chainOps.status, "pending"), lte(chainOps.nextAttemptAt, now)))
    .orderBy(chainOps.createdAt)
    .limit(limit);
}

/** Moves a row from pending to sending, if nobody else claimed it first. For Chain's worker. */
export async function claimChainOp(db: Db, id: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(chainOps)
    .set({ status: "sending", attempts: sql`${chainOps.attempts} + 1`, updatedAt: now })
    .where(and(eq(chainOps.id, id), eq(chainOps.status, "pending")))
    .returning({ id: chainOps.id });
  return rows.length > 0;
}

/* ------------------------------------------------------------------ reward batches */

type QueuedMint = Pick<ChainOp, "id" | "playerId" | "rewardNonce" | "status" | "nextAttemptAt" | "createdAt">;

/**
 * Which mints may go out now, in send order. Pure. `rows` are every mint not yet on chain
 * (any status but "sent"). Per player it takes the lowest nonce and the unbroken run of
 * due, pending nonces after it; a player whose lowest unsent mint is in flight, failed or
 * not due yet sends nothing, so nonce n + 1 never leaves before n. Players go oldest first.
 */
export function planRewardQueue<T extends QueuedMint>(rows: T[], now: Date, limit = REWARD_BATCH_SIZE): T[] {
  const byPlayer = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.playerId || r.rewardNonce === null || r.status === "sent") continue;
    const list = byPlayer.get(r.playerId) ?? [];
    list.push(r);
    byPlayer.set(r.playerId, list);
  }
  const runs: T[][] = [];
  for (const list of byPlayer.values()) {
    list.sort((a, b) => a.rewardNonce! - b.rewardNonce!);
    const run: T[] = [];
    for (const r of list) {
      const contiguous = run.length === 0 || r.rewardNonce === run[run.length - 1]!.rewardNonce! + 1;
      if (!contiguous || r.status !== "pending" || r.nextAttemptAt.getTime() > now.getTime()) break;
      run.push(r);
    }
    if (run.length > 0) runs.push(run);
  }
  runs.sort((a, b) => a[0]!.createdAt.getTime() - b[0]!.createdAt.getTime() || (a[0]!.playerId! < b[0]!.playerId! ? -1 : 1));
  const out: T[] = [];
  for (const run of runs) {
    for (const r of run) {
      if (out.length >= limit) return out;
      out.push(r);
    }
  }
  return out;
}

/**
 * Claims the next batch of mints (pending → sending) in per-account nonce order. If
 * another worker claimed any of them first, nothing is taken (try again next tick), so a
 * batch never skips a nonce. Returns the claimed rows, ready for `rewardFromOp`.
 */
export async function claimRewardBatch(db: Db, now = new Date(), limit = REWARD_BATCH_SIZE): Promise<ChainOp[]> {
  const unsent = await db
    .select()
    .from(chainOps)
    .where(and(isNotNull(chainOps.rewardNonce), ne(chainOps.status, "sent")))
    .orderBy(asc(chainOps.playerId), asc(chainOps.rewardNonce))
    .limit(1000);
  const plan = planRewardQueue(unsent, now, limit);
  if (plan.length === 0) return [];
  const ids = plan.map((r) => r.id);
  const claimed = await db
    .update(chainOps)
    .set({ status: "sending", attempts: sql`${chainOps.attempts} + 1`, updatedAt: now })
    .where(and(inArray(chainOps.id, ids), eq(chainOps.status, "pending")))
    .returning({ id: chainOps.id });
  if (claimed.length !== ids.length) {
    await releaseRewardClaims(
      db,
      claimed.map((c) => c.id),
      now,
    );
    return [];
  }
  return plan.map((r) => ({ ...r, status: "sending" as const, attempts: r.attempts + 1, updatedAt: now }));
}

/** Hands claimed mints back to the queue unsent: pending again, the claim's attempt undone. */
export async function releaseRewardClaims(db: Db, ids: string[], now = new Date()): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(chainOps)
    .set({ status: "pending", attempts: sql`${chainOps.attempts} - 1`, updatedAt: now })
    .where(and(inArray(chainOps.id, ids), eq(chainOps.status, "sending")));
}

/**
 * Sets aside claimed mints that can never be sent as they are (a malformed row): "dead",
 * with the reason. Like any dead mint, each blocks its player's later mints until an
 * operator resolves it.
 */
export async function buryRewardOps(db: Db, rows: { key: string; error: string }[], now = new Date()): Promise<void> {
  for (const r of rows) {
    await db
      .update(chainOps)
      .set({ status: "dead", error: r.error.slice(0, 500), updatedAt: now })
      .where(and(eq(chainOps.id, r.key), eq(chainOps.status, "sending")));
  }
}

/** The operator's Reward (src/server/near/operator.ts) for a claimed mint row. Throws on a malformed row. */
export function rewardFromOp(op: ChainOp): {
  key: string;
  accountId: string;
  nonce: number;
  items: { item: string; amount: number }[];
  level?: number;
  badges?: string[];
  digest: string;
} {
  if (!(MINT_KINDS as readonly string[]).includes(op.kind) || op.rewardNonce === null) throw new Error(`${op.id} is not a reward mint`);
  const p = op.payload as { accountId?: string; items?: MintItem[]; level?: number; trophy?: string; digest?: string };
  if (!p.accountId || !p.digest) throw new Error(`${op.id} is missing its account or digest`);
  const items = (p.items ?? []).map(({ tokenId, amount }) => {
    if (!tokenId.startsWith("item:")) throw new Error(`Only items are minted as rewards, not ${tokenId}`);
    return { item: tokenId.slice(5), amount };
  });
  // The contract mints a badge `b` as `trophy:badge:b`; ours are queued as `trophy:b`.
  const badges = p.trophy ? [p.trophy.replace(/^trophy:/, "")] : undefined;
  return { key: op.id, accountId: p.accountId, nonce: op.rewardNonce, items, ...(p.level ? { level: p.level } : {}), ...(badges ? { badges } : {}), digest: p.digest };
}

export type RewardOutcome = "applied" | "duplicate" | "out_of_order" | "full" | "failed";

/** Backoff before a failed mint is tried again: 30 s, doubling, at most an hour. */
export const rewardRetryMs = (attempts: number) => Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));

/**
 * Records what the contract said about each sent mint. Applied and duplicate are done;
 * out_of_order waits for its predecessor; full and failed back off and retry (the sweep
 * cron requeues failed rows, and marks them dead after OUTBOX_MAX_ATTEMPTS).
 */
export async function settleRewardResults(
  db: Db,
  results: { key: string; status: RewardOutcome; txHash?: string; error?: string }[],
  now = new Date(),
): Promise<void> {
  for (const r of results) {
    const [op] = await db.select({ attempts: chainOps.attempts }).from(chainOps).where(eq(chainOps.id, r.key)).limit(1);
    if (!op) continue;
    const later = new Date(now.getTime() + rewardRetryMs(op.attempts));
    const set =
      r.status === "applied" || r.status === "duplicate"
        ? { status: "sent" as const, txHash: r.txHash ?? null, error: null }
        : r.status === "out_of_order"
          ? { status: "pending" as const, txHash: r.txHash ?? null, error: "out_of_order: an earlier nonce isn't on chain yet", nextAttemptAt: later }
          : { status: "failed" as const, txHash: r.txHash ?? null, error: r.status === "full" ? "full: the account holds the most token kinds it can" : (r.error ?? "failed"), nextAttemptAt: later };
    await db
      .update(chainOps)
      .set({ ...set, updatedAt: now })
      .where(and(eq(chainOps.id, r.key), eq(chainOps.status, "sending")));
  }
}
