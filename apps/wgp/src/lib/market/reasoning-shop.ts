/**
 * What Gwei adds to "Why this price?" when her shop for an item is closed: why, and
 * whether investing in her till reopens it on the market being shown.
 *
 * Kept apart from ./reasoning.ts on purpose: `explainPrice` owns the price's story and its
 * wording; these lines are composed onto its answer (`withShop`), so either can change
 * without touching the other. `explainPrice` says a broke till reopens when someone buys from
 * her; the line here adds the other way (investing) without contradicting it. A pool with
 * investors in it has no "opening" to compare with (its virtual reserve moved), so there
 * `explainPrice` states her stock and till plainly and the line here says whose Bits they are. Pure: a pool's stall (./invest.ts `shopOf`) and where
 * investing stands go in, sentences come out. Every number is the stall's own.
 */
import { bitsText } from "./format";
import type { Shop } from "./invest";
import type { PriceReasoning } from "./reasoning";

/**
 * - "available": this market takes investors (practice, simulated, or contract v3);
 * - "paused": contract v3 with investing switched off;
 * - "not-live": contract v2, which has no investing (mainnet today).
 */
export type InvestingState = "available" | "paused" | "not-live";

/** Gwei's lines about a closed shop, in her voice; none when she buys and sells. */
export function shopReasons(shop: Pick<Shop, "closed" | "needs" | "invested">, investing: InvestingState): string[] {
  const out: string[] = [];
  if (shop.closed.includes("paused")) return ["The whole game is paused, so I’m closed until it’s back."];
  if (shop.closed.includes("market-closed")) return [];
  if (shop.closed.includes("broke")) {
    const why = `I’m closed for buying these: my till is ${bitsText(shop.needs)} short of paying for one.`;
    out.push(
      investing === "available"
        ? `${why} Besides buying from me, investing in this till reopens me, at the same price.`
        : investing === "paused"
          ? `${why} I’m not taking new investors right now, so buying from me is the way to reopen me.`
          : `${why} Investing would reopen me too, but it comes with contract v3, which isn’t live yet. You can try it in the practice market.`,
    );
  } else if (shop.invested > 0) {
    out.push(`Players have invested ${bitsText(shop.invested)} in this till. That’s what lets me keep buying; it doesn’t change the price.`);
  }
  if (shop.closed.includes("sold-out")) out.push("I’m closed for selling these until someone sells me one. Investing fills my till, not my shelf.");
  return out;
}

/** `explainPrice`'s answer with the shop's lines added after its own reasons. */
export function withShop(reasoning: PriceReasoning, shop: Pick<Shop, "closed" | "needs" | "invested">, investing: InvestingState): PriceReasoning {
  const lines = shopReasons(shop, investing);
  return lines.length === 0 ? reasoning : { ...reasoning, reasons: [...reasoning.reasons, ...lines] };
}
