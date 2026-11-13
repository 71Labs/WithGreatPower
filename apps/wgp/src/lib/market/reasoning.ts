/**
 * Why a price is what it is, in Gwei Stacy's words. `explainPrice` reads one pool (her
 * stock and her till for an item) against how that pool opened, through the pricing
 * rules in ./math.ts, and answers with a headline and two to four reasons.
 *
 * THE WORDS AND THEIR THRESHOLDS (`stockLevel`, `tillLevel`; reasoning.test.ts walks the range)
 *
 *   Stock, against the stock she opened with      Till, against the till she opened with
 *   0                  sold out                   can't pay for one    tapped out
 *   up to 20%          "Nearly out"               up to 20%            "Till’s nearly empty"
 *   up to 50%          "Running low"              up to 50%            "Till’s running low"
 *   under 100%         just the count             under 100%           just the count ("down from")
 *   100%               "the same as when I opened"                     the same
 *   up to 150%         "Plenty"                   over 100%            just the count ("up from")
 *   over 150%          "Overstocked"
 *
 * She also says whether she can afford to buy from you: what she'd pay for one after the
 * gas fee, and how many her till covers in one trade (`covers`, up to the trade cap).
 *
 * Every number in a reason comes from the pool, its opening state or the market's own
 * history (trades and change over 24 hours, when the caller has them). Nothing is
 * guessed: with no history she doesn't mention demand, and for a pool whose opening she
 * doesn't know she only says what she holds now. Pure: no clock, no randomness.
 */
import { plural } from "@/lib/plural";

import { DEFAULT_PARAMS, defaultPoolConfigs, type PoolConfig } from "./config";
import { bitsText, formatBits, formatChange, formatPrice } from "./format";
import { buyQuote, sellPayout, sellQuote, spotMilli, type Pool } from "./math";

/** How a pool stood right after it was seeded. */
export interface Opening {
  stock: number;
  /** Bits in the till for this item. */
  bits: number;
  /** Spot price × 1000. */
  priceMilli: number;
}

/**
 * The pool's opening state from the market's settings, or null when the item has none
 * or the pool runs on a different curve (then there's nothing honest to compare with).
 */
export function openingOf(pool: Pool, configs: PoolConfig[] = defaultPoolConfigs()): Opening | null {
  const c = configs.find((p) => p.item === pool.item);
  if (!c || c.virtualBits !== pool.virtualBits || c.virtualItems !== pool.virtualItems) return null;
  const priceMilli = spotMilli({ ...pool, bits: c.seedBits, stock: c.seedStock });
  return { stock: c.seedStock, bits: c.seedBits, priceMilli };
}

export interface PriceFacts {
  pool: Pool;
  /** `params.open`: false while the market is switched off. */
  open: boolean;
  feeBps: number;
  /** Defaults to `openingOf(pool)`. */
  opening?: Opening | null;
  /** Fractional price change over the last 24 hours (0.06 = +6%); null or absent with no history. */
  change24h?: number | null;
  /** Trades with the vendor in the last 24 hours; absent when the caller doesn't count them. */
  trades24h?: number;
  /** `params.maxAmount`, the most one trade moves. Defaults to the market's own setting. */
  maxAmount?: number;
}

/** At or under this many tenths of her opening stock she is "running low"; of her opening till, the till is. */
export const LOW_TENTHS = 5;
/** At or under this many tenths she is "nearly out"; the till is "nearly empty". */
export const NEARLY_OUT_TENTHS = 2;
/** Over this many tenths of her opening stock she is "overstocked"; up to it, she has "plenty". */
export const OVERSTOCKED_TENTHS = 15;

export type StockLevel = "out" | "nearly-out" | "low" | "under" | "opening" | "plenty" | "overstocked";
export type TillLevel = "empty" | "nearly-empty" | "low" | "under" | "opening" | "over";

/** How her stock stands against the stock she opened with. Whole-number arithmetic, so the edges are exact. */
export function stockLevel(stock: number, opened: number): StockLevel {
  if (stock <= 0) return "out";
  if (stock * 10 <= opened * NEARLY_OUT_TENTHS) return "nearly-out";
  if (stock * 10 <= opened * LOW_TENTHS) return "low";
  if (stock < opened) return "under";
  if (stock === opened) return "opening";
  return stock * 10 <= opened * OVERSTOCKED_TENTHS ? "plenty" : "overstocked";
}

/** How her till stands against the till she opened with; `canCover` is how many she can pay for right now. */
export function tillLevel(bits: number, opened: number, canCover: number): TillLevel {
  if (canCover <= 0) return "empty";
  if (bits * 10 <= opened * NEARLY_OUT_TENTHS) return "nearly-empty";
  if (bits * 10 <= opened * LOW_TENTHS) return "low";
  if (bits < opened) return "under";
  return bits === opened ? "opening" : "over";
}

/** How many she can buy from a player in one trade: the till must cover the whole payout. Up to `cap`. */
export function covers(pool: Pool, feeBps: number, cap: number = DEFAULT_PARAMS.maxAmount): number {
  let n = 0;
  while (n < cap && sellQuote(pool, n + 1, feeBps) !== null) n += 1;
  return n;
}

/**
 * - `closed`: the market is off.
 * - `sold-out`: stock 0, she can't sell.
 * - `broke`: her till for the item can't pay for one, she can't buy.
 * - `above` / `below` / `opening`: the price against her opening price.
 */
export type PriceState = "closed" | "sold-out" | "broke" | "above" | "below" | "opening";

export interface PriceReasoning {
  state: PriceState;
  /** One short line, in her voice. */
  headline: string;
  /** Two to four facts, each with the pool's real numbers. */
  reasons: string[];
  closed: boolean;
  /** She holds none, so there's nothing to buy from her. */
  soldOut: boolean;
  /** Her till for this item can't pay for one, so she can't buy. */
  cantPay: boolean;
  /** Her stock against her opening stock; null for a pool whose opening she doesn't know. */
  stock: StockLevel | null;
  /** Her till against her opening till; null for a pool whose opening she doesn't know. */
  till: TillLevel | null;
  /** How many she can pay for in one trade right now (0 when she can't buy or is closed; up to the trade cap). */
  covers: number;
  /** Why a player can't buy one right now, for the screen to print by a disabled button; null when they can. */
  buyBlocked: string | null;
  /** Why a player can't sell her one right now; null when they can. */
  sellBlocked: string | null;
}

/** The 24-hour line, only from history the caller really has. */
function demand({ change24h, trades24h }: PriceFacts): string | null {
  const moved = change24h === null || change24h === undefined ? null : Math.round(change24h * 100);
  if (trades24h !== undefined) {
    if (trades24h === 0) {
      // No trade on record and yet a different price (a trade the history missed, or the owner retuned
      // the curve): say both, never "hasn't moved" beside a pill that says it did.
      if (moved !== null && moved !== 0) return `No trades with me on record in the last 24 hours, but the price is ${moved > 0 ? "up" : "down"} ${Math.abs(moved)}% on a day ago.`;
      return "Nobody’s traded these with me in the last 24 hours, so the price hasn’t moved.";
    }
    const trades = plural(trades24h, "trade");
    if (moved === null) return `${trades} with me in the last 24 hours. Every one moved the price.`;
    if (moved === 0) return `${trades} with me in the last 24 hours, and the price is back where it was.`;
    return `${trades} with me in the last 24 hours moved the price ${formatChange(change24h!)}.`;
  }
  if (moved === null) return null;
  if (moved === 0) return "No change in the last 24 hours.";
  return `${moved > 0 ? "Up" : "Down"} ${Math.abs(moved)}% in the last 24 hours.`;
}

export function explainPrice(facts: PriceFacts): PriceReasoning {
  const { pool, feeBps } = facts;
  const opening = facts.opening === undefined ? openingOf(pool) : facts.opening;
  const price = spotMilli(pool);
  const closed = !facts.open;
  const soldOut = pool.stock <= 0;
  const buyOne = buyQuote(pool, 1, feeBps);
  const sellOne = sellQuote(pool, 1, feeBps);
  const cantPay = sellOne === null;
  const cap = facts.maxAmount ?? DEFAULT_PARAMS.maxAmount;
  const canCover = covers(pool, feeBps, cap);
  const stock = opening ? stockLevel(pool.stock, opening.stock) : null;
  const till = opening ? tillLevel(pool.bits, opening.bits, canCover) : null;

  // Against her opening price, in whole percent (what the reasons print).
  const pct = opening ? Math.round((Math.abs(price - opening.priceMilli) / opening.priceMilli) * 100) : 0;
  const side = !opening || pct === 0 ? "opening" : price > opening.priceMilli ? "above" : "below";
  const versus = side === "above" ? `${pct}% over my opening price` : side === "below" ? `${pct}% under my opening price` : "my opening price";

  // Her stock: the count against her opening count, always; the word only when the level has earned it.
  const dearer = side === "above" ? `, so I’m asking ${pct}% more than when I opened` : "";
  const cheaper = side === "below" ? `, so I’m asking ${pct}% less` : "";
  const left = opening ? `${formatBits(pool.stock)} left of the ${formatBits(opening.stock)} I opened with${dearer}.` : "";
  const extra = opening ? `I’m holding ${formatBits(pool.stock)}, ${formatBits(pool.stock - opening.stock)} more than the ${formatBits(opening.stock)} I opened with${cheaper}.` : "";
  const stockLine = !opening
    ? `I’m holding ${formatBits(pool.stock)}, and the price follows what I hold.`
    : stock === "out"
      ? `None left of the ${formatBits(opening.stock)} I opened with.`
      : stock === "nearly-out"
        ? `Nearly out: ${left}`
        : stock === "low"
          ? `Running low: ${left}`
          : stock === "under"
            ? left
            : stock === "opening"
              ? `${formatBits(pool.stock)} in stock, the same as when I opened.`
              : stock === "plenty"
                ? `Plenty: ${extra}`
                : `Overstocked: ${extra}`;

  // Her till, the same way. (A till that can't pay for one has its own state below.)
  const paidOut = "I paid sellers out, and that lowers the price.";
  const tillLine = !opening
    ? `My till for these holds ${bitsText(pool.bits)}.`
    : till === "nearly-empty"
      ? `Till’s nearly empty: ${bitsText(pool.bits)} left of the ${formatBits(opening.bits)} I opened with. ${paidOut}`
      : till === "low"
        ? `Till’s running low: ${bitsText(pool.bits)} left of the ${formatBits(opening.bits)} I opened with. ${paidOut}`
        : pool.bits > opening.bits
          ? `My till for these holds ${bitsText(pool.bits)}, up from ${formatBits(opening.bits)} at opening. Buyers paid in, and that lifts the price.`
          : pool.bits < opening.bits
            ? `My till for these holds ${bitsText(pool.bits)}, down from ${formatBits(opening.bits)} at opening. ${paidOut}`
            : `My till for these holds ${bitsText(pool.bits)}, the same as when I opened.`;

  // Can she afford to buy from you: what one pays, and how many the till covers in a trade.
  const affordLine = !sellOne
    ? null
    : canCover >= cap
      ? `Sell me one and I’ll pay ${bitsText(sellOne.net)} after the gas fee. My till covers a full trade of ${formatBits(cap)}.`
      : canCover === 1
        ? `Sell me one and I’ll pay ${bitsText(sellOne.net)} after the gas fee. My till covers that one and no more.`
        : `Sell me one and I’ll pay ${bitsText(sellOne.net)} after the gas fee. My till covers ${formatBits(canCover)} of yours and no more.`;

  const buyBlocked = closed
    ? "The stall is closed, so Gwei isn’t selling right now."
    : soldOut
      ? "Gwei has none left to sell. Sell her one and she’s back in stock."
      : null;
  const sellBlocked = closed
    ? "The stall is closed, so Gwei isn’t buying right now."
    : cantPay
      ? "Gwei’s till for these can’t pay for one. Buy one and she can buy again."
      : null;
  const flags = { closed, soldOut, cantPay, stock, till, covers: closed ? 0 : canCover, buyBlocked, sellBlocked };

  if (closed) {
    return {
      state: "closed",
      headline: "Stall’s closed. Even a gwei counter takes a break.",
      reasons: [
        "The market is switched off, so I’m not buying or selling right now.",
        `Last price: ${formatPrice(price)} Bits, with ${formatBits(pool.stock)} in stock.`,
        "Your open listings can still be taken down.",
      ],
      ...flags,
    };
  }

  if (soldOut) {
    const reasons = [
      opening ? `I opened with ${formatBits(opening.stock)} and have none left, so I can’t sell you one.` : "I have none left, so I can’t sell you one.",
      `The price sits at ${formatPrice(price)} Bits, ${versus}, until someone sells me one.`,
    ];
    if (affordLine) reasons.push(affordLine);
    return { state: "sold-out", headline: "Sold out. I can’t sell what I don’t hold.", reasons, ...flags };
  }

  if (cantPay) {
    const payout = sellPayout(pool, 1);
    const reasons = [
      payout === 0
        ? "One of these is worth less than a Bit to me right now, so there’s nothing to pay you."
        : `One of these would cost me ${bitsText(payout)} and my till for them holds ${formatBits(pool.bits)}, so I can’t buy more until someone buys from me.`,
      stockLine,
    ];
    if (buyOne) reasons.push(`Buy one for ${bitsText(buyOne.total)}, gas fee included, and I can buy again.`);
    return { state: "broke", headline: "My till for these is tapped out. Not stingy, just solvent.", reasons, ...flags };
  }

  const reasons = [stockLine, tillLine];
  if (affordLine) reasons.push(affordLine);
  const history = demand(facts);
  if (history) reasons.push(history);

  // A remark only when the stock or the till has earned the word, never for a small move.
  if (side === "above") {
    const quip = stock === "nearly-out" ? " Almost gone." : stock === "low" ? " Heroes keep buying these." : "";
    return { state: "above", headline: `Up ${pct}% since I opened.${quip}`, reasons, ...flags };
  }
  if (side === "below") {
    const quip = stock === "overstocked" ? " I’m drowning in these." : till === "nearly-empty" || till === "low" ? " I’ve been buying a lot." : "";
    return { state: "below", headline: `Down ${pct}% since I opened.${quip}`, reasons, ...flags };
  }
  return {
    state: "opening",
    headline: opening ? `Opening price: ${formatPrice(price)} Bits. Not a gwei more.` : `${formatPrice(price)} Bits. I counted it in gwei twice.`,
    reasons,
    ...flags,
  };
}
