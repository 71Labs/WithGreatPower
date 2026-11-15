import { describe, expect, it } from "vitest";

import { seededPools } from "./config";
import type { Pool } from "./math";
import {
  capFor,
  deriveWanted,
  pluralName,
  SOLD_OUT_MULTIPLIER,
  WANTED_CAPS,
  WANTED_MAX,
  WANTED_MULTIPLIER,
  wantedBonus,
  wantedChip,
  wantedDetail,
  wantedLine,
  wantedWhy,
  type WantedItem,
} from "./wanted";

const FEE = 200;
const opened = () => seededPools();
/** The seeded pools with some pools changed. */
function market(changes: Record<string, Partial<Pool>>): Pool[] {
  return opened().map((p) => (changes[p.item] ? { ...p, ...changes[p.item] } : p));
}
const items = (pools: Pool[], open = true) => deriveWanted({ pools, open, feeBps: FEE }).map((w) => `${w.item}:${w.reason}:×${w.multiplier}`);

describe("deriveWanted: the list from the market", () => {
  it("lists nothing when every stall is as she opened it (all stocked)", () => {
    expect(deriveWanted({ pools: opened(), open: true, feeBps: FEE })).toEqual([]);
  });

  it("lists nothing with no pools at all", () => {
    expect(deriveWanted({ pools: [], open: true, feeBps: FEE })).toEqual([]);
  });

  it("lists nothing while the market is switched off, however short she is", () => {
    expect(items(market({ crumbs: { stock: 0 } }), false)).toEqual([]);
  });

  it("puts a sold-out item first at ×3, low stock and a price far above its start at ×2", () => {
    // Mainnet's press-pass pool on Nov 15: 15 of 20 left, 1,029 Bits in the till (52.3 vs 40 at the start).
    const pools = market({
      "press-pass": { stock: 15, bits: 1029 },
      crumbs: { stock: 0, bits: 900 },
      // 18 of 20 is not low, but 1,900 / 38 = 50 Bits is exactly 125% of 40.
      "sybil-goo": { stock: 18, bits: 1100 },
    });
    expect(items(pools)).toEqual(["crumbs:sold-out:×3", "press-pass:low-stock:×2", "sybil-goo:price-up:×2"]);
    expect(SOLD_OUT_MULTIPLIER).toBe(3);
    expect(WANTED_MULTIPLIER).toBe(2);
  });

  it("draws the line at 75% of the opening stock and 125% of the opening price", () => {
    // Commons open with 40: 30 left is low, 31 isn't (and its price stays under 125%).
    expect(items(market({ "chain-link": { stock: 30 } }))).toEqual(["chain-link:low-stock:×2"]);
    expect(items(market({ "chain-link": { stock: 31 } }))).toEqual([]);
    expect(items(market({ "sybil-goo": { stock: 18, bits: 1099 } }))).toEqual([]);
  });

  it("leaves out a pool whose till can't pay for one: more of it would pile up where she can't buy", () => {
    expect(items(market({ "fee-bomb": { stock: 5, bits: 0 } }))).toEqual([]);
  });

  it("leaves out items the game doesn't drop, and compares only with a curve she opened with", () => {
    const stranger: Pool = { item: "mystery-box", virtualBits: 100, virtualItems: 10, bits: 500, stock: 0, escrow: 0 };
    expect(items([...opened(), stranger])).toEqual([]);
    // A retuned curve: low stock means nothing next to an opening she didn't have; sold out still counts.
    expect(items(market({ crumbs: { virtualItems: 10, stock: 3 } }))).toEqual([]);
    expect(items(market({ crumbs: { virtualItems: 10, stock: 0 } }))).toEqual(["crumbs:sold-out:×3"]);
  });

  it("keeps at most three, the furthest short first, and gives the same list whatever the pools' order", () => {
    const pools = market({
      "fee-bomb": { stock: 10 }, // 75% short
      "chain-link": { stock: 20 }, // 50% short
      crumbs: { stock: 25 }, // 37% short
      "sybil-goo": { stock: 12 }, // 40% short
      "press-pass": { stock: 14 }, // 30% short
    });
    const list = items(pools);
    expect(WANTED_MAX).toBe(3);
    expect(list).toEqual(["fee-bomb:low-stock:×2", "chain-link:low-stock:×2", "sybil-goo:low-stock:×2"]);
    expect(items([...pools].reverse())).toEqual(list);
    expect(deriveWanted({ pools, open: true, feeBps: FEE })).toEqual(deriveWanted({ pools: [...pools].reverse(), open: true, feeBps: FEE }));
  });

  it("carries the snapshot's numbers and the item's caps", () => {
    const [w] = deriveWanted({ pools: market({ "spare-arm": { stock: 2 } }), open: true, feeBps: FEE });
    expect(w).toMatchObject({ item: "spare-arm", name: "Doc’s spare arm", rarity: "rare", stock: 2, openedStock: 8, openedMilli: 150_000, cap: WANTED_CAPS.rare });
    expect(w.priceMilli).toBeGreaterThan(150_000);
  });
});

/* ------------------------------------------------------------------ the bonus */

const want = (item: string, name: string, multiplier: number, rarity: keyof typeof WANTED_CAPS = "common"): WantedItem => ({
  item,
  name,
  rarity,
  reason: multiplier === 3 ? "sold-out" : "low-stock",
  multiplier,
  stock: 0,
  openedStock: 40,
  priceMilli: 20_000,
  openedMilli: 12_000,
  cap: capFor(rarity),
});

describe("wantedBonus: the multiplier and its caps", () => {
  const list = [want("crumbs", "Crumbs", 2), want("spare-arm", "Doc’s spare arm", 3, "rare"), want("sybil-goo", "Sybil goo", 2, "uncommon")];

  it("multiplies only the wanted items the night brought", () => {
    expect(wantedBonus(list, { crumbs: 3, "fee-bomb": 5 })).toEqual([{ item: "crumbs", name: "Crumbs", multiplier: 2, brought: 3, bonus: 3, capped: null }]);
    expect(wantedBonus(list, { "fee-bomb": 5 })).toEqual([]);
    expect(wantedBonus([], { crumbs: 3 })).toEqual([]);
  });

  it("caps the extra a night adds by rarity: 4 commons, 2 uncommons, 1 rare", () => {
    const out = wantedBonus(list, { crumbs: 6, "spare-arm": 1, "sybil-goo": 2 });
    expect(out.map((b) => [b.item, b.brought, b.bonus, b.capped])).toEqual([
      ["crumbs", 6, 4, "night"],
      ["spare-arm", 1, 1, "night"],
      ["sybil-goo", 2, 2, null],
    ]);
  });

  it("stops at the day's cap per player and item, across nights", () => {
    expect(wantedBonus(list, { crumbs: 3 }, { crumbs: 6 })[0]).toMatchObject({ bonus: 2, capped: "day" });
    expect(wantedBonus(list, { crumbs: 3 }, { crumbs: WANTED_CAPS.common.day })[0]).toMatchObject({ bonus: 0, capped: "day" });
  });

  it("never pays on junk numbers", () => {
    expect(wantedBonus(list, { crumbs: -2 })).toEqual([]);
    expect(wantedBonus(list, { crumbs: Number.NaN })).toEqual([]);
    expect(wantedBonus([{ ...list[0], multiplier: 1 }], { crumbs: 3 })[0]).toMatchObject({ bonus: 0, capped: null });
  });

  it("gives an unknown rarity the tightest cap", () => {
    expect(capFor("mythic")).toEqual(WANTED_CAPS.rare);
  });
});

describe("the words", () => {
  it("reads the results line the way the screen prints it", () => {
    const [b] = wantedBonus([want("crumbs", "Crumbs", 2)], { crumbs: 3 });
    expect(wantedLine(b)).toBe("Gwei wanted crumbs: ×2 → you brought 6");
    expect(wantedDetail(b)).toBe("3 dropped, +3 from her list.");
  });

  it("says when a cap cut in, and when today's bonus is used up", () => {
    const [night] = wantedBonus([want("fee-bomb", "Fee bomb", 2)], { "fee-bomb": 6 });
    expect(wantedLine(night)).toBe("Gwei wanted fee bombs: ×2 → you brought 10");
    expect(wantedDetail(night)).toBe("6 dropped, +4 from her list, the most one night pays.");
    const [day] = wantedBonus([want("fee-bomb", "Fee bomb", 2)], { "fee-bomb": 3 }, { "fee-bomb": 7 });
    expect(wantedDetail(day)).toBe("3 dropped, +1 from her list, the rest of today’s bonus.");
    const [none] = wantedBonus([want("fee-bomb", "Fee bomb", 2)], { "fee-bomb": 3 }, { "fee-bomb": 8 });
    expect(wantedLine(none)).toBe("Gwei wanted fee bombs: ×2 → you brought 3");
    expect(wantedDetail(none)).toBe("3 dropped. You’ve had today’s bonus on these.");
  });

  it("pluralises item names in running text", () => {
    expect(pluralName("Fee bomb")).toBe("fee bombs");
    expect(pluralName("Press pass")).toBe("press passes");
    expect(pluralName("Crumbs")).toBe("crumbs");
    expect(pluralName("Sybil goo")).toBe("sybil goo");
    expect(pluralName("Doc’s spare arm")).toBe("Doc’s spare arms");
    expect(pluralName("Golden sesame seed")).toBe("golden sesame seeds");
  });

  it("says why she wants each one, with the snapshot's numbers", () => {
    expect(wantedWhy({ ...want("crumbs", "Crumbs", 3), stock: 0 })).toBe("Sold out: 0 of the 40 she opened with");
    expect(wantedWhy({ ...want("crumbs", "Crumbs", 2), stock: 9 })).toBe("Running low: 9 of the 40 she opened with");
    expect(wantedWhy({ ...want("sybil-goo", "Sybil goo", 2), reason: "price-up", priceMilli: 50_000, openedMilli: 40_000 })).toBe("Price up 25% on her opening price");
    expect(wantedChip({ name: "Crumbs", multiplier: 2 })).toBe("Crumbs ×2");
  });
});
