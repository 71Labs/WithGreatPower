/**
 * Trade prompts: the one market step worth offering a player where they decide what to do
 * with their loot (the night's results, the Suit lab, Tonight). Everything here is pure:
 * what the player holds, the recipes and the pools the server just read go in; a prompt
 * with the contract's own quote comes out. No prompt ever invents a number: a cost is
 * `buyQuote`, proceeds are `sellQuote`, and a line about a price is `explainPrice`.
 *
 * A prompt carries a `TradeIntent`, which `tradeHref` turns into a link the market opens
 * as a prefilled trade sheet (item, side and amount), so the player confirms instead of
 * searching.
 */
import { ITEMS, STARTER_UNLOCK_LEVEL, SUITS } from "@wgp/game-core/data";
import type { ItemId, SuitId } from "@wgp/game-core/types";

import type { MarketItemView } from "./api";
import type { MarketParams } from "./config";
import { bitsText } from "./format";
import { buyQuote, sellQuote, spotMilli } from "./math";
import { suitOpen } from "./new-stock";
import { explainPrice, openingOf, type PriceState } from "./reasoning";

const ALL_SUITS = Object.keys(SUITS) as SuitId[];
const ALL_ITEMS = Object.keys(ITEMS) as ItemId[];
// Own keys only: "__proto__" in a link is not an item.
const isItem = (id: string | null | undefined): id is ItemId => !!id && Object.hasOwn(ITEMS, id);

/** What a player holds, as the prompts need it (a save's inventory, suits and hero level). */
export interface Holdings {
  inventory: Partial<Record<ItemId, number>>;
  suits: readonly SuitId[];
  level: number;
}

/** A save's holdings. A save without a hero counts as level 1. */
export const holdingsOf = (save: { inventory?: Partial<Record<ItemId, number>>; suits?: readonly SuitId[]; hero?: { level: number } | null }): Holdings => ({
  inventory: save.inventory ?? {},
  suits: save.suits ?? [],
  level: save.hero?.level ?? 1,
});

/** The market as the prompts need it: `MarketView`'s items and params. */
export interface MarketFacts {
  items: MarketItemView[];
  params: MarketParams;
}

/* ------------------------------------------------------------------ deep links */

export type TradeIntent = { kind: "trade"; item: ItemId; side: "buy" | "sell"; amount: number } | { kind: "list"; item: ItemId };

export const MARKET_PATH = "/play/market";

/** A link the market opens as a prefilled sheet. */
export function tradeHref(intent: TradeIntent): string {
  const q = intent.kind === "list" ? `item=${intent.item}&side=list` : `item=${intent.item}&side=${intent.side}&amount=${intent.amount}`;
  return `${MARKET_PATH}?${q}`;
}

/** The intent in a market link's query, or null for anything that isn't one. Amounts clamp to 1…`maxAmount`. */
export function parseTradeIntent(query: { get(name: string): string | null }, maxAmount = 20): TradeIntent | null {
  const item = query.get("item");
  const side = query.get("side");
  if (!isItem(item)) return null;
  if (side === "list") return { kind: "list", item };
  if (side !== "buy" && side !== "sell") return null;
  const n = Math.floor(Number(query.get("amount") ?? 1));
  return { kind: "trade", item, side, amount: Math.max(1, Math.min(maxAmount, Number.isFinite(n) ? n : 1)) };
}

/* ------------------------------------------------------------------ recipes against pockets */

export interface SuitGap {
  suit: SuitId;
  name: string;
  /** Parts the recipe still needs, in recipe order. */
  missing: { item: ItemId; short: number }[];
  minLevel: number;
  /** The hero is under the suit's level, so parts alone won't finish it. */
  levelShort: boolean;
}

/**
 * Every suit the player doesn't own that takes loot, with what it still needs. A suit made
 * from Gwei's new stock counts only once its items are open (`open`: ./new-stock.ts).
 */
export function suitGaps(h: Holdings, open: ReadonlySet<string> = new Set()): SuitGap[] {
  const gaps: SuitGap[] = [];
  for (const id of ALL_SUITS) {
    if (!suitOpen(id, open)) continue;
    const s = SUITS[id];
    const recipe = Object.entries(s.recipe) as [ItemId, number][];
    if (h.suits.includes(id) || recipe.length === 0) continue;
    const minLevel = s.starter ? STARTER_UNLOCK_LEVEL : s.minLevel;
    const missing = recipe.map(([item, need]) => ({ item, short: need - (h.inventory[item] ?? 0) })).filter((m) => m.short > 0);
    gaps.push({ suit: id, name: s.name, missing, minLevel, levelShort: h.level < minLevel });
  }
  return gaps;
}

/** Loot no suit the player still lacks would use: what they can sell or list without setting a recipe back. */
export function spareItems(h: Holdings): Partial<Record<ItemId, number>> {
  const reserved: Partial<Record<ItemId, number>> = {};
  for (const id of ALL_SUITS) {
    if (h.suits.includes(id)) continue;
    for (const [item, need] of Object.entries(SUITS[id].recipe) as [ItemId, number][]) reserved[item] = (reserved[item] ?? 0) + need;
  }
  const out: Partial<Record<ItemId, number>> = {};
  for (const item of ALL_ITEMS) {
    const spare = (h.inventory[item] ?? 0) - (reserved[item] ?? 0);
    if (spare > 0) out[item] = spare;
  }
  return out;
}

/* ------------------------------------------------------------------ quotes */

export type BuyOffer =
  /** Gwei can sell this many now; `cost` includes the gas fee. */
  | { ok: true; item: ItemId; amount: number; cost: number }
  /** She can't: `reason` is hers (closed, sold out) or says how many she has. */
  | { ok: false; item: ItemId; amount: number; reason: string; stock: number };

/** What buying `amount` of `item` from Gwei costs right now, or why she can't sell it. */
export function buyOffer(market: MarketFacts, item: ItemId, amount: number): BuyOffer | null {
  const view = market.items.find((i) => i.item === item);
  if (!view) return null;
  const why = explainPrice({ pool: view.pool, open: market.params.open, feeBps: market.params.feeBps });
  if (why.buyBlocked) return { ok: false, item, amount, reason: why.buyBlocked, stock: view.pool.stock };
  if (amount > market.params.maxAmount) return { ok: false, item, amount, reason: `Gwei sells at most ${market.params.maxAmount} at a time.`, stock: view.pool.stock };
  const quote = buyQuote(view.pool, amount, market.params.feeBps);
  if (!quote) return { ok: false, item, amount, reason: `Gwei has only ${view.pool.stock} left.`, stock: view.pool.stock };
  return { ok: true, item, amount, cost: quote.total };
}

/** The most of `item` (up to `amount`) Gwei can pay for right now, with what the player gets after the fee. */
export function sellOffer(market: MarketFacts, item: ItemId, amount: number): { item: ItemId; amount: number; proceeds: number } | null {
  const view = market.items.find((i) => i.item === item);
  if (!view) return null;
  const why = explainPrice({ pool: view.pool, open: market.params.open, feeBps: market.params.feeBps });
  if (why.sellBlocked) return null;
  for (let n = Math.min(amount, market.params.maxAmount); n >= 1; n--) {
    const quote = sellQuote(view.pool, n, market.params.feeBps);
    // Under a Bit after the fee, the contract would take the item and pay nothing.
    if (quote && quote.net >= 1) return { item, amount: n, proceeds: quote.net };
  }
  return null;
}

/* ------------------------------------------------------------------ the one next step */

export type TradePrompt =
  | {
      kind: "finish-suit";
      suit: SuitId;
      suitName: string;
      intent: Extract<TradeIntent, { kind: "trade" }>;
      itemName: string;
      /** Bits for the whole shortfall, fee included. */
      cost: number;
      /** False when the wallet is known and can't cover it; `needBits` says by how much. */
      affordable: boolean;
      needBits: number;
      /** What the suit still needs after this trade; empty when this trade finishes it. */
      then: { item: ItemId; short: number }[];
    }
  | {
      kind: "sell-spares";
      intent: Extract<TradeIntent, { kind: "trade" }>;
      itemName: string;
      /** Bits the player gets, after the fee. */
      proceeds: number;
      /** The suit those Bits would go towards, when one is a single part away but out of reach. */
      toward: { suitName: string; cost: number } | null;
    };

/**
 * The one trade worth offering, or null when there's none:
 *
 * 1. a suit that is one kind of part short (one or several of it, and not level-locked), when Gwei can sell the
 *    whole shortfall and the player can pay: buy it (the cheapest such suit first);
 * 2. otherwise spare loot no remaining recipe uses, when Gwei can pay: sell the stack
 *    worth the most (towards that suit, if there is one);
 * 3. otherwise the suit from 1 that the player can't afford yet, so they know the price;
 * 4. otherwise a step towards the suit that costs least to finish in all (several kinds
 *    of part short, every one in stock): its cheapest part the wallet covers.
 *
 * `bits` is the wallet when it is known (null for a guest or before it loads: then a buy
 * counts as affordable, and the market's own sheet has the last word).
 */
export function nextTrade(h: Holdings, market: MarketFacts, bits: number | null): TradePrompt | null {
  const finishes = suitGaps(h)
    .filter((g) => !g.levelShort && g.missing.length === 1)
    .map((g) => ({ gap: g, offer: buyOffer(market, g.missing[0]!.item, g.missing[0]!.short) }))
    .filter((c): c is { gap: SuitGap; offer: Extract<BuyOffer, { ok: true }> } => !!c.offer && c.offer.ok)
    .sort((a, b) => a.offer.cost - b.offer.cost);
  const finish = finishes[0] ?? null;
  const finishPrompt = (affordable: boolean): TradePrompt => ({
    kind: "finish-suit",
    suit: finish!.gap.suit,
    suitName: finish!.gap.name,
    intent: { kind: "trade", item: finish!.offer.item, side: "buy", amount: finish!.offer.amount },
    itemName: ITEMS[finish!.offer.item].name,
    cost: finish!.offer.cost,
    affordable,
    needBits: affordable || bits === null ? 0 : finish!.offer.cost - bits,
    then: [],
  });
  if (finish && (bits === null || bits >= finish.offer.cost)) return finishPrompt(true);

  const spares = spareItems(h);
  const sells = (Object.entries(spares) as [ItemId, number][])
    .map(([item, n]) => sellOffer(market, item, n))
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.proceeds - a.proceeds);
  const sell = sells[0];
  if (sell) {
    return {
      kind: "sell-spares",
      intent: { kind: "trade", item: sell.item, side: "sell", amount: sell.amount },
      itemName: ITEMS[sell.item].name,
      proceeds: sell.proceeds,
      toward: finish ? { suitName: finish.gap.name, cost: finish.offer.cost } : null,
    };
  }
  if (finish) return finishPrompt(false);

  // Nothing is one trade from done: take a step towards the suit that is fewest Bits away.
  type Ok = Extract<BuyOffer, { ok: true }>;
  const steps = suitGaps(h)
    .filter((g) => !g.levelShort && g.missing.length > 1)
    .map((g) => ({ gap: g, offers: g.missing.map((m) => buyOffer(market, m.item, m.short)) }))
    .filter((c): c is { gap: SuitGap; offers: Ok[] } => c.offers.every((o) => !!o && o.ok))
    .map((c) => ({ ...c, total: c.offers.reduce((sum, o) => sum + o.cost, 0) }))
    .sort((a, b) => a.total - b.total);
  for (const step of steps) {
    const offer = step.offers.filter((o) => bits === null || o.cost <= bits).sort((a, b) => a.cost - b.cost)[0];
    if (!offer) continue;
    return {
      kind: "finish-suit",
      suit: step.gap.suit,
      suitName: step.gap.name,
      intent: { kind: "trade", item: offer.item, side: "buy", amount: offer.amount },
      itemName: ITEMS[offer.item].name,
      cost: offer.cost,
      affordable: true,
      needBits: 0,
      then: step.gap.missing.filter((m) => m.item !== offer.item),
    };
  }
  return null;
}

/** A prompt's words: what's true (`title`), the button (`action`, verb first) and an optional aside. */
export function promptCopy(p: TradePrompt): { title: string; action: string; note: string | null } {
  if (p.kind === "finish-suit") {
    const rest = p.then.map((m) => `${ITEMS[m.item].name} ×${m.short}`).join(" and ");
    return {
      title: p.then.length ? `The ${p.suitName} suit still needs ${p.itemName} ×${p.intent.amount}` : `The ${p.suitName} suit is only missing ${p.itemName} ×${p.intent.amount}`,
      action: `Buy ${p.intent.amount === 1 ? "it" : "them"} from Gwei · ${bitsText(p.cost)}`,
      note: p.then.length ? `After that it needs ${rest}.` : p.affordable ? null : `You need ${bitsText(p.needBits)} more. A verified night pays Bits.`,
    };
  }
  return {
    title: `Spare ${p.itemName} ×${p.intent.amount}: more than the suits you’re missing need`,
    action: `Sell ${p.intent.amount === 1 ? "it" : "them"} to Gwei · +${bitsText(p.proceeds)}`,
    note: p.toward ? `That goes towards the ${p.toward.suitName} suit’s last part (${bitsText(p.toward.cost)}).` : null,
  };
}

/* ------------------------------------------------------------------ the market in one line */

export interface MarketPulse {
  item: ItemId;
  name: string;
  state: PriceState;
  /** Gwei's own headline for this pool, from `explainPrice`. */
  headline: string;
  stock: number;
  priceMilli: number;
}

/**
 * One true line about the market for a tile: the pool for `want` (the part the player is
 * after) when given, else the pool whose price has moved furthest from where it opened.
 * Null with no pools.
 */
export function marketPulse(market: MarketFacts, want?: ItemId | null): MarketPulse | null {
  if (market.items.length === 0) return null;
  const moved = (i: MarketItemView) => {
    const open = openingOf(i.pool);
    return open ? Math.abs(spotMilli(i.pool) - open.priceMilli) / open.priceMilli : 0;
  };
  const pick = (want && market.items.find((i) => i.item === want)) || market.items.reduce((best, i) => (moved(i) > moved(best) ? i : best), market.items[0]!);
  const why = explainPrice({ pool: pick.pool, open: market.params.open, feeBps: market.params.feeBps, change24h: pick.change24h, trades24h: pick.trades24h });
  return { item: pick.item, name: pick.name, state: why.state, headline: why.headline, stock: pick.pool.stock, priceMilli: pick.priceMilli };
}

/* ------------------------------------------------------------------ the Suit lab's buy lines */

/** Each buy line a locked recipe shows in the Suit lab: the part, how many, and Gwei's offer. */
export function partOffers(gap: SuitGap, market: MarketFacts): { item: ItemId; short: number; offer: BuyOffer | null }[] {
  return gap.missing.map((m) => ({ item: m.item, short: m.short, offer: buyOffer(market, m.item, m.short) }));
}
