/**
 * Sandwich Man in the simulated market (src/server/market/sim.ts): the same book and the
 * same rules the players trade on, with him as one more account. His Bits live in the
 * sim's `wallets` like everyone's simulated Bits, and his items in the sim's `npc.items`
 * (players keep theirs in their save; he has none). No tokens move, and every row he
 * writes is flagged `onChain: false` under his own account id.
 *
 * The first time he shows up he gets his one-off seed (NPC_RULES.seedBits), the same
 * amount the owner mints him on chain (docs/npc-trader.md).
 */
import { eq, sql } from "drizzle-orm";

import { ITEMS } from "@wgp/game-core/data";

import { BITS_TOKEN } from "@/lib/market/config";
import type { Ledger } from "@/lib/market/engine";
import { bitsText } from "@/lib/market/format";
import type { NpcBooks, NpcEvent } from "@/lib/market/npc-book";
import { NPC_RULES } from "@/lib/market/npc-rules";
import { npcTurn, type NpcTurn } from "@/lib/market/npc-turn";

import type { Db } from "../db/client";
import { marketSim } from "../db/schema";
import { recordTrade } from "../market/history";
import { seedSim, SIM_ID, simStateOf, type SimState } from "../market/sim";
import { NPC_SIM_ACCOUNT } from "./env";

/** The ledger with Sandwich Man acting: he pays and receives; a seller he buys from is paid in Bits. */
function npcLedger(me: string, wallets: Record<string, number>, items: Record<string, number>): Ledger {
  const item = (token: string) => {
    const id = token.slice("item:".length);
    if (!token.startsWith("item:") || !(id in ITEMS)) throw new Error(`The simulated market has no ${token}`);
    return id;
  };
  return {
    balance(account, token) {
      if (token === BITS_TOKEN) return account === me ? (wallets[account] ?? 0) : 0;
      return account === me ? (items[item(token)] ?? 0) : 0;
    },
    credit(account, token, n) {
      if (token === BITS_TOKEN) wallets[account] = (wallets[account] ?? 0) + n;
      else if (account === me) items[item(token)] = (items[item(token)] ?? 0) + n;
      else throw new Error("Only the acting account receives items");
    },
    debit(account, token, n) {
      if (account !== me) throw new Error("Only the acting account pays");
      if (token === BITS_TOKEN) wallets[account] = (wallets[account] ?? 0) - n;
      else items[item(token)] = (items[item(token)] ?? 0) - n;
    },
  };
}

/** The seed's ledger line. */
export const seedEvent = (at: number, onChain: boolean): NpcEvent => ({
  at,
  kind: "seed",
  item: null,
  amount: 0,
  bits: NPC_RULES.seedBits,
  text: `Opened shop with ${bitsText(NPC_RULES.seedBits)}`,
  reason: "A one-off seed, the only Bits I didn’t trade for. Everything after this is mine.",
  onChain,
  txHash: null,
});

/**
 * One turn in the simulated market, in one transaction on the sim's row: seeds him the
 * first time, then at most one action by his rules, with the price history row a
 * player's trade would write.
 */
export async function npcSimTurn(db: Db, books: NpcBooks, now: Date): Promise<NpcTurn> {
  const me = NPC_SIM_ACCOUNT;
  const t = now.getTime();
  return db.transaction(async (tx) => {
    await tx.insert(marketSim).values({ id: SIM_ID, state: seedSim(), rev: 0, updatedAt: now }).onConflictDoNothing({ target: marketSim.id });
    const [row] = await tx.select().from(marketSim).where(eq(marketSim.id, SIM_ID)).for("update");
    const state = simStateOf(row!.state);
    const book = state.book;
    const wallets = { ...state.wallets };
    const items = { ...(state.npc?.items ?? {}) };
    const seeded = state.npc === undefined;
    if (seeded) wallets[me] = (wallets[me] ?? 0) + NPC_RULES.seedBits;

    const turn = npcTurn(book, npcLedger(me, wallets, items), me, books, t);
    const acted = turn.action !== null && turn.refused === null;
    if (!seeded && !acted) return turn;

    for (const k of Object.keys(items)) if (!items[k]) delete items[k];
    await tx
      .update(marketSim)
      .set({ state: { ...state, book, wallets, npc: { items } } satisfies SimState, rev: sql`${marketSim.rev} + 1`, updatedAt: now })
      .where(eq(marketSim.id, SIM_ID));

    const a = turn.action;
    if (acted && a && turn.outcome && (a.kind === "buy" || a.kind === "sell" || a.kind === "fill")) {
      const pool = book.pools.find((p) => p.item === a.item)!;
      await recordTrade(
        tx,
        a.kind === "fill"
          ? { item: a.item, kind: "fill", onChain: false, pool, side: "fill", amount: a.amount, bits: turn.outcome.bits, fee: turn.outcome.fee ?? 0, accountId: me, priceMilli: Math.floor((a.price * 1000) / a.amount) }
          : { item: a.item, kind: "trade", onChain: false, pool, side: a.kind, amount: a.amount, bits: turn.outcome.bits, fee: turn.outcome.fee ?? 0, accountId: me },
        now,
      );
    }
    return seeded ? { ...turn, events: [seedEvent(t, false), ...turn.events] } : turn;
  });
}

/** His Bits, items and open listings in the simulated market, as it stands. */
export function npcSimHoldings(state: SimState): { bits: number; items: Record<string, number> } {
  // Before his first turn the seed hasn't been booked yet; it arrives with it.
  if (state.npc === undefined) return { bits: NPC_RULES.seedBits, items: {} };
  return { bits: state.wallets[NPC_SIM_ACCOUNT] ?? 0, items: { ...state.npc.items } };
}
