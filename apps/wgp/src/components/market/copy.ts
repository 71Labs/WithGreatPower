/**
 * The Mempool Market's words: who drops each item, the vendor's patter, and The Daily
 * Rug's market headlines. Copy is stored in natural case; screens set it in caps with CSS.
 */
import { feeText } from "@/lib/market/format";
import type { CastId } from "@wgp/game-core/cast";
import type { ItemId } from "@wgp/game-core/types";

/** Who drops each item (the same as the Suit lab), for the item's art. */
export const ITEM_SOURCE: Record<ItemId, CastId> = {
  "fee-bomb": "gas-goblin",
  "goblin-glider": "gas-goblin",
  crumbs: "sandwich-man",
  "sesame-seed": "sandwich-man",
  "chain-link": "doc-octochain",
  "spare-arm": "doc-octochain",
  "sybil-goo": "sybil",
  "press-pass": "bearson",
};

/**
 * Gwei Stacy runs the stall. One line per visit, picked by the day. A line that names the
 * gas fee reads it from the market's live params (`fee_bps`), never a number written here.
 */
const VENDOR_LINES: readonly (string | ((feeBps: number) => string))[] = [
  "Prices are set by the curve. The curve is set by you. I just invoice.",
  (feeBps) => `A ${feeText(feeBps)} gas fee on everything. It gets burned. Don't ask me where.`,
  "Buy high, sell low. That's what the last guy did. He's fine. Probably.",
  "Every trade moves the price. No patch notes, no committee, no refunds.",
  "I count in gwei. You count in Bits. We both count on Sandwich Man staying out.",
  "Stock's real, till's real, the vibes are virtual. Welcome to the Mempool Market.",
];

export function vendorLine(seed: number, feeBps: number): string {
  const line = VENDOR_LINES[Math.abs(Math.floor(seed)) % VENDOR_LINES.length]!;
  return typeof line === "string" ? line : line(feeBps);
}

/** What Gwei says after a trade, at the market's live gas fee. */
export function vendorAfter(action: "buy" | "sell" | "list" | "fill" | "cancel", feeBps: number): string {
  switch (action) {
    case "buy":
      return "Pleasure doing business. The price just went up, by the way.";
    case "sell":
      return "Thanks. I'll mark it up for the next hero.";
    case "list":
      return "Listed. Someone will buy it, or Sandwich Man will try to.";
    case "fill":
      return `Sold to you. The seller says thanks, minus the ${feeText(feeBps)} gas fee.`;
    case "cancel":
      return "Pulled it. Your stuff is back in your pocket.";
  }
}

/** Who The Daily Rug blames when an item moves. */
const SUSPECT: Record<ItemId, string> = {
  "fee-bomb": "Gas Goblin",
  "goblin-glider": "Gas Goblin",
  crumbs: "Sandwich Man",
  "sesame-seed": "Sandwich Man",
  "chain-link": "Doc Octochain",
  "spare-arm": "Doc Octochain",
  "sybil-goo": "The Sybil, all of him",
  "press-pass": "J. Jonah Bearson",
};

export interface MoverHeadline {
  headline: string;
  footnote: string;
}

/** A parody headline for an item that moved `change` (0.12 = +12%) today. */
export function moverHeadline(item: ItemId, name: string, change: number): MoverHeadline {
  const pct = Math.round(Math.abs(change) * 100);
  const who = SUSPECT[item];
  if (change >= 0.25) return { headline: `${name} up ${pct}%*`, footnote: `*${who} denies everything.` };
  if (change > 0) return { headline: `${name} climbs ${pct}%*`, footnote: `*Analysts blame heroes who buy high.` };
  if (change <= -0.25) return { headline: `${name} ${pct}% off*`, footnote: `*Terms, conditions and front-running apply.` };
  return { headline: `${name} slips ${pct}%*`, footnote: `*${who} calls it a healthy correction.` };
}

export const FLAT_MARKET: MoverHeadline = {
  headline: "Markets flat*",
  footnote: "*Sandwich Man suspects a cover-up. Make a trade and prove him wrong.",
};
