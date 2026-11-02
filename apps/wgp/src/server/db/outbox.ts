/**
 * The chain outbox. Rows are written in the same transaction as the game state that
 * earns them; Chain's worker (src/server/near) claims `pending` rows and sends them.
 *
 * Payloads, for Chain:
 * - `mint_reward`: { runId, playerId, accountId, items: [{ tokenId, amount }], digest }
 * - `mint_import`: { playerId, accountId, items: [{ tokenId, amount }], trophy }
 */
import { and, eq, lte, sql } from "drizzle-orm";

import type { ItemId } from "@wgp/game-core/types";

import type { Db } from "./client";
import { chainOps, type ChainOp } from "./schema";

export interface MintItem {
  /** NEP-245 token id, e.g. "item:fee-bomb". */
  tokenId: string;
  amount: number;
}

export const itemTokenId = (item: ItemId) => `item:${item}`;

/** Items gained between two inventories (losses are ignored: spending happens on chain). */
export function lootDiff(before: Partial<Record<ItemId, number>>, after: Partial<Record<ItemId, number>>): MintItem[] {
  const out: MintItem[] = [];
  for (const [item, n] of Object.entries(after) as [ItemId, number][]) {
    const gained = Math.floor((n ?? 0) - (before[item] ?? 0));
    if (gained > 0) out.push({ tokenId: itemTokenId(item), amount: gained });
  }
  return out.sort((a, b) => a.tokenId.localeCompare(b.tokenId));
}

/** Queues a chain operation once per `dedupeKey`. Returns false if it was already queued. */
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
