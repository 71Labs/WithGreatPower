/**
 * Sandwich Man's calls to the game contract, signed by his own account with his own key
 * (NPC_TRADER_ACCOUNT_ID / NPC_TRADER_PRIVATE_KEY). He pays his own gas and attaches no
 * deposit. `npcCall` is the whole list of what he can send: the five market methods any
 * player's session key may call (src/lib/near/policy.ts MARKET_METHODS) and nothing else.
 */
import { actions } from "near-api-js";
import { z } from "zod";

import { feeOf } from "@/lib/market/math";
import type { NpcOutcome } from "@/lib/market/npc-book";
import type { NpcAction } from "@/lib/market/npc-rules";
import { MARKET_METHODS, TGAS, type MarketMethod } from "@/lib/near/policy";

import { rawListing } from "../market/chain";
import { chainEnv, type KeyedAccountEnv } from "../near/env";
import { summarizeOutcome } from "../near/relay";
import { keyedAccount } from "../near/rpc";

/** Market calls burn about 2.5 to 3.5 Tgas; unused gas is refunded. */
const NPC_GAS = 30n * TGAS;

/** The contract method and JSON arguments for an action. Pure. */
export function npcCall(action: NpcAction): { method: MarketMethod; args: Record<string, unknown> } {
  switch (action.kind) {
    case "fill":
      return { method: "buy_listing", args: { listing_id: action.listingId } };
    case "buy":
      return { method: "market_buy", args: { item: action.item, amount: action.amount, max_bits: String(action.maxBits) } };
    case "sell":
      return { method: "market_sell", args: { item: action.item, amount: action.amount, min_bits: String(action.minBits) } };
    case "list":
      return { method: "list_item", args: { item: action.item, amount: action.amount, price_bits: String(action.price) } };
    case "cancel":
      return { method: "cancel_listing", args: { listing_id: action.listingId } };
  }
}

const u128 = z.union([z.string().regex(/^\d{1,30}$/), z.number().int().nonnegative()]).transform(Number);
const rawTrade = z.object({ bits: u128, fee: u128 });

export type NpcSent = { ok: true; outcome: NpcOutcome; txHash: string } | { ok: false; error: string; txHash: string | null };

/** What the contract's return value says the action did. Throws on a shape it doesn't know. */
export function outcomeOf(action: NpcAction, result: unknown, feeBps: number): NpcOutcome {
  switch (action.kind) {
    case "buy":
    case "sell": {
      const t = rawTrade.parse(result);
      return { bits: t.bits, fee: t.fee };
    }
    case "fill": {
      const l = rawListing.parse(result);
      return { bits: l.price, fee: feeOf(l.price, feeBps) };
    }
    case "list": {
      const l = rawListing.parse(result);
      return { bits: l.price, listingId: l.id };
    }
    case "cancel":
      rawListing.parse(result);
      return { bits: 0 };
  }
}

/** Signs and sends one action from his account and waits for it. A refusal comes back as `ok: false`. */
export async function sendNpcAction(env: KeyedAccountEnv, action: NpcAction, feeBps: number): Promise<NpcSent> {
  const { method, args } = npcCall(action);
  if (!(MARKET_METHODS as readonly string[]).includes(method)) throw new Error(`Not a market method: ${method}`);
  const outcome = await keyedAccount(env.accountId, env.privateKey).signAndSendTransaction({
    receiverId: chainEnv().contractId,
    actions: [actions.functionCall(method, args, NPC_GAS, 0n)],
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: false,
  });
  const summary = summarizeOutcome(outcome as unknown as Parameters<typeof summarizeOutcome>[0]);
  if (!summary.ok) return { ok: false, error: summary.error ?? "The contract refused the call", txHash: summary.txHash };
  return { ok: true, outcome: outcomeOf(action, summary.result, feeBps), txHash: summary.txHash };
}
