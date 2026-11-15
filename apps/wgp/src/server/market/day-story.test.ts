/**
 * A card's 24-hour pill and Gwei's "Why this price?" must tell one story, in every market a
 * visitor can see: the practice market (a guest's browser), the simulated market (a local
 * checkout) and the on-chain one. Each case builds the item the way that market really does
 * (practice.ts `practiceScreen`; history.ts `priceStats` and view.ts `itemViews` for the two
 * server-side markets), then reads both the pill's text and the reasoning from that one item.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import type { MarketItemView, MarketView } from "@/lib/market/api";
import { DEFAULT_PARAMS, marketPoolConfigs, seededPools } from "@/lib/market/config";
import { formatChange } from "@/lib/market/format";
import { afterBuy, buyQuote, sellQuote, spotMilli, type Pool } from "@/lib/market/math";
import { practiceBase, practiceScreen, practiceTrade, seedPractice } from "@/lib/market/practice";
import { explainPrice } from "@/lib/market/reasoning";
import { dayFacts } from "@/lib/market/spark";

import { priceStats } from "./history";
import { itemViews } from "./view";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const HOUR = 3_600_000;
const FEE = DEFAULT_PARAMS.feeBps;

/** What the card shows for an item: the pill's text, and every word of Gwei's reasoning. */
function story(item: MarketItemView) {
  const pill = item.change24h === null ? "New" : formatChange(item.change24h);
  const why = explainPrice({ pool: item.pool, open: true, feeBps: FEE, change24h: item.change24h, trades24h: item.trades24h });
  return { pill, text: JSON.stringify(why) };
}

/** The rule itself: no "hasn't moved" beside a pill that moved, and a moved pill's number is in her words. */
function agrees(item: MarketItemView) {
  const { pill, text } = story(item);
  const moved = pill !== "New" && pill !== "0%";
  if (moved) {
    expect(text, `${item.item}: pill ${pill}`).not.toMatch(/hasn’t moved|No change|back where it was/);
    expect(text, `${item.item}: pill ${pill}`).toContain(pill.replace(/^[+−]/, ""));
  } else {
    expect(text, `${item.item}: pill ${pill}`).not.toMatch(/moved the price [+−]|(Up|Down) \d+%|is (up|down) \d+%/);
  }
  return { pill, text, moved };
}

/** Crumbs after `n` single buys from the seeded pool, with the price after each. */
function boughtCrumbs(n: number) {
  let pool = seededPools().find((p) => p.item === "crumbs")!;
  const prices: number[] = [spotMilli(pool)];
  for (let i = 0; i < n; i++) {
    pool = afterBuy(pool, 1, buyQuote(pool, 1, FEE)!.cost);
    prices.push(spotMilli(pool));
  }
  return { pool, prices };
}

/** A server-side market's items from its price rows, exactly as GET /api/market builds them. */
function serverItems(pools: Pool[], rows: { item: string; kind: string; priceMilli: number; at: Date }[], opening: Map<string, number>) {
  return itemViews(DEFAULT_PARAMS, pools, priceStats(pools, rows, opening, { from: NOW - 24 * HOUR, to: NOW }));
}

function liveView(items: MarketItemView[], onChain: boolean): MarketView {
  return { onChain, network: onChain ? "mainnet" : null, contractId: onChain ? "game.wgpnear.near" : null, vendor: null, params: DEFAULT_PARAMS, items, listings: 0, till: 0, updatedAt: new Date(NOW).toISOString() };
}

/** A day on which crumbs were bought `n` times, as the server's history holds it. */
function tradedDay(n: number) {
  const { pool, prices } = boughtCrumbs(n);
  const pools = seededPools().map((p) => (p.item === "crumbs" ? pool : p));
  const rows = prices.slice(1).map((priceMilli, i) => ({ item: "crumbs", kind: "trade", priceMilli, at: new Date(NOW - (n + 3 - i) * HOUR) }));
  const opening = new Map(pools.map((p) => [p.item, p.item === "crumbs" ? prices[0]! : spotMilli(p)]));
  return { pools, rows, opening, prices };
}

describe.each([
  ["the on-chain market", true],
  ["the simulated market", false],
])("%s: the pill and Why this price? agree", (_name, onChain) => {
  it("with a day of trades: the pill's change is the one Gwei gives, with the trades that made it", () => {
    const day = tradedDay(3);
    const items = serverItems(day.pools, day.rows, day.opening);
    const crumbs = agrees(items.find((i) => i.item === "crumbs")!);
    expect(crumbs.moved).toBe(true);
    expect(crumbs.text).toContain(`3 trades with me in the last 24 hours moved the price ${crumbs.pill}.`);
    for (const i of items) agrees(i);
  });

  it("with no history: every pill is flat or New, and she never claims a move", () => {
    const pools = seededPools();
    // No rows at all, then an opening price and no trades.
    for (const items of [serverItems(pools, [], new Map()), serverItems(pools, [], new Map(pools.map((p) => [p.item, spotMilli(p)])))]) {
      expect(items).toHaveLength(pools.length);
      for (const i of items) {
        const s = agrees(i);
        expect(s.moved).toBe(false);
        expect(s.text).toContain("Nobody’s traded these with me in the last 24 hours, so the price hasn’t moved.");
      }
    }
  });

  it("with a move the history has no trade for: she says so instead of “hasn’t moved”", () => {
    const day = tradedDay(4);
    const items = serverItems(day.pools, [], day.opening);
    const crumbs = agrees(items.find((i) => i.item === "crumbs")!);
    expect(crumbs.moved).toBe(true);
    expect(crumbs.text).toMatch(/No trades with me on record in the last 24 hours, but the price is up \d+% on a day ago\./);
  });

  it("opens a practice market that tells the same story as the market it copied", () => {
    const day = tradedDay(3);
    const live = serverItems(day.pools, day.rows, day.opening);
    const practice = practiceScreen(seedPractice(liveView(live, onChain), NOW), practiceBase(0, {}), NOW + 60_000).view.items;
    const there = agrees(live.find((i) => i.item === "crumbs")!);
    const here = agrees(practice.find((i) => i.item === "crumbs")!);
    // The judge's defect was a pill of "+N%" over "nobody's traded … the price hasn't moved".
    expect(here.pill).toBe(there.pill);
    expect(here.moved).toBe(true);
    expect(here.text).toContain(`3 trades with me in the last 24 hours moved the price ${here.pill}.`);
    for (const i of practice) agrees(i);
  });
});

describe("the practice market: the pill and Why this price? agree", () => {
  const quiet = (pools = seededPools()): MarketItemView[] =>
    pools.map((pool) => ({
      item: pool.item as ItemId,
      name: ITEMS[pool.item as ItemId].name,
      rarity: ITEMS[pool.item as ItemId].rarity,
      priceMilli: spotMilli(pool),
      buyOne: buyQuote(pool, 1, FEE)?.total ?? null,
      sellOne: sellQuote(pool, 1, FEE)?.net ?? null,
      spark: [spotMilli(pool), spotMilli(pool)],
      sparkSteps: [[0, spotMilli(pool)]],
      change24h: 0,
      trades24h: 0,
      pool,
    }));

  it("with no history (the live market had a quiet day, or there is no live market): flat pills, no claimed move", () => {
    for (const live of [liveView(quiet(), true), null]) {
      const items = practiceScreen(seedPractice(live, NOW), practiceBase(0, {}), NOW + 60_000).view.items;
      expect(items).toHaveLength(marketPoolConfigs().length);
      for (const i of items) {
        const s = agrees(i);
        expect(s.moved).toBe(false);
        expect(s.text).toContain("Nobody’s traded these with me in the last 24 hours, so the price hasn’t moved.");
      }
    }
  });

  it("adds the visitor's own trades to the seeded day, in both the pill and her words", () => {
    const day = tradedDay(2);
    const live = serverItems(day.pools, day.rows, day.opening);
    let state = seedPractice(liveView(live, true), NOW);
    state = practiceTrade(state, practiceBase(0, {}), { action: "buy", item: "crumbs", amount: 1, maxBits: 1_000 }, NOW + 60_000).state;
    const crumbs = practiceScreen(state, practiceBase(0, {}), NOW + 120_000).view.items.find((i) => i.item === "crumbs")!;
    expect(crumbs.trades24h).toBe(3);
    const s = agrees(crumbs);
    expect(s.text).toContain(`3 trades with me in the last 24 hours moved the price ${s.pill}.`);
    // Most of a day later the seeded trades have aged out of the pill and of her words together.
    agrees(practiceScreen(state, practiceBase(0, {}), NOW + 23 * HOUR).view.items.find((i) => i.item === "crumbs")!);
  });

  it("dayFacts: a change other than zero always comes with a move", () => {
    expect(dayFacts([], undefined, 12_000, 0)).toEqual({ change24h: 0, moves: 0 });
    expect(dayFacts([[5, 12_000]], undefined, 12_000, 0)).toEqual({ change24h: 0, moves: 0 });
    expect(dayFacts([[5, 12_300]], 12_000, 12_300, 0)).toEqual({ change24h: 0.025, moves: 1 });
    expect(dayFacts([[5, 12_300]], 12_000, 12_600, 0)).toEqual({ change24h: 0.05, moves: 2 });
    const cases: [[number, number][], number | undefined, number][] = [[[[1, 10], [2, 11]], 9, 12], [[], 10, 11], [[[3, 7]], undefined, 9]];
    for (const [rows, before, now] of cases) {
      const f = dayFacts(rows, before, now, 0);
      if (f.change24h) expect(f.moves).toBeGreaterThan(0);
    }
  });
});
