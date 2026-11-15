/**
 * Gwei's wanted list, frozen per UTC day, and the bonus a verified night gets from it (the
 * rules are src/lib/market/wanted.ts).
 *
 * - Frozen: the first request of a day reads the market (the contract's when it's live, else
 *   the simulated one), works out the list and stores the snapshot and the list together in
 *   one `market_sim` row, id "wanted:<day>". No new table: the row is a JSON document like
 *   Sandwich Man's ("npc:chain"), and nothing else reads these ids. The insert does nothing
 *   if the row is already there, so two first requests store one list. No schedule: it
 *   happens on a request.
 * - Paid: `grantWanted` runs inside the verified run's transaction. Today's extra per player
 *   and item is a `budget_counters` row (scope "wanted:bonus"), so the day's cap holds across
 *   nights and a rolled-back run gives its share back.
 */
import { eq } from "drizzle-orm";

import type { ItemId, Save } from "@wgp/game-core/types";

import { deriveWanted, wantedBonus, type WantedBonus, type WantedDay, type WantedInput } from "@/lib/market/wanted";

import type { Db } from "../db/client";
import { itemTokenId, type MintItem } from "../db/outbox";
import { budgetUsed, reserveBudget, utcDay } from "../rate-limit";
import { chainOps, marketSim } from "../db/schema";
import { readChainMarket } from "./chain";
import { readSim } from "./sim";

export const wantedRowId = (day: string) => `wanted:${day}`;
export const WANTED_SCOPE = "wanted:bonus";

/** The stored row: the list, and the snapshot it was worked out from. */
export interface WantedRow extends WantedDay {
  v: 1;
  snapshot: WantedInput;
}

export type MarketReader = (db: Db) => Promise<{ onChain: boolean; input: WantedInput } | null>;

/** The live market, uncached (view.ts's `marketSource`, on this database): the contract's when it's live, else the simulated one. */
export const readLiveMarket: MarketReader = async (db) => {
  const chain = await readChainMarket();
  const { params, pools } = chain ?? (await readSim(db)).book;
  return { onChain: !!chain, input: { pools, open: params.open, feeBps: params.feeBps } };
};

const isRow = (raw: unknown): raw is WantedRow => !!raw && typeof raw === "object" && (raw as WantedRow).v === 1 && Array.isArray((raw as WantedRow).items);

const toDay = (row: WantedRow): WantedDay => ({ day: row.day, at: row.at, onChain: row.onChain, items: row.items });

/** A day's stored list, or null when none was taken that day. Never reads the market. */
export async function storedWanted(db: Db, day: string): Promise<WantedDay | null> {
  const [row] = await db.select({ state: marketSim.state }).from(marketSim).where(eq(marketSim.id, wantedRowId(day))).limit(1);
  return isRow(row?.state) ? toDay(row.state) : null;
}

/**
 * Today's list: the stored one, or (the first request of the day) a snapshot of the market
 * stored now. Null when there's none stored and the market can't be read; nothing is stored
 * then, so the next request tries again.
 */
export async function wantedToday(db: Db, now = new Date(), read: MarketReader = readLiveMarket): Promise<WantedDay | null> {
  const day = utcDay(now);
  const stored = await storedWanted(db, day);
  if (stored) return stored;
  let market: Awaited<ReturnType<MarketReader>>;
  try {
    market = await read(db);
  } catch (error) {
    console.error(`[wanted] couldn't read the market for ${day}: ${(error as Error).message}`);
    return null;
  }
  if (!market) return null;
  const row: WantedRow = { v: 1, day, at: now.toISOString(), onChain: market.onChain, items: deriveWanted(market.input), snapshot: market.input };
  await db.insert(marketSim).values({ id: wantedRowId(day), state: row, rev: 0, updatedAt: now }).onConflictDoNothing({ target: marketSim.id });
  // Whoever stored first wins; read back what is there.
  return (await storedWanted(db, day)) ?? toDay(row);
}

/**
 * The bonus for a verified night's loot against its day's list, with today's cap reserved
 * in `budget_counters`. Call inside the run's transaction. Returns only items it added to.
 */
export async function grantWanted(tx: Db, input: { playerId: string; list: WantedDay; loot: MintItem[]; now: Date }): Promise<WantedBonus[]> {
  const { playerId, list, now } = input;
  const loot: Record<string, number> = {};
  for (const m of input.loot) loot[m.tokenId.replace(/^item:/, "")] = m.amount;
  const brought = list.items.filter((w) => (loot[w.item] ?? 0) > 0);
  if (brought.length === 0) return [];
  const used: Record<string, number> = {};
  for (const w of brought) used[w.item] = await budgetUsed(tx, { scope: WANTED_SCOPE, key: `${playerId}:${w.item}`, period: list.day });
  const bonus = wantedBonus(brought, loot, used);
  for (const b of bonus) {
    if (b.bonus <= 0) continue;
    const w = brought.find((x) => x.item === b.item)!;
    const ok = await reserveBudget(tx, { scope: WANTED_SCOPE, key: `${playerId}:${b.item}`, period: list.day, limit: w.cap.day, amount: b.bonus }, now);
    if (!ok.ok) Object.assign(b, { bonus: 0, capped: "day" });
  }
  return bonus;
}

/** The loot with the bonus added, still sorted by token id. Pure. */
export function withWanted(loot: MintItem[], bonus: WantedBonus[]): MintItem[] {
  const extra = new Map(bonus.filter((b) => b.bonus > 0).map((b) => [itemTokenId(b.item as ItemId), b.bonus]));
  if (extra.size === 0) return loot;
  return loot.map((m) => (extra.has(m.tokenId) ? { ...m, amount: m.amount + extra.get(m.tokenId)! } : m));
}

/** The save with the bonus in its inventory, so the save keeps mirroring what the chain holds. Pure. */
export function saveWithWanted(save: Save, bonus: WantedBonus[]): Save {
  const add = bonus.filter((b) => b.bonus > 0);
  if (add.length === 0) return save;
  const inventory = { ...(save.inventory ?? {}) };
  for (const b of add) inventory[b.item as ItemId] = (inventory[b.item as ItemId] ?? 0) + b.bonus;
  return { ...save, inventory };
}

/**
 * The list a ranked night is paid against: its start day's. A night started today may take
 * today's snapshot (the first request of the day); one started on an earlier day only uses
 * what that day stored. Never throws: without a list the night is paid as usual.
 */
export async function wantedForRun(db: Db, issuedAt: Date, now: Date, read: MarketReader = readLiveMarket): Promise<WantedDay | null> {
  try {
    const day = utcDay(issuedAt);
    return day === utcDay(now) ? await wantedToday(db, now, read) : await storedWanted(db, day);
  } catch (error) {
    console.error(`[wanted] no list for this run: ${(error as Error).message}`);
    return null;
  }
}

/** A verified run's wanted bonus, read back from its queued mint (an idempotent resubmit). */
export async function mintedWanted(db: Db, runId: string): Promise<WantedBonus[]> {
  const [op] = await db.select({ payload: chainOps.payload }).from(chainOps).where(eq(chainOps.dedupeKey, `mint_reward:${runId}`)).limit(1);
  const wanted = (op?.payload as { wanted?: unknown } | undefined)?.wanted;
  return Array.isArray(wanted) ? (wanted as WantedBonus[]) : [];
}
