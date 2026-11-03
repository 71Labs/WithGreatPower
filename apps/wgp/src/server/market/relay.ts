/**
 * The relayer's market hooks (src/app/api/relay/meta). Market calls are relayed like any
 * game call; around them the server keeps its own records:
 *
 * - before: no market call while a ranked run is in flight, because the trade is mirrored
 *   into the save the run replays from (the same rule as menu actions);
 * - after a call that succeeded on chain: the item change is mirrored into the save
 *   (items a player buys are there to craft with, items sold or listed are gone), the
 *   trade goes into the price history, and the cached market view is expired.
 *
 * What the mirror applies comes from the contract's own return value, never the request.
 * A failure here is logged and swallowed: the chain already holds the truth.
 */
import { z } from "zod";

import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import { feeOf } from "@/lib/market/math";
import { MARKET_METHODS, type MarketMethod } from "@/lib/near/policy";

import type { Db } from "../db/client";
import { ensureSave, writeSave } from "../db/players";
import { rawListing, toListing, toPool } from "./chain";
import { recordTrade } from "./history";
import { assertNoRunInFlight } from "./sim";
import { marketView, refreshMarket } from "./view";

export const isMarketMethod = (method: string): method is MarketMethod => (MARKET_METHODS as readonly string[]).includes(method);

const u128 = z.union([z.string().regex(/^\d{1,30}$/), z.number().int().nonnegative()]).transform(Number);
const rawTrade = z.object({
  item: z.string(),
  amount: z.number().int().positive(),
  bits: u128,
  fee: u128,
  pool: z.object({ item: z.string(), virtual_bits: u128, virtual_items: u128, bits: u128, stock: u128, escrow: u128 }),
});

/** Refuses a market call while the player has a ranked run in flight. */
export async function beforeMarketRelay(db: Db, playerId: string): Promise<void> {
  await assertNoRunInFlight(db, playerId);
}

/** Adds `delta` of `item` to the save's inventory (never below zero), retrying a raced revision. */
export async function mirrorInventory(db: Db, playerId: string, item: string, delta: number, now = new Date()): Promise<boolean> {
  if (!(item in ITEMS) || delta === 0) return false;
  const id = item as ItemId;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { save, rev } = await ensureSave(db, playerId);
    const inventory = { ...(save.inventory ?? {}) };
    const next = Math.max(0, (inventory[id] ?? 0) + delta);
    if (next === 0) delete inventory[id];
    else inventory[id] = next;
    if ((await writeSave(db, playerId, { ...save, inventory }, rev, now)) !== null) return true;
  }
  return false;
}

export interface RelayedMarketCall {
  playerId: string;
  accountId: string;
  method: MarketMethod;
  /** The contract's JSON return value. */
  result: unknown;
  txHash: string;
}

/** After a market call succeeded on chain. Returns whether the save changed. Never throws. */
export async function afterMarketRelay(db: Db, call: RelayedMarketCall, now = new Date()): Promise<boolean> {
  try {
    let mirrored = false;
    switch (call.method) {
      case "market_buy":
      case "market_sell": {
        const t = rawTrade.parse(call.result);
        const side = call.method === "market_buy" ? "buy" : "sell";
        mirrored = await mirrorInventory(db, call.playerId, t.item, side === "buy" ? t.amount : -t.amount, now);
        await recordTrade(db, { item: t.item, kind: "trade", onChain: true, pool: toPool(t.pool), side, amount: t.amount, bits: t.bits, fee: t.fee, accountId: call.accountId, txHash: call.txHash }, now);
        break;
      }
      case "list_item":
      case "cancel_listing":
      case "buy_listing": {
        const l = toListing(rawListing.parse(call.result));
        mirrored = await mirrorInventory(db, call.playerId, l.item, call.method === "list_item" ? -l.amount : l.amount, now);
        const view = call.method === "buy_listing" ? await marketView() : null;
        const pool = view?.items.find((i) => i.item === l.item)?.pool;
        if (view && pool) {
          // A fill doesn't move the vendor's curve; the row carries the listing's unit price.
          await recordTrade(
            db,
            {
              item: l.item,
              kind: "fill",
              onChain: true,
              pool,
              side: "fill",
              amount: l.amount,
              bits: l.price,
              fee: feeOf(l.price, view.params.feeBps),
              accountId: call.accountId,
              txHash: call.txHash,
              priceMilli: Math.floor((l.price * 1000) / l.amount),
            },
            now,
          );
        }
        break;
      }
    }
    refreshMarket();
    return mirrored;
  } catch (error) {
    console.error(`[market] couldn't record ${call.method} ${call.txHash}: ${(error as Error).message}`);
    return false;
  }
}
