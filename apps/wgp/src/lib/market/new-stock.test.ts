import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ITEMS, SUITS } from "@wgp/game-core/data";

import { play } from "./balance";
import { CURVES, defaultPoolConfigs, marketPoolConfigs } from "./config";
import { Economy } from "./bots";
import { caseAward, dailyAward, LAUNCH_ITEM_IDS, LAUNCH_SUIT_IDS, NEW_STOCK, NEW_STOCK_IDS, NEW_STOCK_POOLS, NEW_SUIT_IDS, newPoolArgs, newStockKey, openNewStock, podiumAward, setRulesArgs, suitOpen } from "./new-stock";
import { seedPractice } from "./practice";
import { suitGaps } from "./prompts";

/** game.wgpnear.near's get_config and market_state on Nov 15, 2026 (read-only). */
const LIVE = JSON.parse(readFileSync(join(__dirname, "live-2026-11-15.json"), "utf8")) as {
  get_config: { items: string[]; suits: { id: string; starter: boolean; min_level: number; recipe: { item: string; amount: number }[] }[]; starter_unlock_level: number };
  market_state: { pools: { item: string; virtual_bits: string; virtual_items: string; bits: string; stock: string }[] };
};
const CALLS = JSON.parse(readFileSync(join(__dirname, "../../../../../docs/economy/new-stock-calls.json"), "utf8")) as { set_rules: unknown; new_pools: unknown };

/** contracts/wgp/src/lib.rs `validate_rules`, rule for rule. */
function validRules(items: string[], suits: { id: string; starter: boolean; min_level: number; recipe: { item: string; amount: number }[] }[], unlock: number): string | null {
  const slug = (s: string) => s.length >= 1 && s.length <= 32 && /^[a-z0-9-]+$/.test(s);
  if (items.length < 1 || items.length > 32) return "Between 1 and 32 items";
  if (suits.length < 1 || suits.length > 32) return "Between 1 and 32 suits";
  if (unlock < 1 || unlock > 100) return "starter_unlock_level out of range";
  if (new Set(items).size !== items.length || items.some((i) => !slug(i) || i === "bits")) return "Bad item";
  if (new Set(suits.map((s) => s.id)).size !== suits.length) return "Duplicate suit";
  for (const s of suits) {
    if (!slug(s.id) || s.min_level < 1 || s.min_level > 100 || s.recipe.length > 8) return `Bad suit ${s.id}`;
    if (s.starter && s.recipe.length > 0) return "Starter suits have no recipe";
    for (const i of s.recipe) if (!items.includes(i.item) || i.amount < 1 || i.amount > 1000) return `Suit ${s.id} needs ${i.item}`;
  }
  return suits.some((s) => s.starter) ? null : "At least one starter suit";
}

describe("Gwei's new stock: four items, two suits", () => {
  it("adds four items and two suits to the game, keeping the launch eight of each", () => {
    expect(NEW_STOCK_IDS).toEqual(["gas-receipt", "finality-flag", "evidence-bag", "seed-phrase"]);
    expect(NEW_SUIT_IDS).toEqual(["notary", "finality"]);
    expect(LAUNCH_ITEM_IDS).toEqual(LIVE.get_config.items);
    expect(LAUNCH_SUIT_IDS).toEqual(LIVE.get_config.suits.map((s) => s.id));
    expect(NEW_STOCK.map((i) => ITEMS[i.id].rarity)).toEqual(["common", "uncommon", "common", "rare"]);
    // Each new item is burned by a new suit's recipe, and each new suit takes only new items.
    for (const id of NEW_STOCK_IDS) expect(NEW_SUIT_IDS.some((s) => (SUITS[s].recipe[id] ?? 0) > 0), id).toBe(true);
    for (const s of NEW_SUIT_IDS) expect(Object.keys(SUITS[s].recipe).every((i) => NEW_STOCK_IDS.includes(i as never)), s).toBe(true);
  });

  it("set_rules keeps every live item, suit, starter flag, level and recipe exactly as the contract has them, and passes its validation", () => {
    const args = setRulesArgs(LIVE.get_config);
    expect(args.items.slice(0, LIVE.get_config.items.length)).toEqual(LIVE.get_config.items);
    expect(args.suits.slice(0, LIVE.get_config.suits.length)).toEqual(LIVE.get_config.suits);
    expect(args.starter_unlock_level).toBe(LIVE.get_config.starter_unlock_level);
    expect(args.items.slice(LIVE.get_config.items.length)).toEqual([...NEW_STOCK_IDS]);
    expect(args.suits.slice(LIVE.get_config.suits.length)).toEqual([
      { id: "notary", starter: false, min_level: 2, recipe: [{ item: "evidence-bag", amount: 3 }, { item: "gas-receipt", amount: 2 }] },
      { id: "finality", starter: false, min_level: 3, recipe: [{ item: "finality-flag", amount: 2 }, { item: "seed-phrase", amount: 1 }] },
    ]);
    expect(validRules(args.items, args.suits, args.starter_unlock_level)).toBeNull();
    // Running it again (after the call landed) changes nothing.
    expect(setRulesArgs(args)).toEqual(args);
  });

  it("docs/economy/new-stock-calls.json is the owner's two calls as built from the live contract", () => {
    expect(CALLS.set_rules).toEqual(setRulesArgs(LIVE.get_config));
    expect(CALLS.new_pools).toEqual(newPoolArgs(LIVE.market_state.pools.map((p) => p.item)));
    // Only pools that don't exist yet: existing pools never get new seeds.
    expect(newPoolArgs([...NEW_STOCK_IDS])).toEqual([]);
  });

  it("each new pool opens at its tier's price with the live pools' depth, on small seeds", () => {
    for (const p of NEW_STOCK_POOLS) {
      const tier = CURVES[ITEMS[p.item].rarity];
      const live = LIVE.market_state.pools.find((l) => ITEMS[l.item as keyof typeof ITEMS].rarity === ITEMS[p.item].rarity)!;
      expect((p.virtualBits + p.seedBits) / (p.virtualItems + p.seedStock), p.item).toBe(tier.price);
      expect([p.virtualBits, p.virtualItems], p.item).toEqual([Number(live.virtual_bits), Number(live.virtual_items)]);
      expect(p.seedStock).toBeLessThanOrEqual(10);
      expect(p.seedBits).toBeLessThanOrEqual(300);
    }
    expect(NEW_STOCK_POOLS.reduce((n, p) => n + p.seedStock, 0)).toBe(28);
    expect(NEW_STOCK_POOLS.reduce((n, p) => n + p.seedBits, 0)).toBe(780);
    expect(defaultPoolConfigs().map((p) => p.item)).toEqual(LIVE.get_config.items);
    expect(marketPoolConfigs().map((p) => p.item)).toEqual([...LIVE.get_config.items, ...NEW_STOCK_IDS]);
  });

  it("awards come from verified stats alone, one per item per player per UTC day", () => {
    expect(dailyAward({ fightsWon: 4, fightsLost: 0, knockedOut: 0 })).toEqual([
      { item: "gas-receipt", amount: 1, source: "daily" },
      { item: "finality-flag", amount: 1, source: "daily-clean" },
    ]);
    expect(dailyAward({ fightsWon: 3, fightsLost: 1, knockedOut: 0 }).map((a) => a.item)).toEqual(["gas-receipt"]);
    expect(dailyAward({ fightsWon: 4, knockedOut: 1 }).map((a) => a.item)).toEqual(["gas-receipt"]);
    expect(dailyAward({}).map((a) => a.item)).toEqual(["gas-receipt"]);
    expect(caseAward({ cleared: 1 })).toEqual([{ item: "evidence-bag", amount: 1, source: "case" }]);
    expect(caseAward({ cleared: 0 })).toEqual([]);
    expect([1, 2, 3, 4].map((r) => podiumAward(r).length)).toEqual([1, 1, 1, 0]);
    expect(newStockKey({ item: "gas-receipt" }, "p1", "2026-11-16")).toBe("new-stock:gas-receipt:p1:2026-11-16");
  });

  it("an item is open only once its pool exists; a new suit only once its parts are open", () => {
    const live = LIVE.market_state.pools.map((p) => p.item);
    expect([...openNewStock(live)]).toEqual([]);
    const after = openNewStock([...live, ...NEW_STOCK_IDS]);
    expect([...after]).toEqual([...NEW_STOCK_IDS]);
    expect(suitOpen("notary", new Set())).toBe(false);
    expect(suitOpen("notary", after)).toBe(true);
    expect(suitOpen("stealth", new Set())).toBe(true);
    // The trade prompts never point at a suit whose parts Gwei can't sell yet.
    const h = { inventory: {}, suits: ["classic" as const], level: 5 };
    expect(suitGaps(h).map((g) => g.suit)).toEqual(["stealth", "glider", "octo", "sesame"]);
    expect(suitGaps(h, after).map((g) => g.suit)).toEqual(["stealth", "glider", "octo", "sesame", "notary", "finality"]);
  });
});

describe("the practice market and /lab/economy", () => {
  it("practice opens the new stock as a labelled preview while NEAR has no pool, and as itself once it does", () => {
    const before = seedPractice(null, 0);
    expect(before.book.pools.map((p) => p.item)).toEqual([...LAUNCH_ITEM_IDS, ...NEW_STOCK_IDS]);
    expect(before.preview).toEqual([...NEW_STOCK_IDS]);
    const pools = marketPoolConfigs().map((c) => ({ item: c.item, virtualBits: c.virtualBits, virtualItems: c.virtualItems, bits: c.seedBits, stock: c.seedStock, escrow: 0 }));
    const live = { onChain: true, params: before.book.params, items: pools.map((pool) => ({ item: pool.item, pool, spark: [] })) } as unknown as Parameters<typeof seedPractice>[0];
    const after = seedPractice(live, 0);
    expect(after.book.pools.map((p) => p.item)).toEqual([...LAUNCH_ITEM_IDS, ...NEW_STOCK_IDS]);
    expect(after.preview).toBeUndefined();
  });

  it("the lab's launch market is unchanged; with the new stock open, heroes earn, trade and craft it", () => {
    const base = { days: 10, bots: 24, seed: 2026, npc: false } as const;
    const launch = play(new Economy(base).config);
    expect(Object.keys(launch.history.at(-1)!.prices)).toEqual([...LAUNCH_ITEM_IDS]);
    const open = play(new Economy({ ...base, newStock: true }).config);
    const day0 = open.history[0]!;
    const last = open.history.at(-1)!;
    expect(Object.keys(last.prices)).toEqual([...LAUNCH_ITEM_IDS, ...NEW_STOCK_IDS]);
    // The launch pools open where they did, and at least one new pool's price moved: someone traded it.
    expect(LAUNCH_ITEM_IDS.map((i) => day0.prices[i])).toEqual(LAUNCH_ITEM_IDS.map((i) => launch.history[0]!.prices[i]));
    expect(NEW_STOCK_IDS.some((i) => last.prices[i] !== day0.prices[i])).toBe(true);
  });
});
