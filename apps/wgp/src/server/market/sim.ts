/**
 * The simulated Mempool Market: the contract's market run by the server, on the same
 * rules (src/lib/market/engine.ts), until the contract's market is live. Everything it
 * shows is flagged `onChain: false`.
 *
 * Its ledger stands in for the chain's balances:
 * - items are the player's save inventory (the server's save is authoritative, and the
 *   chain mirrors it through reward mints), so a bought glider is there to craft with;
 * - Bits are what the player's reward mints carry (queued in chain_ops, sent or not) plus
 *   the net of their simulated trades, kept in the sim's `wallets`.
 *
 * The book lives in one `market_sim` row, locked for each trade, so trades apply one at
 * a time; the save is written in the same transaction with its revision check.
 */
import { eq, sql } from "drizzle-orm";

import { ITEMS } from "@wgp/game-core/data";
import type { ItemId, Save } from "@wgp/game-core/types";

import { BITS_TOKEN, DEFAULT_PARAMS, seededPools } from "@/lib/market/config";
import { accountToday, buyListing, cancelListing, listItem, marketBuy, marketSell, newBook, type Fill, type Ledger, type Listing, type MarketBook, type Trade } from "@/lib/market/engine";

import { conflict } from "../http";
import type { Db } from "../db/client";
import { queryRows } from "../db/client";
import { MINT_KINDS } from "../db/outbox";
import { ensureSave, writeSave } from "../db/players";
import { marketSim, runs } from "../db/schema";
import { recordTrade } from "./history";

export const SIM_ID = "main";

export interface SimState {
  book: MarketBook;
  /** Net Bits each account gained or spent in simulated trades. */
  wallets: Record<string, number>;
}

export const seedSim = (): SimState => ({ book: newBook(DEFAULT_PARAMS, seededPools()), wallets: {} });

/** The sim's state, or a fresh seed (not stored until the first trade). */
export async function readSim(db: Db): Promise<SimState> {
  const [row] = await db.select({ state: marketSim.state }).from(marketSim).where(eq(marketSim.id, SIM_ID)).limit(1);
  return row ? (row.state as SimState) : seedSim();
}

/** Bits a player's reward mints carry, sent or still queued. */
export async function mintedBits(db: Db, playerId: string): Promise<number> {
  const [row] = await queryRows<{ bits: string | number | null }>(
    db,
    sql`select coalesce(sum((e->>'amount')::bigint), 0) as bits
        from chain_ops c, jsonb_array_elements(coalesce(c.payload->'items', '[]'::jsonb)) e
        where c.player_id = ${playerId}
          and c.kind in (${sql.join(
            MINT_KINDS.map((k) => sql`${k}`),
            sql`, `,
          )})
          and e->>'tokenId' = ${BITS_TOKEN}`,
  );
  return Number(row?.bits ?? 0);
}

const isItem = (id: string): id is ItemId => id in ITEMS;

/** The game items in a save's inventory, as the market sees them. */
export function marketItems(save: Save): Partial<Record<ItemId, number>> {
  const out: Partial<Record<ItemId, number>> = {};
  for (const [id, n] of Object.entries(save.inventory ?? {})) if (isItem(id) && n && n > 0) out[id] = n;
  return out;
}

export type SimAction =
  | { action: "buy"; item: ItemId; amount: number; maxBits: number }
  | { action: "sell"; item: ItemId; amount: number; minBits: number }
  | { action: "list"; item: ItemId; amount: number; price: number }
  | { action: "fill"; listingId: number }
  | { action: "cancel"; listingId: number };

export type SimReceipt = { kind: "trade"; trade: Trade } | { kind: "listing"; listing: Listing } | { kind: "fill"; fill: Fill } | { kind: "cancel"; listing: Listing };

export interface SimResult {
  receipt: SimReceipt;
  save: Save;
  rev: number;
  /** The player's Bits after it. */
  bits: number;
}

/** The ledger over one player's save and the sim's wallets. Others can only receive Bits. */
function simLedger(me: string, minted: number, inventory: Partial<Record<ItemId, number>>, wallets: Record<string, number>): Ledger {
  const item = (token: string) => {
    const id = token.slice("item:".length);
    if (!token.startsWith("item:") || !isItem(id)) throw new Error(`The simulated market has no ${token}`);
    return id;
  };
  return {
    balance(account, token) {
      if (token === BITS_TOKEN) return (account === me ? minted : 0) + (wallets[account] ?? 0);
      return account === me ? (inventory[item(token)] ?? 0) : 0;
    },
    credit(account, token, n) {
      if (token === BITS_TOKEN) wallets[account] = (wallets[account] ?? 0) + n;
      else if (account === me) inventory[item(token)] = (inventory[item(token)] ?? 0) + n;
      else throw new Error("Only the acting player receives items");
    },
    debit(account, token, n) {
      if (account !== me) throw new Error("Only the acting player pays");
      if (token === BITS_TOKEN) wallets[account] = (wallets[account] ?? 0) - n;
      else inventory[item(token)] = (inventory[item(token)] ?? 0) - n;
    },
  };
}

/** Refuses while a ranked run is in flight: the run replays from the save it started with. */
export async function assertNoRunInFlight(db: Db, playerId: string, now = new Date()): Promise<void> {
  const [inFlight] = await db
    .select({ id: runs.id, expiresAt: runs.expiresAt })
    .from(runs)
    .where(sql`${runs.playerId} = ${playerId} and ${runs.status} = 'issued'`)
    .limit(1);
  if (inFlight && inFlight.expiresAt > now) throw conflict("run_active", "Finish or abandon your patrol first, then trade", { runId: inFlight.id });
}

/**
 * One simulated trade for `player`: checks and applies it with the contract's rules,
 * writes the save, the book and the price history together. Throws MarketError when the
 * rules refuse, or an HttpError (run in flight, save changed).
 */
export async function simAct(db: Db, input: { playerId: string; accountId: string; act: SimAction; now?: Date }): Promise<SimResult> {
  const now = input.now ?? new Date();
  const { playerId, accountId: me, act } = input;
  await assertNoRunInFlight(db, playerId, now);

  return db.transaction(async (tx) => {
    await tx.insert(marketSim).values({ id: SIM_ID, state: seedSim(), rev: 0, updatedAt: now }).onConflictDoNothing({ target: marketSim.id });
    const [row] = await tx.select().from(marketSim).where(eq(marketSim.id, SIM_ID)).for("update");
    const state = row!.state as SimState;
    const book = state.book;
    const wallets = { ...state.wallets };
    const { save, rev } = await ensureSave(tx, playerId);
    const minted = await mintedBits(tx, playerId);
    const inventory: Partial<Record<ItemId, number>> = { ...(save.inventory ?? {}) };
    const ledger = simLedger(me, minted, inventory, wallets);
    const t = now.getTime();

    let receipt: SimReceipt;
    switch (act.action) {
      case "buy":
        receipt = { kind: "trade", trade: marketBuy(book, ledger, me, act.item, act.amount, act.maxBits, t) };
        break;
      case "sell":
        receipt = { kind: "trade", trade: marketSell(book, ledger, me, act.item, act.amount, act.minBits, t) };
        break;
      case "list":
        receipt = { kind: "listing", listing: listItem(book, ledger, me, act.item, act.amount, act.price, t) };
        break;
      case "fill":
        receipt = { kind: "fill", fill: buyListing(book, ledger, me, act.listingId, t) };
        break;
      case "cancel":
        receipt = { kind: "cancel", listing: cancelListing(book, ledger, me, act.listingId) };
        break;
    }

    let nextSave = save;
    let nextRev = rev;
    const changed = Object.keys(inventory).some((k) => inventory[k as ItemId] !== save.inventory?.[k as ItemId]);
    if (changed) {
      for (const k of Object.keys(inventory) as ItemId[]) if (!inventory[k]) delete inventory[k];
      nextSave = { ...save, inventory };
      const written = await writeSave(tx, playerId, nextSave, rev, now);
      if (written === null) throw conflict("rev_conflict", "Your save changed elsewhere; try again");
      nextRev = written;
    }
    await tx
      .update(marketSim)
      .set({ state: { book, wallets } satisfies SimState, rev: sql`${marketSim.rev} + 1`, updatedAt: now })
      .where(eq(marketSim.id, SIM_ID));

    if (receipt.kind === "trade") {
      const r = receipt.trade;
      await recordTrade(tx, { item: r.item, kind: "trade", onChain: false, pool: r.pool, side: r.side, amount: r.amount, bits: r.bits, fee: r.fee, accountId: me }, now);
    } else if (receipt.kind === "fill") {
      const { listing, fee } = receipt.fill;
      const pool = book.pools.find((p) => p.item === listing.item)!;
      const unit = Math.floor((listing.price * 1000) / listing.amount);
      await recordTrade(tx, { item: listing.item, kind: "fill", onChain: false, pool, side: "fill", amount: listing.amount, bits: listing.price, fee, accountId: me, priceMilli: unit }, now);
    }
    return { receipt, save: nextSave, rev: nextRev, bits: minted + (wallets[me] ?? 0) };
  });
}

export interface SimWallet {
  bits: number;
  items: Partial<Record<ItemId, number>>;
  tradesLeft: number;
  listingsLeft: number;
  fillsLeft: number;
  fillBitsLeft: number;
  open: number[];
}

/** A player's Bits, items and today's allowance in the simulated market. */
export async function simWallet(db: Db, input: { playerId: string; accountId: string; now?: Date }): Promise<SimWallet> {
  const now = input.now ?? new Date();
  const [state, { save }, minted] = await Promise.all([readSim(db), ensureSave(db, input.playerId), mintedBits(db, input.playerId)]);
  const p = state.book.params;
  const a = accountToday(state.book, input.accountId, now.getTime());
  return {
    bits: minted + (state.wallets[input.accountId] ?? 0),
    items: marketItems(save),
    tradesLeft: Math.max(0, p.dailyTrades - a.trades),
    listingsLeft: Math.max(0, p.dailyListings - a.listings),
    fillsLeft: Math.max(0, p.dailyFills - a.fills),
    fillBitsLeft: Math.max(0, p.dailyFillBits - a.fillBits),
    open: a.open,
  };
}
