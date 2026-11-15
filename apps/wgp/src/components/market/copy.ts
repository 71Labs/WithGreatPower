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
  // Gwei's new stock (src/lib/market/new-stock.ts): drawn as whoever hands it over.
  "gas-receipt": "gwei",
  "finality-flag": "node",
  "evidence-bag": "mary-jpeg",
  "seed-phrase": "uncle-gen",
};

/**
 * Gwei Stacy runs the stall. One line per visit, picked by the day. A line that names the
 * gas fee reads it from the market's live params (`fee_bps`), never a number written here.
 * In the practice market she says what practice is: her stock and till are real there, but
 * none of it is on chain.
 */
const VENDOR_LINES: readonly (string | ((feeBps: number, practice: boolean) => string))[] = [
  "Prices are set by the curve. The curve is set by you. I just invoice.",
  (feeBps) => `A ${feeText(feeBps)} gas fee on everything. It gets burned. Don't ask me where.`,
  "Buy high, sell low. That's what the last guy did. He's fine. Probably.",
  "Every trade moves the price. No patch notes, no committee, no refunds.",
  "I count in gwei. You count in Bits. We both count on Sandwich Man staying out.",
  (_, practice) =>
    practice
      ? "Stock's real, till's real, chain's not: this stall is practice. Welcome to the Mempool Market."
      : "Stock's real, till's real, the vibes are virtual. Welcome to the Mempool Market.",
];

export function vendorLine(seed: number, feeBps: number, practice = false): string {
  const line = VENDOR_LINES[Math.abs(Math.floor(seed)) % VENDOR_LINES.length]!;
  return typeof line === "string" ? line : line(feeBps, practice);
}

/**
 * The toast after a trade or an investing move. In the practice market it says so, and the
 * Bits it names are practice Bits: nothing there is on NEAR.
 */
export function doneText(action: "buy" | "sell" | "list" | "fill" | "cancel" | "invest" | "withdraw" | "claim", practice: boolean): string {
  const bits = practice ? "practice Bits" : "Bits";
  switch (action) {
    case "buy":
      return practice ? "Practice: bought. It’s in your practice loot." : "Bought. It’s in your pocket.";
    case "sell":
      return `${practice ? "Practice: sold" : "Sold"}. The ${bits} are yours.`;
    case "list":
      return `${practice ? "Practice: listed" : "Listed"}. It’s in escrow until someone buys it.`;
    case "fill":
      return practice ? "Practice: bought from a player. It’s in your practice loot." : "Bought from a player. It’s in your pocket.";
    case "cancel":
      return `${practice ? "Practice: taken down" : "Taken down"}. Your items are back.`;
    case "invest":
      return practice ? "Practice: invested. Gwei’s till is funded with practice Bits, and your stake starts earning from its fees." : "Invested. Gwei’s till is funded, and your stake starts earning from its fees.";
    case "withdraw":
      return `${practice ? "Practice: withdrawn" : "Withdrawn"}. The ${bits} are back with you.`;
    case "claim":
      return practice ? "Practice: claimed. The practice earnings are yours." : "Claimed. The earnings are yours.";
  }
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
  "gas-receipt": "Gwei Stacy, who prints them",
  "finality-flag": "Whoever won the Daily",
  "evidence-bag": "Mary Jpeg's filing system",
  "seed-phrase": "Uncle Gen, who wants it back",
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
