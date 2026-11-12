/**
 * Where Sandwich Man's books and ledger are kept: one row of `market_sim` per market he
 * trades in ("npc:sim" for the simulated market, "npc:chain" for the contract's). No new
 * table: the row is a JSON document like the simulated market's own, and nothing else
 * reads these ids.
 *
 * The row is also his lock. `claimRun` takes it for one run (a lease), refusing while
 * another run holds it or the last one was too recent, so two triggers arriving together
 * can never both act; `finishRun` writes the books back and releases it.
 */
import { eq } from "drizzle-orm";

import { newBooks, type NpcBooks, type NpcEvent } from "@/lib/market/npc-book";

import type { Db } from "../db/client";
import { marketSim } from "../db/schema";

/** Ledger lines kept. */
export const LOG_KEEP = 40;
/** A run that never finished (the function died) frees the lock after this long. */
export const LEASE_MS = 90_000;

export interface NpcState {
  /** The account these books belong to; a different account starts fresh ones. */
  accountId: string;
  books: NpcBooks;
  /** Newest last. */
  log: NpcEvent[];
  /** When his last run started (Unix ms). */
  lastRunAt: number;
  /** A run holds the lock until this time (Unix ms); 0 when free. */
  leaseUntil: number;
  /** The last call the market refused, if any: what he tried and what it said. */
  lastRefusal: { at: number; text: string; error: string; txHash: string | null } | null;
}

export const npcRowId = (onChain: boolean) => (onChain ? "npc:chain" : "npc:sim");

const fresh = (accountId: string): NpcState => ({ accountId, books: newBooks(), log: [], lastRunAt: 0, leaseUntil: 0, lastRefusal: null });

function stateOf(raw: unknown, accountId: string): NpcState {
  const s = raw as NpcState | undefined;
  if (!s || s.accountId !== accountId) return fresh(accountId);
  return { ...fresh(accountId), ...s, books: { ...newBooks(), ...s.books } };
}

/** His state for `accountId`, or fresh books if he has none yet. */
export async function readNpcState(db: Db, onChain: boolean, accountId: string): Promise<NpcState> {
  const [row] = await db.select({ state: marketSim.state }).from(marketSim).where(eq(marketSim.id, npcRowId(onChain))).limit(1);
  return stateOf(row?.state, accountId);
}

export type Claim = { ok: true; state: NpcState } | { ok: false; why: "busy" | "too_soon" };

/** Takes the lock for one run, unless a run holds it or the last one started under `minGapMs` ago. */
export async function claimRun(db: Db, onChain: boolean, accountId: string, nowMs: number, minGapMs: number): Promise<Claim> {
  const id = npcRowId(onChain);
  return db.transaction(async (tx) => {
    await tx.insert(marketSim).values({ id, state: fresh(accountId), rev: 0, updatedAt: new Date(nowMs) }).onConflictDoNothing({ target: marketSim.id });
    const [row] = await tx.select().from(marketSim).where(eq(marketSim.id, id)).for("update");
    const state = stateOf(row!.state, accountId);
    if (state.leaseUntil > nowMs) return { ok: false, why: "busy" } as const;
    if (state.lastRunAt > 0 && nowMs - state.lastRunAt < minGapMs) return { ok: false, why: "too_soon" } as const;
    const claimed = { ...state, lastRunAt: nowMs, leaseUntil: nowMs + LEASE_MS };
    await tx.update(marketSim).set({ state: claimed, rev: row!.rev + 1, updatedAt: new Date(nowMs) }).where(eq(marketSim.id, id));
    return { ok: true, state: claimed } as const;
  });
}

/** Writes the run's books and ledger lines and frees the lock. */
export async function finishRun(db: Db, onChain: boolean, state: NpcState, update: { books?: NpcBooks; events?: NpcEvent[]; refusal?: NpcState["lastRefusal"] }, nowMs: number): Promise<NpcState> {
  const next: NpcState = {
    ...state,
    books: update.books ?? state.books,
    log: [...state.log, ...(update.events ?? [])].slice(-LOG_KEEP),
    lastRefusal: update.refusal === undefined ? state.lastRefusal : update.refusal,
    leaseUntil: 0,
  };
  await db.update(marketSim).set({ state: next, updatedAt: new Date(nowMs) }).where(eq(marketSim.id, npcRowId(onChain)));
  return next;
}
