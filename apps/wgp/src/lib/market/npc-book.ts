/**
 * Sandwich Man's books: what he paid for what he owns, what he has done today and the
 * listings he has open. His rules (./npc-rules.ts) read them; nothing here decides a
 * trade. Pure: the server's runner, the simulated market and /lab/economy all keep his
 * books with these functions, so he remembers the same way everywhere.
 *
 * The wallet is the truth and the books follow it: `reconcile` runs before every
 * decision, so a listing a player bought, a seed the owner minted or a run that died half
 * way is booked from what his wallet and the market actually show.
 */
import { ITEMS } from "@wgp/game-core/data";

import type { Listing } from "./engine";
import { bitsText } from "./format";
import { feeOf, spotMilli, type Pool } from "./math";

const DAY_MS = 86_400_000;

/** What he owns of one item (in his wallet or in his own listings) and the Bits it cost him. */
export interface NpcLot {
  units: number;
  cost: number;
}

export interface NpcOwnListing {
  id: number;
  item: string;
  amount: number;
  price: number;
  listedAtMs: number;
}

export interface NpcBooks {
  /** Days since the Unix epoch (UTC) the daily counters belong to. */
  day: number;
  /** Actions taken today (refused ones too, so a call that keeps failing can't loop). */
  actions: number;
  /** Bits spent on purchases today. */
  spent: number;
  /** His Bits when the day began; the day's budget is a share of this. */
  dayStartBits: number;
  lots: Record<string, NpcLot>;
  listed: NpcOwnListing[];
  /** He has closed shop (ran low on Bits) and hasn't yet earned enough to reopen. */
  closed: boolean;
  /** When he last sold each item to Gwei (Unix ms): he doesn't buy it back from her for a while. */
  soldToGwei: Record<string, number>;
}

export const newBooks = (): NpcBooks => ({ day: 0, actions: 0, spent: 0, dayStartBits: 0, lots: {}, listed: [], closed: false, soldToGwei: {} });

/** When the shop closes and reopens: under `closeBelow` Bits it closes, and it stays closed until `reopenAt`. */
export interface ShopLevels {
  closeBelow: number;
  reopenAt: number;
}

export type NpcEventKind = "fill" | "sell" | "list" | "buy" | "cancel" | "sold" | "seed";

/** One line of his ledger: what he did (`text`) and why, in his own words (`reason`). */
export interface NpcEvent {
  /** Unix ms. */
  at: number;
  kind: NpcEventKind;
  item: string | null;
  amount: number;
  /** Bits paid, received or asked. */
  bits: number;
  text: string;
  reason: string;
  onChain: boolean;
  txHash: string | null;
  /** Which brain picked the move (./npc-brain.ts): the LLM's model id (e.g. "kimi-k3") or "rules". Absent on lines no brain decided (a sale, the seed) and on older lines. */
  brain?: string;
}

export const itemName = (item: string) => (item in ITEMS ? ITEMS[item as keyof typeof ITEMS].name : item);

/** "2 × Crumbs". */
export const lotText = (amount: number, item: string) => `${amount} × ${itemName(item)}`;

/** The books with today's counters: a new UTC day starts them over from his Bits now. */
export function booksToday(books: NpcBooks, bits: number, nowMs: number): NpcBooks {
  const day = Math.floor(nowMs / DAY_MS);
  if (books.day === day) return books;
  return { ...books, day, actions: 0, spent: 0, dayStartBits: bits };
}

/** Bits `n` of an item cost him, rounded up, from the lot's average. */
export function costOf(lot: NpcLot | undefined, n: number): number {
  if (!lot || lot.units <= 0) return 0;
  return Math.ceil((lot.cost * n) / lot.units);
}

function takeUnits(lots: Record<string, NpcLot>, item: string, n: number): void {
  const lot = lots[item];
  if (!lot) return;
  const units = Math.max(0, lot.units - n);
  if (units === 0) delete lots[item];
  else lots[item] = { units, cost: Math.max(0, lot.cost - Math.floor((lot.cost * n) / lot.units)) };
}

function addUnits(lots: Record<string, NpcLot>, item: string, n: number, cost: number): void {
  const lot = lots[item] ?? { units: 0, cost: 0 };
  lots[item] = { units: lot.units + n, cost: lot.cost + cost };
}

/**
 * Brings the books in line with the wallet and the market's open listings:
 * - a listing of his that is gone was bought by a player (his own cancels are settled
 *   when he makes them), so it's booked as a sale and reported as an event;
 * - items he holds but never booked (the owner's one-off seed) are booked at Gwei's price;
 * - items the books hold but the wallet doesn't are written off;
 * - the shop closes when his Bits fall under `levels.closeBelow` and reopens at `levels.reopenAt`.
 */
export function reconcile(
  books: NpcBooks,
  wallet: { bits: number; items: Record<string, number> },
  listings: Listing[],
  pools: Pool[],
  feeBps: number,
  nowMs: number,
  onChain: boolean,
  levels: ShopLevels,
): { books: NpcBooks; events: NpcEvent[] } {
  const open = new Set(listings.map((l) => l.id));
  const lots: Record<string, NpcLot> = Object.fromEntries(Object.entries(books.lots).map(([k, v]) => [k, { ...v }]));
  const events: NpcEvent[] = [];
  const listed: NpcOwnListing[] = [];
  for (const l of books.listed) {
    if (open.has(l.id)) {
      listed.push(l);
      continue;
    }
    const got = l.price - feeOf(l.price, feeBps);
    const cost = costOf(lots[l.item], l.amount);
    takeUnits(lots, l.item, l.amount);
    events.push({
      at: nowMs,
      kind: "sold",
      item: l.item,
      amount: l.amount,
      bits: got,
      text: `A player bought my ${lotText(l.amount, l.item)} listing for ${bitsText(l.price)}`,
      reason: `Cost me ${cost}, cleared ${got} after gas. Somebody finally got in line behind me.`,
      onChain,
      txHash: null,
    });
  }
  const items = new Set([...Object.keys(wallet.items), ...Object.keys(lots)]);
  for (const item of items) {
    const owned = (wallet.items[item] ?? 0) + listed.filter((l) => l.item === item).reduce((n, l) => n + l.amount, 0);
    const booked = lots[item]?.units ?? 0;
    if (owned > booked) {
      const pool = pools.find((p) => p.item === item);
      addUnits(lots, item, owned - booked, pool ? Math.ceil((spotMilli(pool) * (owned - booked)) / 1000) : 0);
    } else if (owned < booked) {
      takeUnits(lots, item, booked - owned);
    }
  }
  const closed = wallet.bits < levels.closeBelow || (books.closed && wallet.bits < levels.reopenAt);
  return { books: { ...books, lots, listed, closed }, events };
}

/** What an action did, as the market reported it. */
export interface NpcOutcome {
  /** Bits he paid (a buy or a fill) or received (a sell). */
  bits: number;
  /** The gas fee the trade burned, when the market reported one. */
  fee?: number;
  /** The new listing's id, for a list. */
  listingId?: number;
}

/** The action as his rules chose it (./npc-rules.ts `NpcAction`), as far as the books care. */
export interface BookedAction {
  kind: "fill" | "sell" | "list" | "buy" | "cancel";
  item: string;
  amount: number;
  listingId?: number;
  price?: number;
}

/** The books after an action that went through. */
export function settle(books: NpcBooks, action: BookedAction, outcome: NpcOutcome, nowMs: number): NpcBooks {
  const lots: Record<string, NpcLot> = Object.fromEntries(Object.entries(books.lots).map(([k, v]) => [k, { ...v }]));
  let { spent, listed, soldToGwei } = books;
  switch (action.kind) {
    case "fill":
    case "buy":
      addUnits(lots, action.item, action.amount, outcome.bits);
      spent += outcome.bits;
      break;
    case "sell":
      takeUnits(lots, action.item, action.amount);
      soldToGwei = { ...soldToGwei, [action.item]: nowMs };
      break;
    case "list":
      if (outcome.listingId !== undefined) listed = [...listed, { id: outcome.listingId, item: action.item, amount: action.amount, price: action.price ?? 0, listedAtMs: nowMs }];
      break;
    case "cancel":
      listed = listed.filter((l) => l.id !== action.listingId);
      break;
  }
  return { ...books, lots, listed, spent, soldToGwei, actions: books.actions + 1 };
}

/** The books after an action the market refused: it still counts against the day. */
export const settleRefused = (books: NpcBooks): NpcBooks => ({ ...books, actions: books.actions + 1 });
