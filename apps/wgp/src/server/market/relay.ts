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
import { INVEST_METHODS, MARKET_METHODS, type InvestMethod, type MarketMethod } from "@/lib/near/policy";

import type { Db } from "../db/client";
import { ensureSave, writeSave } from "../db/players";
import { HttpError } from "../http";
import { investingLive, rawListing, rawStakeReceipt, toListing, toPool, toStakeReceipt, type ChainReader } from "./chain";
import { recordStake, recordTrade } from "./history";
import { settleMarketQuest } from "./quest";
import { assertNoRunInFlight } from "./sim";
import { marketView, refreshMarket } from "./view";
import { npcTraderSoon } from "../background";

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

/* ------------------------------------------------------------------ investing (contract v3 only) */

export const isInvestMethod = (method: string): method is InvestMethod => (INVEST_METHODS as readonly string[]).includes(method);

/**
 * Before an investing call is relayed: the live contract must be v3. Mainnet runs v2, which
 * has no such method, so the call would only burn the relayer's gas and fail; it is refused
 * here instead, before anything is sent (409 invest_unsupported). Also the market's own
 * rule: nothing while a ranked run is in flight. `reader` is for tests.
 */
export async function beforeInvestRelay(db: Db, playerId: string, reader?: ChainReader): Promise<void> {
  if (!(await investingLive(reader))) {
    throw new HttpError(409, "invest_unsupported", "Investing in a merchant is built into contract v3, which isn't live yet");
  }
  await assertNoRunInFlight(db, playerId);
}

export interface RelayedInvestCall {
  playerId: string;
  accountId: string;
  method: InvestMethod;
  /** The contract's JSON return value (a StakeReceipt). */
  result: unknown;
  txHash: string;
}

/** After an investing call succeeded on chain: one history row and a fresh market. Never throws. */
export async function afterInvestRelay(db: Db, call: RelayedInvestCall, now = new Date()): Promise<boolean> {
  try {
    const r = toStakeReceipt(rawStakeReceipt.parse(call.result));
    const side = call.method === "market_invest" ? "invest" : call.method === "market_withdraw" ? "withdraw" : "claim";
    await recordStake(db, { item: r.item, onChain: true, pool: r.pool, side, bits: r.bits, earned: r.earned, accountId: call.accountId, txHash: call.txHash }, now);
    refreshMarket();
    return true;
  } catch (error) {
    console.error(`[market] couldn't record ${call.method} ${call.txHash}: ${(error as Error).message}`);
    return false;
  }
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
    // A trade that landed on chain completes today's market quest (XP, once a day; ./quest.ts).
    if (call.method === "market_buy" || call.method === "market_sell" || call.method === "buy_listing") {
      const quest = await settleMarketQuest(db, { playerId: call.playerId, now });
      if (quest?.state === "completed") mirrored = true;
    }
    // Real activity just landed: Sandwich Man, the NPC trader, takes one look after the response.
    npcTraderSoon("activity");
    return mirrored;
  } catch (error) {
    console.error(`[market] couldn't record ${call.method} ${call.txHash}: ${(error as Error).message}`);
    return false;
  }
}
