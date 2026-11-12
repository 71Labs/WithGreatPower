/**
 * Sandwich Man's runner: one look at the market, at most one action.
 *
 * It is never scheduled. A look happens after a request, through `after()`
 * (src/server/background.ts `npcTraderSoon`):
 * - when real market activity lands: a player's relayed trade or listing (the relayer's
 *   market hook, src/server/market/relay.ts) or a simulated one (/api/market/trade);
 * - when someone reads the market, at most once every five minutes.
 *
 * Each look: take his lock (src/server/npc/store.ts; no two looks overlap, and none within
 * MIN_GAP_MS of the last), read the market, his wallet and the listings, bring his books
 * up to date, ask `decide` (src/lib/market/npc-rules.ts) and send the first action only.
 * Against the contract he signs with his own key (./chain.ts); when the simulated market
 * stands in, he trades there (./sim.ts). Whatever happens is written to his ledger with
 * its reason, and a trade also goes into the price history like any player's.
 *
 * On chain he is OFF unless NPC_TRADER_ACCOUNT_ID and NPC_TRADER_PRIVATE_KEY are set.
 */
import { booksToday, reconcile, settle, settleRefused, type NpcEvent } from "@/lib/market/npc-book";
import { decide, SHOP_LEVELS, type NpcAction, type NpcWallet } from "@/lib/market/npc-rules";
import { eventOf } from "@/lib/market/npc-turn";
import type { Listing } from "@/lib/market/engine";
import type { KeyedAccountEnv } from "../near/env";

import type { Db } from "../db/client";
import { readChainListings, readChainMarket, readChainWallet, type ChainMarket, type ChainWallet } from "../market/chain";
import { recordTrade } from "../market/history";
import { marketView, refreshMarket } from "../market/view";
import { sendNpcAction, type NpcSent } from "./chain";
import { NPC_SIM_ACCOUNT, npcTraderEnv } from "./env";
import { npcSimTurn } from "./sim";
import { claimRun, finishRun, type NpcState } from "./store";

/** No look within this long of the last one, whatever triggers it. */
export const MIN_GAP_MS = 20_000;

export interface NpcRunReport {
  /** Whether he looked at the market (took the lock). */
  ran: boolean;
  /** Why he didn't look, or why a look ended without an action. */
  why?: "off" | "busy" | "too_soon" | "nothing_to_do" | "refused";
  onChain: boolean;
  /** What he did, if anything. */
  event?: NpcEvent;
  /** The market's words when it refused him. */
  error?: string;
}

/** The chain as the runner needs it; tests swap in a fake. */
export interface NpcChain {
  market(): Promise<ChainMarket | null>;
  listings(): Promise<Listing[]>;
  wallet(accountId: string): Promise<ChainWallet>;
  send(env: KeyedAccountEnv, action: NpcAction, feeBps: number): Promise<NpcSent>;
}

const realChain: NpcChain = { market: readChainMarket, listings: readChainListings, wallet: readChainWallet, send: sendNpcAction };

export interface NpcRunOptions {
  now?: Date;
  minGapMs?: number;
  /** His on-chain account and key; defaults to the environment. Null is "off". */
  env?: KeyedAccountEnv | null;
  /** Whether the contract's market is live; defaults to what the market view says. */
  onChain?: boolean;
  chain?: NpcChain;
}

function expireMarket() {
  try {
    refreshMarket();
  } catch {
    // Outside a request there's no cache to expire; it goes stale in seconds anyway.
  }
}

async function chainTurn(db: Db, state: NpcState, env: KeyedAccountEnv, chain: NpcChain, now: Date) {
  const t = now.getTime();
  const market = await chain.market();
  if (!market) return { books: state.books, events: [] as NpcEvent[], report: { why: "nothing_to_do" } as const };
  const [listings, w] = await Promise.all([chain.listings(), chain.wallet(env.accountId)]);
  const first: NpcWallet = { accountId: env.accountId, bits: w.bits, items: w.items, tradesLeft: w.tradesLeft, listingsLeft: w.listingsLeft, fillsLeft: w.fillsLeft, fillBitsLeft: w.fillBitsLeft, open: w.open, books: state.books };
  const seen = reconcile(booksToday(state.books, w.bits, t), first, listings, market.pools, market.params.feeBps, t, true, SHOP_LEVELS);
  const [action] = decide(market, { ...first, books: seen.books }, listings, t);
  if (!action) return { books: seen.books, events: seen.events, report: { why: "nothing_to_do" } as const };

  const sent = await chain.send(env, action, market.params.feeBps);
  if (!sent.ok) {
    console.error(`[npc] ${action.kind} ${action.item} refused: ${sent.error}`);
    return { books: settleRefused(seen.books), events: seen.events, refusal: { at: t, text: action.text, error: sent.error, txHash: sent.txHash }, report: { why: "refused", error: sent.error } as const };
  }
  const event = eventOf(action, sent.outcome, t, true, sent.txHash);
  if (action.kind === "buy" || action.kind === "sell" || action.kind === "fill") {
    // The price history row any relayed trade writes (src/server/market/relay.ts), under his account.
    const after = action.kind === "fill" ? market : ((await chain.market().catch(() => null)) ?? market);
    const pool = after.pools.find((p) => p.item === action.item);
    if (pool) {
      await recordTrade(
        db,
        {
          item: action.item,
          kind: action.kind === "fill" ? "fill" : "trade",
          onChain: true,
          pool,
          side: action.kind,
          amount: action.amount,
          bits: sent.outcome.bits,
          fee: sent.outcome.fee ?? 0,
          accountId: env.accountId,
          txHash: sent.txHash,
          ...(action.kind === "fill" ? { priceMilli: Math.floor((action.price * 1000) / action.amount) } : {}),
        },
        now,
      ).catch((error: unknown) => console.error(`[npc] couldn't record ${sent.txHash}: ${(error as Error).message}`));
    }
  }
  return { books: settle(seen.books, action, sent.outcome, t), events: [...seen.events, event], refusal: null, report: { event } as const };
}

/**
 * One look. Safe to call at any time and any number of times: it does nothing when he is
 * off, when another look is running or when the last one was under `minGapMs` ago.
 */
export async function runNpcTrader(db: Db, opts: NpcRunOptions = {}): Promise<NpcRunReport> {
  const now = opts.now ?? new Date();
  const t = now.getTime();
  const onChain = opts.onChain ?? (await marketView()).onChain;
  const env = onChain ? (opts.env === undefined ? npcTraderEnv() : opts.env) : null;
  if (onChain && !env) return { ran: false, why: "off", onChain };
  const accountId = env?.accountId ?? NPC_SIM_ACCOUNT;

  const claim = await claimRun(db, onChain, accountId, t, opts.minGapMs ?? MIN_GAP_MS);
  if (!claim.ok) return { ran: false, why: claim.why, onChain };

  let update: Parameters<typeof finishRun>[3] = {};
  let report: Pick<NpcRunReport, "why" | "event" | "error"> = { why: "nothing_to_do" };
  try {
    if (env) {
      const turn = await chainTurn(db, claim.state, env, opts.chain ?? realChain, now);
      update = { books: turn.books, events: turn.events, refusal: turn.refusal };
      report = turn.report;
    } else {
      const turn = await npcSimTurn(db, claim.state.books, now);
      update = { books: turn.books, events: turn.events, refusal: turn.refused && turn.action ? { at: t, text: turn.action.text, error: turn.refused, txHash: null } : undefined };
      const event = turn.action && !turn.refused ? turn.events.at(-1) : undefined;
      report = turn.refused ? { why: "refused", error: turn.refused } : event ? { event } : { why: "nothing_to_do" };
    }
  } finally {
    // Always free the lock; a look that threw keeps the books it started with.
    await finishRun(db, onChain, claim.state, update, t);
  }
  if (update.events?.length) expireMarket();
  return { ran: true, onChain, ...report };
}
