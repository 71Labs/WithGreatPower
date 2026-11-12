/**
 * The daily market quest: one real trade a day (a buy or a sell with Gwei, or buying a
 * player's listing) adds MARKET_QUEST_XP to the hero. It puts the market inside the daily
 * loop without minting anything: the reward is XP only, written the way every server save
 * change is (the save row locked, `rev` + 1), so it never creates Bits or items.
 *
 * - Completed by the server when a trade lands: the simulated market's route after
 *   `simAct`, and the relayer's market hook (`afterMarketRelay`) after an on-chain trade.
 *   A refused trade throws before either point, so it completes nothing.
 * - Once per player per UTC day: a `budget_counters` row (scope "quest:market", key the
 *   player, period the day) is inserted in the same transaction as the XP, and its primary
 *   key decides who adds it. No new table.
 * - A player's own trade only: Sandwich Man (the NPC trader, src/server/npc) has no player
 *   row, his looks never come through here, and a trade booked under his account never
 *   counts (`tradedToday`). A player whose listing he buys has listed, not traded.
 * - Held back, never lost: with a ranked run in flight (its save mustn't move; the same
 *   rule as referrals.ts) or no hero yet, nothing is written; `marketQuestStatus` sees the
 *   day's trade in `market_prices` and grants it on the next look.
 */
import { and, eq, gt, gte, inArray, sql } from "drizzle-orm";

import type { Save } from "@wgp/game-core/types";

import { countsForQuest, MARKET_QUEST_XP, type MarketQuestView } from "@/lib/market/quest";

import type { Db } from "../db/client";
import { ensureSave } from "../db/players";
import { addXp } from "../db/referrals";
import { SUBMIT_GRACE_MS } from "../db/runs";
import { budgetCounters, marketPrices, runs, saves } from "../db/schema";
import { isNpcAccount } from "../npc/env";
import { simAct, type SimResult } from "./sim";

export const QUEST_SCOPE = "quest:market";
const DAY_MS = 86_400_000;

/** The UTC day of `now`, "2026-11-12". */
export const utcDay = (now: Date) => now.toISOString().slice(0, 10);
const dayStart = (now: Date) => new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);

export type QuestOutcome =
  /** This call completed it: the save with the XP on. */
  | { state: "completed"; save: Save; rev: number; xp: number }
  | { state: "already" }
  | { state: "deferred"; reason: "no_hero" | "run_active" };

async function isDone(db: Db, playerId: string, day: string): Promise<boolean> {
  const [row] = await db
    .select({ count: budgetCounters.count })
    .from(budgetCounters)
    .where(and(eq(budgetCounters.scope, QUEST_SCOPE), eq(budgetCounters.key, playerId), eq(budgetCounters.period, day)))
    .limit(1);
  return !!row;
}

/**
 * Completes today's quest for a player whose trade just landed. Idempotent: the second call
 * of a day answers "already". Call it only after a real trade (see `countsForQuest`).
 */
export async function completeMarketQuest(db: Db, input: { playerId: string; now?: Date }): Promise<QuestOutcome> {
  const now = input.now ?? new Date();
  const day = utcDay(now);
  const { playerId } = input;
  return db.transaction(async (tx): Promise<QuestOutcome> => {
    await ensureSave(tx, playerId);
    const [row] = await tx.select({ state: saves.state, rev: saves.rev }).from(saves).where(eq(saves.playerId, playerId)).for("update");
    if (await isDone(tx, playerId, day)) return { state: "already" };
    const save = row!.state as Save;
    if (!save.hero) return { state: "deferred", reason: "no_hero" };
    const [inFlight] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.playerId, playerId), eq(runs.status, "issued"), gt(runs.expiresAt, new Date(now.getTime() - SUBMIT_GRACE_MS))))
      .limit(1);
    if (inFlight) return { state: "deferred", reason: "run_active" };

    const won = await tx
      .insert(budgetCounters)
      .values({ scope: QUEST_SCOPE, key: playerId, period: day, count: 1, updatedAt: now })
      .onConflictDoNothing({ target: [budgetCounters.scope, budgetCounters.key, budgetCounters.period] })
      .returning({ key: budgetCounters.key });
    if (won.length === 0) return { state: "already" };

    const next: Save = { ...save, hero: addXp(save.hero, MARKET_QUEST_XP) };
    const [written] = await tx
      .update(saves)
      .set({ state: next, rev: row!.rev + 1, updatedAt: now })
      .where(and(eq(saves.playerId, playerId), eq(saves.rev, row!.rev)))
      .returning({ rev: saves.rev });
    if (!written) throw new Error(`The save of ${playerId} moved under its lock`);
    return { state: "completed", save: next, rev: written.rev, xp: MARKET_QUEST_XP };
  });
}

/** `completeMarketQuest` for the trade paths: a failure is logged, never thrown (the trade already landed). */
export async function settleMarketQuest(db: Db, input: { playerId: string; now?: Date }): Promise<QuestOutcome | null> {
  try {
    return await completeMarketQuest(db, input);
  } catch (error) {
    console.error(`[market] quest for ${input.playerId}: ${(error as Error).message}`);
    return null;
  }
}

/**
 * One simulated trade, then the quest it may complete: what POST /api/market/trade runs.
 * `simAct` throws when the rules refuse the trade, so a refused trade never reaches the
 * quest. When the quest completes, the result carries the save with the XP on and
 * `questXp` says how much (0 otherwise).
 */
export async function simActWithQuest(db: Db, input: Parameters<typeof simAct>[1]): Promise<SimResult & { questXp: number }> {
  const result = await simAct(db, input);
  const quest = countsForQuest(input.act.action) ? await settleMarketQuest(db, { playerId: input.playerId, now: input.now }) : null;
  if (quest?.state === "completed") return { ...result, save: quest.save, rev: quest.rev, questXp: quest.xp };
  return { ...result, questXp: 0 };
}

/** Whether this account made a trade that counts (with Gwei, or a listing bought) since midnight UTC. */
export async function tradedToday(db: Db, accountId: string, now = new Date()): Promise<boolean> {
  // Sandwich Man's trades are the NPC's, whoever is signed in to his account: they complete nobody's quest.
  if (isNpcAccount(accountId)) return false;
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(marketPrices)
    .where(and(eq(marketPrices.accountId, accountId), inArray(marketPrices.kind, ["trade", "fill"]), gte(marketPrices.at, dayStart(now))));
  return Number(row?.n ?? 0) > 0;
}

/**
 * Today's quest for a player. If a trade of theirs landed today while the grant was held
 * back (a run in flight, no hero yet), this grants it now; `completed` then carries the save.
 */
export async function marketQuestStatus(
  db: Db,
  input: { playerId: string; accountId: string; now?: Date },
): Promise<{ view: MarketQuestView; completed: Extract<QuestOutcome, { state: "completed" }> | null }> {
  const now = input.now ?? new Date();
  const day = utcDay(now);
  let done = await isDone(db, input.playerId, day);
  let completed: Extract<QuestOutcome, { state: "completed" }> | null = null;
  if (!done && (await tradedToday(db, input.accountId, now))) {
    const outcome = await settleMarketQuest(db, { playerId: input.playerId, now });
    if (outcome?.state === "completed") completed = outcome;
    done = outcome?.state === "completed" || outcome?.state === "already";
  }
  return { view: { day, done, xp: MARKET_QUEST_XP, resetsAt: new Date(dayStart(now).getTime() + DAY_MS).toISOString() }, completed };
}
