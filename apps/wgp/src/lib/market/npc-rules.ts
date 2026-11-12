/**
 * SANDWICH MAN'S TRADING RULES: the one file to read.
 *
 * Sandwich Man is the Mempool Market's arbitrageur, an NPC with his own NEAR wallet. He
 * is an ordinary market participant: his Bits and items are NEP-245 balances of his own
 * account, he signs his own calls with his own key, and he uses only the five methods
 * every player uses (market_buy, market_sell, list_item, buy_listing, cancel_listing).
 * The contract gives him no special power, no discount and no cap of his own: every
 * limit a player has, he has.
 *
 * Nobody tells him what to trade. `decide` below is everything he does: a pure function
 * of the market as it stands, his wallet, the open listings and the time. Same inputs,
 * same answer. He acts only when the market moves (a player's trade or listing lands) or
 * someone opens it, one action at a time.
 *
 * THE RULES, IN PLAIN ENGLISH (the first one that fits is the one he takes)
 *
 * 1. Take down a stale listing. A listing of his that has sat for 48 hours comes down, so
 *    the items can be priced again.
 *
 * 2. Flip a cheap listing. He buys a player's listing when Gwei would pay him at least
 *    10% more for the same lot right now (and at least 1 Bit more), after her gas fee.
 *    Of several, he takes the one with the most in it. The seller is paid in full at
 *    their own asking price.
 *
 * 3. Cash out to Gwei. He sells items to Gwei when she pays at least 10% more than they
 *    cost him. The call carries that floor as its limit, so the contract itself refuses
 *    the sale if her price drops under it first.
 *
 * 4. Undercut Gwei. If she won't pay enough, he lists up to 2 of an item at 6% under what
 *    she charges for them, as long as that is still 10% over his cost. When Gwei is sold
 *    out he asks 25% over her spot price instead. One listing per item.
 *
 * 5. Buy the dip. He buys 2 of an item from Gwei when its price is under 85% of its
 *    opening price, deepest dip first.
 *
 * 6. Clearance sale. Only while he is broke (see below): he sells up to 2 of whatever
 *    loses him least to Gwei at her price, loss or not, until he can open again.
 *
 * WHAT HE NEVER DOES
 *
 * - Spend more than 35% of the Bits he started the day with, in one UTC day.
 * - Take more than 10 actions a day (a refused call counts as one). That is inside every
 *   daily cap the contract sets, whichever kind of action they are.
 * - Hold more than 8 of any item, his own listings included.
 * - Pay more per item than 150% of its opening price, whatever Gwei's price says.
 * - Buy his own listing, or trade with himself in any way: the contract refuses it too.
 * - Decide on a call the contract would refuse. Every check the contract makes (market
 *   open, lot size, stock, till, listing price bounds, open-listing cap, daily caps,
 *   balance) is made here first, on the numbers he just read. If the market moves before
 *   his call lands, the contract refuses it; that costs him gas and one of his actions.
 * - Buy back from Gwei an item he sold her in the last 72 hours. No quick round trips:
 *   selling to her and buying straight back would be volume for its own sake.
 * - Buy anything while he is broke. Under 60 Bits he closes shop: no purchases at all,
 *   and he stays closed until he is back to 120 Bits. He still sells and lists what he
 *   has (rules 3, 4 and 6), which is how he reopens.
 *
 * The numbers above are `NPC_RULES` below; `npc-rules.test.ts` fails if this comment and
 * the constants drift apart. His bookkeeping (cost of what he holds, today's counters)
 * is ./npc-book.ts. Gwei's own pricing rules are ./math.ts.
 */
import { seededPools, type MarketParams } from "./config";
import type { Listing } from "./engine";
import { bitsText } from "./format";
import { buyQuote, lessSlippage, listingBounds, sellQuote, spotMilli, withSlippage, type Pool } from "./math";
import { booksToday, costOf, lotText, type NpcBooks } from "./npc-book";

export const NPC_RULES = {
  /** Rule 1: a listing older than this comes down. */
  staleListingHours: 48,
  /** Rule 2: Gwei must pay this much over a listing's price (1000 = 10%), and at least `flipMinBits`. */
  flipMarginBps: 1_000,
  flipMinBits: 1,
  /** Rules 3 and 4: he sells at this much over cost or not at all. */
  profitBps: 1_000,
  /** Rule 4: his listing sits this far under Gwei's price for the lot… */
  undercutBps: 600,
  /** …or this far over her spot price when she is sold out. */
  soldOutMarkupBps: 2_500,
  listLot: 2,
  /** Rule 5: under this share of the opening price counts as a dip. */
  dipBps: 8_500,
  dipLot: 2,
  /** Rule 6: items he clears to Gwei at a time while broke. */
  clearanceLot: 2,
  /** Share of the day's opening Bits he may spend in a UTC day. */
  dailySpendBps: 3_500,
  maxActionsPerDay: 10,
  /** Of one item, his own listings included. */
  inventoryCap: 8,
  /** Never more per item than this share of its opening price. */
  maxPayBps: 15_000,
  /** Under this many Bits he closes shop… */
  closeBelowBits: 60,
  /** …and he reopens once he is back to this many. */
  reopenAtBits: 120,
  /** He doesn't buy an item from Gwei within this long of selling it to her. */
  roundTripHours: 72,
  /** Room a vendor trade's limit leaves for the price moving first (200 = 2%). */
  slippageBps: 200,
  /** The one-off seed: the only Bits he doesn't earn by trading. */
  seedBits: 300,
} as const;

export const NPC_ID = "sandwich-man" as const;
export const NPC_NAME = "Sandwich Man";
export const NPC_RULES_URL = "https://github.com/71Labs/WithGreatPower/blob/main/apps/wgp/src/lib/market/npc-rules.ts";

/** The rules as the market screen's popover prints them. */
export const NPC_RULE_LINES: readonly string[] = [
  `Buys a player’s listing when Gwei would pay at least ${NPC_RULES.flipMarginBps / 100}% more for it.`,
  `Sells to Gwei only at ${NPC_RULES.profitBps / 100}% over what he paid.`,
  `Otherwise lists ${NPC_RULES.undercutBps / 100}% under Gwei’s price.`,
  `Buys from Gwei when a price is under ${NPC_RULES.dipBps / 100}% of where it opened.`,
  `Spends at most ${NPC_RULES.dailySpendBps / 100}% of his Bits a day, in at most ${NPC_RULES.maxActionsPerDay} actions.`,
  `Under ${NPC_RULES.closeBelowBits} Bits he closes shop: no buying, and a clearance sale until he is back to ${NPC_RULES.reopenAtBits}.`,
  `Never buys back from Gwei what he sold her in the last ${NPC_RULES.roundTripHours} hours.`,
];

export const SHOP_LEVELS = { closeBelow: NPC_RULES.closeBelowBits, reopenAt: NPC_RULES.reopenAtBits } as const;

const BPS = 10_000;
const HOUR_MS = 3_600_000;

export interface NpcMarket {
  params: MarketParams;
  pools: Pool[];
}

/** His wallet as the contract reports it (`market_account`, balances), plus his books. */
export interface NpcWallet {
  accountId: string;
  bits: number;
  /** Items in the wallet; listed items are in escrow, not here. */
  items: Record<string, number>;
  tradesLeft: number;
  listingsLeft: number;
  fillsLeft: number;
  fillBitsLeft: number;
  /** Ids of his open listings. */
  open: number[];
  books: NpcBooks;
}

interface Said {
  /** What he did, in plain words: "Bought 2 × Crumbs from azalleaxyz’s listing at 9 Bits". */
  text: string;
  /** Why, in his voice: "Gwei pays 11. Lunch money." */
  reason: string;
  /** The rule that fired (1–6, as numbered above). */
  rule: number;
}

export type NpcAction = Said &
  (
    | { kind: "cancel"; listingId: number; item: string; amount: number }
    | { kind: "fill"; listingId: number; item: string; amount: number; price: number; seller: string }
    | { kind: "sell"; item: string; amount: number; minBits: number; expectBits: number }
    | { kind: "list"; item: string; amount: number; price: number }
    | { kind: "buy"; item: string; amount: number; maxBits: number; expectBits: number }
  );

export type NpcStatus = "open" | "closed-shop" | "resting" | "market-closed";

const OPENING = new Map(seededPools().map((p) => [p.item, spotMilli(p)]));

/** An item's opening spot price × 1000, or null for an item the market didn't open with. */
export const openingMilli = (item: string): number | null => OPENING.get(item) ?? null;

const share = (n: number, bps: number) => Math.floor((n * bps) / BPS);
const over = (n: number, bps: number) => Math.ceil((n * (BPS + bps)) / BPS);
const who = (account: string) => account.split(".")[0] ?? account;

/** Bits he may still spend today. */
export function budgetLeft(books: NpcBooks): number {
  return Math.max(0, share(books.dayStartBits, NPC_RULES.dailySpendBps) - books.spent);
}

/** Broke: under the closing level, or closed earlier and not yet back to the reopening level. */
export const isClosed = (wallet: Pick<NpcWallet, "bits" | "books">) =>
  wallet.bits < NPC_RULES.closeBelowBits || (wallet.books.closed && wallet.bits < NPC_RULES.reopenAtBits);

/** Whether he is trading, and if not, why. */
export function npcStatus(market: NpcMarket, wallet: NpcWallet, nowMs: number): NpcStatus {
  if (!market.params.open) return "market-closed";
  const books = booksToday(wallet.books, wallet.bits, nowMs);
  if (books.actions >= NPC_RULES.maxActionsPerDay) return "resting";
  if (isClosed(wallet)) return "closed-shop";
  return "open";
}

/**
 * Everything Sandwich Man would do right now, best first. The runner sends only the
 * first. Pure and deterministic: no clock but `nowMs`, no randomness, no I/O.
 */
export function decide(market: NpcMarket, wallet: NpcWallet, listings: Listing[], nowMs: number): NpcAction[] {
  const { params, pools } = market;
  const R = NPC_RULES;
  if (!params.open) return [];
  const books = booksToday(wallet.books, wallet.bits, nowMs);
  if (books.actions >= R.maxActionsPerDay) return [];

  const me = wallet.accountId;
  const pool = (item: string) => pools.find((p) => p.item === item);
  const held = (item: string) => wallet.items[item] ?? 0;
  const mine = listings.filter((l) => l.seller === me);
  /** In the wallet plus in his own listings. */
  const owned = (item: string) => held(item) + mine.filter((l) => l.item === item).reduce((n, l) => n + l.amount, 0);
  /** The most he pays for `n` of an item, whatever the market says. */
  const ceiling = (item: string, n: number) => {
    const open = openingMilli(item);
    return open === null ? 0 : Math.floor((open * n * R.maxPayBps) / (1000 * BPS));
  };
  const shopOpen = !isClosed(wallet);
  const budget = budgetLeft(books);
  const out: NpcAction[] = [];

  // 1. Take down a stale listing. (cancel_listing checks only that it's his and still open.)
  for (const l of mine) {
    if (nowMs - l.listedAtMs < R.staleListingHours * HOUR_MS) continue;
    out.push({
      kind: "cancel",
      rule: 1,
      listingId: l.id,
      item: l.item,
      amount: l.amount,
      text: `Took down my ${lotText(l.amount, l.item)} listing`,
      reason: `${R.staleListingHours} hours and nobody bit. Even I get tired of standing in line.`,
    });
  }

  // 2. Flip a cheap listing.
  if (shopOpen && wallet.fillsLeft > 0) {
    const flips = listings
      .filter((l) => l.seller !== me)
      .map((l) => {
        const p = pool(l.item);
        // What Gwei pays for this lot now, after her fee; null if her till can't cover it.
        const pays = p && l.amount <= params.maxAmount ? sellQuote(p, l.amount, params.feeBps)?.net : undefined;
        return { l, pays: pays ?? 0 };
      })
      .filter(
        ({ l, pays }) =>
          pays >= Math.max(over(l.price, R.flipMarginBps), l.price + R.flipMinBits) &&
          l.price <= wallet.bits &&
          l.price <= wallet.fillBitsLeft &&
          l.price <= budget &&
          l.price <= ceiling(l.item, l.amount) &&
          owned(l.item) + l.amount <= R.inventoryCap,
      )
      .sort((a, b) => b.pays - b.l.price - (a.pays - a.l.price) || a.l.id - b.l.id);
    for (const { l, pays } of flips) {
      out.push({
        kind: "fill",
        rule: 2,
        listingId: l.id,
        item: l.item,
        amount: l.amount,
        price: l.price,
        seller: l.seller,
        text: `Bought ${lotText(l.amount, l.item)} from ${who(l.seller)}’s listing at ${bitsText(l.price)}`,
        reason: `Gwei pays ${pays}. Lunch money.`,
      });
    }
  }

  // 3. Cash out to Gwei: the largest lot that still clears his margin.
  if (wallet.tradesLeft > 0) {
    for (const p of pools) {
      const lot = books.lots[p.item];
      for (let n = Math.min(held(p.item), params.maxAmount); n >= 1; n--) {
        const q = sellQuote(p, n, params.feeBps);
        const cost = costOf(lot, n);
        const floor = Math.max(over(cost, R.profitBps), cost + 1);
        if (!q || q.net < floor) continue;
        out.push({
          kind: "sell",
          rule: 3,
          item: p.item,
          amount: n,
          // Never under his margin, even if the price moves first: the contract enforces it.
          minBits: Math.max(lessSlippage(q.net, R.slippageBps), floor),
          expectBits: q.net,
          text: `Sold ${lotText(n, p.item)} to Gwei for ${bitsText(q.net)}`,
          reason: `Cost me ${cost}. I was in this trade before you, and I’m out of it before you.`,
        });
        break;
      }
    }
  }

  // 4. Undercut Gwei: one listing per item, under her price and over his cost.
  if (wallet.listingsLeft > 0 && wallet.open.length < params.maxOpenListings && listings.length < params.maxListings) {
    for (const p of pools) {
      const n = Math.min(held(p.item), R.listLot, params.maxAmount);
      if (n < 1 || mine.some((l) => l.item === p.item)) continue;
      const gwei = buyQuote(p, n, params.feeBps);
      const ask = gwei ? share(gwei.total, BPS - R.undercutBps) : Math.floor((spotMilli(p) * n * (BPS + R.soldOutMarkupBps)) / (1000 * BPS));
      const cost = costOf(books.lots[p.item], n);
      const [lo, hi] = listingBounds(p, n, params.floorBps, params.ceilingBps);
      if (ask < Math.max(over(cost, R.profitBps), cost + 1) || ask < lo || ask > hi) continue;
      out.push({
        kind: "list",
        rule: 4,
        item: p.item,
        amount: n,
        price: ask,
        text: `Listed ${lotText(n, p.item)} at ${bitsText(ask)}`,
        reason: gwei ? `Gwei wants ${gwei.total} for the same. I’m in front of her, as usual.` : "Gwei’s sold out. I’m not.",
      });
    }
  }

  // 5. Buy the dip, deepest first.
  if (shopOpen && wallet.tradesLeft > 0) {
    const dips = pools
      .map((p) => ({ p, open: openingMilli(p.item), spot: spotMilli(p) }))
      .filter((d): d is { p: Pool; open: number; spot: number } => d.open !== null && d.spot * BPS < d.open * R.dipBps)
      // No round trips: not an item he sold her lately.
      .filter(({ p }) => nowMs - (books.soldToGwei[p.item] ?? -Infinity) >= R.roundTripHours * HOUR_MS)
      .sort((a, b) => a.spot / a.open - b.spot / b.open);
    for (const { p, open, spot } of dips) {
      const n = Math.min(R.dipLot, params.maxAmount);
      const q = buyQuote(p, n, params.feeBps);
      if (!q) continue;
      const limit = withSlippage(q.total, R.slippageBps);
      if (limit > wallet.bits || limit > budget || limit > ceiling(p.item, n) || owned(p.item) + n > R.inventoryCap) continue;
      out.push({
        kind: "buy",
        rule: 5,
        item: p.item,
        amount: n,
        maxBits: limit,
        expectBits: q.total,
        text: `Bought ${lotText(n, p.item)} from Gwei for ${bitsText(q.total)}`,
        reason: `${Math.round((1 - spot / open) * 100)}% under the opening price. First in line for the dip.`,
      });
    }
  }

  // 6. Clearance sale: broke, with nothing above to do, he takes Gwei's price on the lot that loses him least.
  if (!shopOpen && wallet.tradesLeft > 0 && !out.some((a) => a.kind === "sell" || a.kind === "list")) {
    const lots = pools
      .map((p) => {
        const n = Math.min(held(p.item), R.clearanceLot, params.maxAmount);
        const q = n >= 1 ? sellQuote(p, n, params.feeBps) : null;
        return q ? { p, n, q, cost: costOf(books.lots[p.item], n) } : null;
      })
      .filter((x) => x !== null)
      // Least lost per Bit of cost first: net/cost, compared without dividing.
      .sort((a, b) => b.q.net * Math.max(1, a.cost) - a.q.net * Math.max(1, b.cost));
    for (const { p, n, q, cost } of lots) {
      out.push({
        kind: "sell",
        rule: 6,
        item: p.item,
        amount: n,
        minBits: Math.max(1, lessSlippage(q.net, R.slippageBps)),
        expectBits: q.net,
        text: `Sold ${lotText(n, p.item)} to Gwei for ${bitsText(q.net)}`,
        reason: `Cost me ${cost}. Clearance: rent’s due, and the landlord was in line first.`,
      });
    }
  }

  return out;
}

/** What he says about himself when he isn't trading. */
export function statusLine(status: NpcStatus, bits: number): string {
  switch (status) {
    case "closed-shop":
      return `Closed shop: ${bitsText(bits)} left. Everything must go. Back when something sells.`;
    case "resting":
      return `That’s ${NPC_RULES.maxActionsPerDay} moves today. Back in line at midnight UTC.`;
    case "market-closed":
      return "The market’s closed. I’m first in line for when it opens.";
    case "open":
      return "I was here before you. I’ll be here after you.";
  }
}
