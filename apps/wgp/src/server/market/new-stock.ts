/**
 * Awarding Gwei's new stock (src/lib/market/new-stock.ts says what earns what) on the server.
 *
 * An award is written the way a night's loot is: the item goes into the save's inventory
 * and a `mint_reward` for it is queued with the player's next reward nonce, in one
 * transaction, so the operator's `mint_rewards` puts it on chain. Each award has its own
 * outbox key (item, player, UTC day), so a retried submit or a second run that day never
 * awards it twice.
 *
 * Only open items are awarded: those with a pool in the market the server reads (the
 * contract's, or the simulation's where there is none). Before the owner's `set_rules` and
 * `set_market_params` land, `mint_rewards` would refuse the item and fail the whole batch,
 * so nothing is awarded. If the market can't be read, nothing is awarded either (a later
 * verified result the same day still can be).
 */
import { and, eq, gt } from "drizzle-orm";

import type { Save } from "@wgp/game-core/types";

import {
  newStockKey,
  openNewStock,
  type NewStockAward,
} from "@/lib/market/new-stock";

import type { Db } from "../db/client";
import { enqueueRewardMint, itemTokenId } from "../db/outbox";
import { ensureSave, getPlayer, writeSave } from "../db/players";
import { runs, saves } from "../db/schema";
import { readChainMarket, type ChainReader } from "./chain";
import { readSim } from "./sim";

/** The new items open now: their pool exists on chain (or, with no contract market here, in the simulation). Empty when the market can't be read. */
export async function openStockNow(
  db: Db,
  reader?: ChainReader,
): Promise<Set<string>> {
  try {
    const chain = await readChainMarket(reader);
    const pools = chain ? chain.pools : (await readSim(db)).book.pools;
    return openNewStock(pools.map((p) => p.item));
  } catch (error) {
    console.error(
      `[new-stock] market unreadable, nothing awarded: ${(error as Error).message}`,
    );
    return new Set();
  }
}

export interface GrantInput {
  playerId: string;
  /** The player's NEAR account, as the reward payload names it. */
  accountId: string | null;
  awards: NewStockAward[];
  open: ReadonlySet<string>;
  /** The UTC day the award belongs to (the outbox key). */
  day: string;
  /** The verified run behind it, and its digest (logged on chain with the mint). */
  runId: string;
  digest: string;
  now: Date;
}

/**
 * Award inside a transaction that already holds the save row (`for update`) at `rev`.
 * Returns the save and revision after, and what was awarded (nothing for a closed item or
 * one already awarded under its key).
 */
export async function grantNewStockTx(
  tx: Db,
  input: GrantInput & { save: Save; rev: number },
): Promise<{ save: Save; rev: number; granted: NewStockAward[] }> {
  let { save, rev } = input;
  const granted: NewStockAward[] = [];
  for (const award of input.awards) {
    if (!input.open.has(award.item) || award.amount < 1) continue;
    const { queued } = await enqueueRewardMint(
      tx,
      {
        kind: "mint_reward",
        dedupeKey: newStockKey(award, input.playerId, input.day),
        playerId: input.playerId,
        payload: {
          runId: input.runId,
          playerId: input.playerId,
          accountId: input.accountId,
          items: [{ tokenId: itemTokenId(award.item), amount: award.amount }],
          digest: input.digest,
          day: input.day,
          newStock: award.source,
        },
      },
      input.now,
    );
    if (!queued) continue;
    const inventory = { ...(save.inventory ?? {}) };
    inventory[award.item] = (inventory[award.item] ?? 0) + award.amount;
    const next: Save = { ...save, inventory };
    const written = await writeSave(tx, input.playerId, next, rev, input.now);
    if (written === null) throw new Error("save moved under a locked row");
    save = next;
    rev = written;
    granted.push(award);
  }
  return { save, rev, granted };
}

/**
 * Award in a transaction of its own (locks the save row). For callers that aren't already writing the save.
 * `waitForRun`: award nothing while the player has a run in flight (its submit checks the save's revision,
 * so a write now would cost them that run); the caller tries again later (settleDailies looks back 3 days).
 */
export async function grantNewStock(
  db: Db,
  input: Omit<GrantInput, "accountId"> & { waitForRun?: boolean },
): Promise<NewStockAward[]> {
  if (!input.awards.some((a) => input.open.has(a.item))) return [];
  const player = await getPlayer(db, input.playerId);
  if (!player) return [];
  if (input.waitForRun) {
    const [inFlight] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.playerId, input.playerId), eq(runs.status, "issued"), gt(runs.expiresAt, input.now)))
      .limit(1);
    if (inFlight) return [];
  }
  await ensureSave(db, input.playerId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: saves.state, rev: saves.rev })
      .from(saves)
      .where(eq(saves.playerId, input.playerId))
      .for("update");
    const out = await grantNewStockTx(tx, {
      ...input,
      accountId: player.nearAccountId,
      save: row!.state as Save,
      rev: row!.rev,
    });
    return out.granted;
  });
}
