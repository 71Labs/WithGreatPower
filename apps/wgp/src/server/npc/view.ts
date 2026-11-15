/**
 * What the market screen's "Other traders" strip reads about Sandwich Man: whether he is
 * trading on chain, in the simulated market or off, his wallet, what he holds, his open
 * listings, the last lines of his ledger with their reasons, and who picks his moves
 * (`brain.mode`: "llm" with its model and `brain.provider`, or "rules"; the brain on each ledger line),
 * and what was checked about the last LLM answer he acted on (`brain.lastVerification`). Cached with the market
 * (tag "market", about 10 seconds); his own actions expire it.
 */
import { cacheLife, cacheTag } from "next/cache";

import { NPC_OFF_LINE, type NpcTraderView } from "@/lib/market/npc-api";
import { booksToday, itemName } from "@/lib/market/npc-book";
import { NPC_BRAIN } from "@/lib/market/npc-brain";
import { budgetLeft, NPC_ID, NPC_NAME, NPC_RULE_LINES, NPC_RULES, NPC_RULES_URL, npcStatus, statusLine, type NpcWallet } from "@/lib/market/npc-rules";
import { walletOnBook } from "@/lib/market/npc-turn";
import type { Listing } from "@/lib/market/engine";
import { EXPLORER_URL } from "@/lib/near/config";

import { getDb } from "../db/client";
import { readChainListings, readChainWallet } from "../market/chain";
import { MARKET_TAG, marketSource, poolsOf } from "../market/view";
import { npcBrainMode } from "./brain";
import { NPC_SIM_ACCOUNT, npcSignerKey, npcTraderAccount } from "./env";
import { npcSimHoldings } from "./sim";
import { brainCallsToday, readNpcState, type NpcState } from "./store";

/** Ledger lines the strip shows. */
const SHOWN = 5;

const off = (now: number): NpcTraderView => ({
  id: NPC_ID,
  name: NPC_NAME,
  mode: "off",
  accountId: null,
  explorerUrl: null,
  status: "off",
  statusLine: NPC_OFF_LINE,
  bits: null,
  items: [],
  listings: [],
  actionsLeft: 0,
  budgetLeft: 0,
  log: [],
  rules: NPC_RULE_LINES,
  rulesUrl: NPC_RULES_URL,
  seedBits: NPC_RULES.seedBits,
  now: new Date(now).toISOString(),
});

/** The newest LLM answer he acted on and what was checked about it: the last decision's, else the newest ledger line's. */
function lastVerification(state: NpcState): NonNullable<NpcTraderView["brain"]>["lastVerification"] {
  const d = state.lastDecision;
  const line = [...state.log].reverse().find((e) => e.verification);
  const pick = d?.verification ? { v: d.verification, at: d.at } : line?.verification ? { v: line.verification, at: line.at } : null;
  if (!pick) return null;
  const { v, at } = pick;
  return { at: new Date(at).toISOString(), provider: v.provider, model: v.model, chatId: v.chatId, signingAddress: v.signingAddress, signatureKind: v.signatureKind, verified: v.verified, reason: v.reason };
}

/** Who picks his moves here, the day's LLM calls left and the last pick, from his state. */
function brainView(onChain: boolean, state: NpcState, now: number): NonNullable<NpcTraderView["brain"]> {
  const { mode, model, provider } = npcBrainMode(onChain);
  const d = state.lastDecision;
  return {
    mode,
    model,
    provider,
    maxCallsPerDay: NPC_BRAIN.maxCallsPerDay,
    callsLeft: Math.max(0, NPC_BRAIN.maxCallsPerDay - brainCallsToday(state, now)),
    last: d ? { at: new Date(d.at).toISOString(), by: d.by, pick: d.pick, text: d.text, reason: d.reason, fallback: d.fallback, options: d.options } : null,
    lastVerification: lastVerification(state),
  };
}

export async function npcTraderView(): Promise<NpcTraderView> {
  "use cache";
  cacheTag(MARKET_TAG);
  cacheLife({ stale: 10, revalidate: 10, expire: 120 });
  return buildNpcView();
}

/** The view, read past the cache. */
export async function buildNpcView(now = new Date()): Promise<NpcTraderView> {
  const t = now.getTime();
  const source = await marketSource();
  const accountId = source.onChain ? npcTraderAccount() : NPC_SIM_ACCOUNT;
  if (!accountId) return off(t);
  const db = await getDb();
  const state = await readNpcState(db, source.onChain, accountId);
  const market = poolsOf(source);

  let wallet: NpcWallet;
  let listings: Listing[];
  if (source.onChain) {
    const [w, all] = await Promise.all([readChainWallet(accountId), readChainListings()]);
    wallet = { accountId, ...w, books: state.books };
    listings = all;
  } else {
    const book = source.sim.book;
    const held = npcSimHoldings(source.sim);
    const ledger = { balance: (_: string, token: string) => (token === "item:bits" ? held.bits : (held.items[token.slice(5)] ?? 0)), credit() {}, debit() {} };
    wallet = walletOnBook(book, ledger, accountId, state.books, t);
    listings = book.listings;
  }
  const books = booksToday(wallet.books, wallet.bits, t);
  const status = npcStatus(market, { ...wallet, books }, t);
  return {
    id: NPC_ID,
    name: NPC_NAME,
    mode: source.onChain ? "on-chain" : "simulated",
    accountId,
    explorerUrl: source.onChain ? `${EXPLORER_URL}/address/${accountId}` : null,
    status,
    statusLine: statusLine(status, wallet.bits),
    bits: wallet.bits,
    items: Object.entries(wallet.items)
      .filter(([, n]) => n > 0)
      .map(([item, amount]) => ({ item, name: itemName(item), amount })),
    listings: listings.filter((l) => l.seller === accountId).map((l) => ({ id: l.id, item: l.item, name: itemName(l.item), amount: l.amount, price: l.price })),
    actionsLeft: Math.max(0, NPC_RULES.maxActionsPerDay - books.actions),
    budgetLeft: budgetLeft(books),
    log: state.log
      .slice(-SHOWN)
      .reverse()
      .map((e) => ({
        at: new Date(e.at).toISOString(),
        kind: e.kind,
        text: e.text,
        reason: e.reason,
        txHash: e.txHash,
        txUrl: e.txHash ? `${EXPLORER_URL}/txns/${e.txHash}` : null,
        brain: e.brain ?? null,
        verified: e.verification ? e.verification.verified : null,
      })),
    brain: brainView(source.onChain, state, t),
    signerKey: source.onChain ? npcSignerKey() : null,
    rules: NPC_RULE_LINES,
    rulesUrl: NPC_RULES_URL,
    seedBits: NPC_RULES.seedBits,
    now: now.toISOString(),
  };
}
