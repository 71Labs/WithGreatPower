/**
 * What the market screen's "Other traders" strip reads about Sandwich Man: whether he is
 * trading on chain, in the simulated market or off, his wallet, what he holds, his open
 * listings and the last lines of his ledger with their reasons. Cached with the market
 * (tag "market", about 10 seconds); his own actions expire it.
 */
import { cacheLife, cacheTag } from "next/cache";

import { NPC_OFF_LINE, type NpcTraderView } from "@/lib/market/npc-api";
import { booksToday, itemName } from "@/lib/market/npc-book";
import { budgetLeft, NPC_ID, NPC_NAME, NPC_RULE_LINES, NPC_RULES, NPC_RULES_URL, npcStatus, statusLine, type NpcWallet } from "@/lib/market/npc-rules";
import { walletOnBook } from "@/lib/market/npc-turn";
import type { Listing } from "@/lib/market/engine";
import { EXPLORER_URL } from "@/lib/near/config";

import { getDb } from "../db/client";
import { readChainListings, readChainWallet } from "../market/chain";
import { MARKET_TAG, marketSource, poolsOf } from "../market/view";
import { NPC_SIM_ACCOUNT, npcTraderAccount } from "./env";
import { npcSimHoldings } from "./sim";
import { readNpcState } from "./store";

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
      })),
    rules: NPC_RULE_LINES,
    rulesUrl: NPC_RULES_URL,
    seedBits: NPC_RULES.seedBits,
    now: now.toISOString(),
  };
}
