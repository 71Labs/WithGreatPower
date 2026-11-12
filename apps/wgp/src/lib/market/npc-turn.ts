/**
 * One turn of Sandwich Man on a market book (./engine.ts): bring his books up to date,
 * ask his rules what to do (./npc-rules.ts `decide`), do the first thing through the
 * market's own rules, and write down what happened. The simulated market and
 * /lab/economy both run him with this; on chain the server's runner does the same steps
 * with his NEAR key (src/server/npc/runner.ts).
 */
import { ITEMS } from "@wgp/game-core/data";

import { BITS_TOKEN, itemToken } from "./config";
import { accountToday, buyListing, cancelListing, listItem, marketBuy, marketSell, MarketError, type Ledger, type MarketBook } from "./engine";
import { bitsText } from "./format";
import { reconcile, settle, settleRefused, booksToday, type NpcBooks, type NpcEvent, type NpcOutcome } from "./npc-book";
import { decide, SHOP_LEVELS, type NpcAction, type NpcWallet } from "./npc-rules";

const ITEM_IDS = Object.keys(ITEMS);

/** His wallet as the book and ledger show it: what `market_account` and balances say on chain. */
export function walletOnBook(book: MarketBook, ledger: Ledger, me: string, books: NpcBooks, nowMs: number): NpcWallet {
  const a = accountToday(book, me, nowMs);
  const p = book.params;
  const items: Record<string, number> = {};
  for (const id of ITEM_IDS) {
    const n = ledger.balance(me, itemToken(id));
    if (n > 0) items[id] = n;
  }
  return {
    accountId: me,
    bits: ledger.balance(me, BITS_TOKEN),
    items,
    tradesLeft: Math.max(0, p.dailyTrades - a.trades),
    listingsLeft: Math.max(0, p.dailyListings - a.listings),
    fillsLeft: Math.max(0, p.dailyFills - a.fills),
    fillBitsLeft: Math.max(0, p.dailyFillBits - a.fillBits),
    open: a.open,
    books,
  };
}

/** Runs an action through the market's rules. Throws MarketError if they refuse it. */
export function actOnBook(book: MarketBook, ledger: Ledger, me: string, action: NpcAction, nowMs: number): NpcOutcome {
  switch (action.kind) {
    case "fill": {
      const f = buyListing(book, ledger, me, action.listingId, nowMs);
      return { bits: f.listing.price, fee: f.fee };
    }
    case "buy": {
      const t = marketBuy(book, ledger, me, action.item, action.amount, action.maxBits, nowMs);
      return { bits: t.bits, fee: t.fee };
    }
    case "sell": {
      const t = marketSell(book, ledger, me, action.item, action.amount, action.minBits, nowMs);
      return { bits: t.bits, fee: t.fee };
    }
    case "list": {
      const l = listItem(book, ledger, me, action.item, action.amount, action.price, nowMs);
      return { bits: l.price, listingId: l.id };
    }
    case "cancel":
      cancelListing(book, ledger, me, action.listingId);
      return { bits: 0 };
  }
}

/** The ledger line for an action that went through, with the Bits the market reported. */
export function eventOf(action: NpcAction, outcome: NpcOutcome, nowMs: number, onChain: boolean, txHash: string | null = null): NpcEvent {
  const expected = action.kind === "buy" || action.kind === "sell" ? action.expectBits : null;
  // The price can move inside the trade's limit: print what was really paid or received.
  const text = expected !== null && expected !== outcome.bits ? action.text.replace(bitsText(expected), bitsText(outcome.bits)) : action.text;
  return { at: nowMs, kind: action.kind, item: action.item, amount: action.amount, bits: outcome.bits, text, reason: action.reason, onChain, txHash };
}

export interface NpcTurn {
  books: NpcBooks;
  /** What the market reported for his action, when it went through. */
  outcome: NpcOutcome | null;
  /** What happened this turn, oldest first: sales a player made of his listings, then his action. */
  events: NpcEvent[];
  /** The action he took, if any. */
  action: NpcAction | null;
  /** Set when the market refused his action (it should never be). */
  refused: string | null;
}

/** One turn on a book: at most one action. Changes `book` and the ledger. */
export function npcTurn(book: MarketBook, ledger: Ledger, me: string, before: NpcBooks, nowMs: number): NpcTurn {
  const first = walletOnBook(book, ledger, me, before, nowMs);
  const seen = reconcile(booksToday(before, first.bits, nowMs), first, book.listings, book.pools, book.params.feeBps, nowMs, false, SHOP_LEVELS);
  const wallet = { ...first, books: seen.books };
  const [action] = decide({ params: book.params, pools: book.pools }, wallet, book.listings, nowMs);
  if (!action) return { books: seen.books, events: seen.events, action: null, outcome: null, refused: null };
  try {
    const outcome = actOnBook(book, ledger, me, action, nowMs);
    return { books: settle(seen.books, action, outcome, nowMs), events: [...seen.events, eventOf(action, outcome, nowMs, false)], action, outcome, refused: null };
  } catch (error) {
    if (!(error instanceof MarketError)) throw error;
    return { books: settleRefused(seen.books), events: seen.events, action, outcome: null, refused: error.message };
  }
}
