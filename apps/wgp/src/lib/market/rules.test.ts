import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURVES, DEFAULT_PARAMS } from "./config";

/** The plain-English rules at the top of math.ts: the comment a judge reads. */
const rules = readFileSync(fileURLToPath(new URL("./math.ts", import.meta.url)), "utf8").split("*/")[0]!.replace(/\s*\n \*\s*/g, " ");

describe("the pricing rules written at the top of math.ts", () => {
  it("quote the fee, listing bounds and caps the market really runs on", () => {
    const p = DEFAULT_PARAMS;
    expect(rules).toContain(`the fee is ${p.feeBps / 100}% (feeBps ${p.feeBps})`);
    expect(rules).toContain(`between ${p.floorBps / 100}% and ${p.ceilingBps / 100}% of her spot price × n (floorBps ${p.floorBps}, ceilingBps ${p.ceilingBps})`);
    expect(rules).toContain(`${p.maxAmount} items a trade, ${p.dailyTrades} trades with her a day`);
  });

  it("quote each rarity's starting price and stock", () => {
    const { common, uncommon, rare } = CURVES;
    expect(rules).toContain(`commons open at ${common.price} Bits with ${common.stock} in stock, uncommons at ${uncommon.price} with ${uncommon.stock}, rares at ${rare.price} with ${rare.stock}`);
  });

  it("state the vendor's limits", () => {
    expect(rules).toContain("She sells only what she holds.");
    expect(rules).toContain("She pays only from her till.");
  });
});
