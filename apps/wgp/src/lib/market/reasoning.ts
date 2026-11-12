/**
 * Why a price is what it is, in Gwei Stacy's words. `explainPrice` reads one pool (her
 * stock and her till for an item) against how that pool opened, through the pricing
 * rules in ./math.ts, and answers with a headline and two or three reasons.
 *
 * Every number in a reason comes from the pool, its opening state or the market's own
 * history (trades and change over 24 hours, when the caller has them). Nothing is
 * guessed: with no history she doesn't mention demand, and for a pool whose opening she
 * doesn't know she only says what she holds now. Pure: no clock, no randomness.
 */
import { defaultPoolConfigs, type PoolConfig } from "./config";
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
  /** Two or three facts, each with the pool's real numbers. */
  reasons: string[];
  closed: boolean;
  /** She holds none, so there's nothing to buy from her. */
  soldOut: boolean;
  /** Her till for this item can't pay for one, so she can't buy. */
  cantPay: boolean;
  /** Why a player can't buy one right now, for the screen to print by a disabled button; null when they can. */
  buyBlocked: string | null;
  /** Why a player can't sell her one right now; null when they can. */
  sellBlocked: string | null;
}

/** A move this big against her opening price earns a remark; a smaller one is just stated. */
const QUIP_PCT = 10;

const count = (n: number, one: string, many: string) => `${formatBits(n)} ${n === 1 ? one : many}`;

/** The 24-hour line, only from history the caller really has. */
function demand({ change24h, trades24h }: PriceFacts): string | null {
  const moved = change24h === null || change24h === undefined ? null : Math.round(change24h * 100);
  if (trades24h !== undefined) {
    if (trades24h === 0) return "Nobody’s traded these with me in the last 24 hours, so the price hasn’t moved.";
    const trades = count(trades24h, "trade", "trades");
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

  // Against her opening price, in whole percent (what the reasons print).
  const pct = opening ? Math.round((Math.abs(price - opening.priceMilli) / opening.priceMilli) * 100) : 0;
  const side = !opening || pct === 0 ? "opening" : price > opening.priceMilli ? "above" : "below";
  const versus = side === "above" ? `${pct}% over my opening price` : side === "below" ? `${pct}% under my opening price` : "my opening price";

  const stockLine = !opening
    ? `I’m holding ${formatBits(pool.stock)}, and the price follows what I hold.`
    : pool.stock < opening.stock
      ? side === "above"
        ? `Running low: ${formatBits(pool.stock)} left of ${formatBits(opening.stock)}, so I’m asking ${pct}% more than when I opened.`
        : `${formatBits(pool.stock)} left of the ${formatBits(opening.stock)} I opened with.`
      : pool.stock > opening.stock
        ? side === "below"
          ? `Overstocked: I’m holding ${formatBits(pool.stock)}, ${formatBits(pool.stock - opening.stock)} more than the ${formatBits(opening.stock)} I opened with, so I’m asking ${pct}% less.`
          : `I’m holding ${formatBits(pool.stock)}, ${formatBits(pool.stock - opening.stock)} more than the ${formatBits(opening.stock)} I opened with.`
        : `${formatBits(pool.stock)} in stock, the same as when I opened.`;

  const tillLine = !opening
    ? `My till for these holds ${bitsText(pool.bits)}.`
    : pool.bits > opening.bits
      ? `My till for these holds ${bitsText(pool.bits)}, up from ${formatBits(opening.bits)} at opening. Buyers paid in, and that lifts the price.`
      : pool.bits < opening.bits
        ? `My till for these holds ${bitsText(pool.bits)}, down from ${formatBits(opening.bits)} at opening. I paid sellers out, and that lowers the price.`
        : `My till for these holds ${bitsText(pool.bits)}, the same as when I opened.`;

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
  const flags = { closed, soldOut, cantPay, buyBlocked, sellBlocked };

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
    if (sellOne) reasons.push(`Sell me one and I’ll pay ${bitsText(sellOne.net)} after the gas fee.`);
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
  const history = demand(facts);
  if (history) reasons.push(history);

  if (side === "above") {
    const quip = opening && pool.stock < opening.stock && pct >= QUIP_PCT ? " Heroes keep buying these." : "";
    return { state: "above", headline: `Up ${pct}% since I opened.${quip}`, reasons, ...flags };
  }
  if (side === "below") {
    const quip = opening && pool.stock > opening.stock && pct >= QUIP_PCT ? " I’m drowning in these." : "";
    return { state: "below", headline: `Down ${pct}% since I opened.${quip}`, reasons, ...flags };
  }
  return {
    state: "opening",
    headline: opening ? `Opening price: ${formatPrice(price)} Bits. Not a gwei more.` : `${formatPrice(price)} Bits. I counted it in gwei twice.`,
    reasons,
    ...flags,
  };
}
