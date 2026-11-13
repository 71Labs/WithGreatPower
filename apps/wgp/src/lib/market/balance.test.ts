import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ALTERNATIVES, BAND, DRAIN, INVEST_SHOWCASE, MAINNET, RECOMMENDED, RECOMMENDED_WITH_TAPER, SEASON, SIXTY, economyConfig, gini, investStory, measure, measureEconomy, measured, median, play, poolConfigsFor, vendorLimits, verdict, type Setting } from "./balance";
import { LAB_INVESTORS } from "./bots";
import { defaultPoolConfigs, seededPools } from "./config";
import { sellQuote, spotMilli } from "./math";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const SETTINGS: Setting[] = [MAINNET, RECOMMENDED, RECOMMENDED_WITH_TAPER, ...ALTERNATIVES];

describe("the economy's accounting", () => {
  it("balances to the Bit every day, for every setting and seed: seeded till + minted − burned = supply", () => {
    for (const setting of SETTINGS) {
      for (const seed of SEEDS) {
        // Odd seeds keep their heroes; even seeds have them quit after 8 nights.
        const e = play(economyConfig(setting, { ...SEASON, seed, lifespan: seed % 2 ? undefined : 8 }));
        const till = e.history[0]!.till;
        let previous = e.history[0]!;
        for (const d of e.history) {
          expect(d.supply, `${setting.id} seed ${seed} day ${d.day}`).toBe(till + d.minted - d.burned);
          // The day's change in supply is exactly what it minted less what it burned.
          expect(d.supply - previous.supply).toBe(d.minted - previous.minted - (d.burned - previous.burned));
          previous = d;
        }
      }
    }
  });

  it("splits what was minted and burned by cause without losing a Bit", () => {
    for (const setting of SETTINGS) {
      for (const seed of SEEDS.slice(0, 3)) {
        const e = play(economyConfig(setting, { ...SEASON, seed }));
        const m = measureEconomy(setting.id, e);
        const last = e.history.at(-1)!;
        expect(m.minted.score + m.minted.showingUp + m.minted.levelUp).toBe(m.minted.total);
        expect(m.minted.total).toBe(last.minted);
        expect(m.burned.fee + m.burned.craft).toBe(m.burned.total);
        expect(m.burned.total).toBe(last.burned);
        expect(m.burned.craft).toBe(last.crafted * setting.craftBits);
        expect(m.supply).toBe(m.seededTill + m.minted.total - m.burned.total);
        // Only a taper withholds Bits, and what it withholds was never minted.
        if (!setting.taper) expect(m.minted.withheld).toBe(0);
        else expect(m.minted.withheld).toBeGreaterThan(0);
      }
    }
  });

  it("holds the contract's rule that a hero crafts each suit once", () => {
    const e = play(economyConfig(MAINNET, { days: 60, bots: 60, seed: 5 }));
    for (const bot of e.bots) {
      expect(new Set(bot.suits).size).toBe(bot.suits.length);
      expect(bot.suits.length).toBeLessThanOrEqual(4);
      if (bot.kind !== "crafter") expect(bot.suits).toHaveLength(0);
    }
  });

  it("is the same measurement for the same seed", () => {
    expect(measure(RECOMMENDED, { ...SEASON, seed: 9 })).toEqual(measure(RECOMMENDED, { ...SEASON, seed: 9 }));
    expect(measure(RECOMMENDED, { ...SEASON, seed: 9 })).not.toEqual(measure(RECOMMENDED, { ...SEASON, seed: 10 }));
  });

  it("measures inequality and medians", () => {
    expect(gini([5, 5, 5, 5])).toBe(0);
    expect(gini([0, 0, 0, 12])).toBeCloseTo(0.75);
    expect(gini([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("the recommended settings", () => {
  const judged = (s: Setting) => ({ season: measured(s, SEASON, SEEDS), sixty: measured(s, SIXTY, SEEDS) });

  it("meet the band: 25–100% of a season's Bits burned, a first suit by night 5, Gwei trading 90% of item-days", () => {
    const { season, sixty } = judged(RECOMMENDED);
    expect(season.burnShare).toBeGreaterThanOrEqual(BAND.burnShare[0]);
    expect(season.burnShare).toBeLessThanOrEqual(BAND.burnShare[1]);
    expect(season.firstSuitNight).toBeLessThanOrEqual(BAND.firstSuitNight);
    expect(sixty.soldOut + sixty.broke).toBeLessThanOrEqual(BAND.vendorDown);
    expect(verdict(season, sixty)).toEqual({ burnShare: true, firstSuit: true, vendor: true, ok: true });
  });

  it("still meet it with the faucet taper, which burns a larger share and mints less", () => {
    const flat = judged(RECOMMENDED);
    const taper = judged(RECOMMENDED_WITH_TAPER);
    expect(verdict(taper.season, taper.sixty).ok).toBe(true);
    expect(taper.season.burnShare).toBeGreaterThan(flat.season.burnShare);
    expect(taper.sixty.minted.total).toBeLessThan(flat.sixty.minted.total * 0.6);
  });

  it("are what mainnet's settings miss: today under 5% of a season's Bits are burned", () => {
    const { season, sixty } = judged(MAINNET);
    expect(season.burnShare).toBeLessThan(0.05);
    expect(verdict(season, sixty).ok).toBe(false);
  });

  it("leave the curves alone, so applying them moves no price", () => {
    expect(poolConfigsFor(RECOMMENDED)).toEqual(defaultPoolConfigs());
    expect(RECOMMENDED.feeBps).toBeLessThanOrEqual(1_000);
  });

  it("can reprice a pool without touching what Gwei holds", () => {
    const doubled = seededPools(poolConfigsFor({ priceScale: 2, depthScale: 1 }));
    for (const [i, p] of seededPools().entries()) {
      expect(doubled[i]).toMatchObject({ bits: p.bits, stock: p.stock });
      expect(spotMilli(doubled[i]!)).toBe(2 * spotMilli(p));
    }
  });
});

describe("the Drain Gwei run", () => {
  it("ends days with her sold out of something and with a till that can't buy, for every seed", () => {
    for (const seed of [...SEEDS, 2026]) {
      const m = measureEconomy("drain", play(economyConfig(MAINNET, { ...DRAIN, seed })));
      expect(m.soldOut, `seed ${seed}`).toBeGreaterThan(0);
      expect(m.broke, `seed ${seed}`).toBeGreaterThan(0.1);
    }
  });

  it("still does in the lab, where Sandwich Man trades too (seed 2026)", () => {
    const m = measureEconomy("drain", play(economyConfig(MAINNET, { ...DRAIN, seed: 2026, npc: true })));
    expect(m.soldOut).toBeGreaterThan(0);
    expect(m.broke).toBeGreaterThan(0.1);
  });
});

describe("Sandwich Man in the measurements", () => {
  it("is off unless asked for, so the documented tables are measured without him", () => {
    expect(economyConfig(RECOMMENDED, { ...SEASON, seed: 1 }).npc).toBe(false);
    expect(play(economyConfig(RECOMMENDED, { ...SEASON, seed: 1 })).history.every((d) => d.npc === null)).toBe(true);
    expect(play(economyConfig(RECOMMENDED, { ...SEASON, seed: 1, npc: true })).history.every((d) => d.npc !== null)).toBe(true);
  });

  it("balances to the Bit with him trading, his one-off seed counted once", () => {
    for (const setting of [MAINNET, RECOMMENDED]) {
      const e = play(economyConfig(setting, { ...SEASON, seed: 3, npc: true }));
      const till = e.history[0]!.till;
      for (const d of e.history) expect(d.supply, `${setting.id} day ${d.day}`).toBe(till + d.minted - d.burned);
    }
  });

  it("moves the season's burn share by under a point, and the recommendation still meets the band (docs/ECONOMY.md)", () => {
    const without = measured(RECOMMENDED, SEASON, SEEDS);
    const season = measured(RECOMMENDED, { ...SEASON, npc: true }, SEEDS);
    const sixty = measured(RECOMMENDED, { ...SIXTY, npc: true }, SEEDS);
    expect(Math.abs(season.burnShare - without.burnShare)).toBeLessThan(0.01);
    expect(season.burned.craft).toBe(without.burned.craft);
    expect(verdict(season, sixty).ok).toBe(true);
  });
});

describe("investor bots in the measurements", () => {
  it("are off unless asked for: no investing rules, no investors, and the run is the one that was documented", () => {
    const config = economyConfig(RECOMMENDED, { ...SEASON, seed: 1 });
    expect(config.investors).toBeUndefined();
    const e = play(config);
    expect(e.book.params.invest).toBeUndefined();
    expect(e.book.investors).toBeUndefined();
    expect(e.investorIds).toEqual([]);
    expect(e.history.every((d) => d.investors === null && Object.values(d.invested).every((n) => n === 0))).toBe(true);
    // No pool ever carried an investing field, so every fee was burned whole, as on contract v2.
    expect(e.book.pools.every((p) => p.invested === undefined && p.rewards === undefined)).toBe(true);
    // Asking for them is the only thing that turns them on.
    expect(economyConfig(RECOMMENDED, { ...SEASON, seed: 1, invest: true }).investors).toEqual(LAB_INVESTORS);
  });
});

describe("the showcase: Gwei goes broke, an investor reopens her", () => {
  // Exactly the run the lab's button builds.
  const showcase = () => play(economyConfig(MAINNET, { ...INVEST_SHOWCASE, npc: true }));

  it("is the same run every time", () => {
    const read = (e: ReturnType<typeof showcase>) => e.history.map((d) => [d.prices, d.tills, d.broke, d.invested, d.investors]);
    expect(read(showcase())).toEqual(read(showcase()));
    expect(INVEST_SHOWCASE).toMatchObject({ days: DRAIN.days, bots: DRAIN.bots, mix: DRAIN.mix, seed: 2026, invest: true });
  });

  it("has a till run dry, an investor fund it the next morning, and the shop buy again", () => {
    const e = showcase();
    const h = e.history;
    // The first day a shop ends closed...
    const day = h.findIndex((d) => Object.values(d.broke).some(Boolean));
    expect(day).toBeGreaterThan(0);
    const item = Object.keys(h[day]!.broke).find((i) => h[day]!.broke[i])!;
    // ...the next morning an investor puts Bits into exactly that till...
    const next = h[day + 1]!;
    const invest = next.investors!.events.find((x) => x.kind === "invest");
    expect(invest).toMatchObject({ item, kind: "invest", bits: LAB_INVESTORS.lot, earned: 0 });
    expect(next.invested[item]).toBe(LAB_INVESTORS.lot);
    // ...and that day it ends open: she bought from the heroes again.
    expect(next.broke[item]).toBe(false);
    // Investing moved no price by itself: the pool's curve total is what the owner set, with the stake standing in for virtual Bits.
    const pool = e.book.pools.find((p) => p.item === item)!;
    const seeded = seededPools().find((p) => p.item === item)!;
    expect(pool.virtualBits + (pool.invested ?? 0)).toBe(seeded.virtualBits);
  });

  it("only ever funds a till that ended the day before broke, and keeps her buying far more of the time", () => {
    const e = showcase();
    const story = investStory(e);
    const invests = e.history.flatMap((d) => (d.investors?.events ?? []).filter((x) => x.kind === "invest")).length;
    expect(invests).toBeGreaterThanOrEqual(8);
    expect(story.reopenings).toBe(invests);
    // The same heroes with no investors: her shops end many more days closed.
    const without = investStory(play(economyConfig(MAINNET, { ...DRAIN, seed: INVEST_SHOWCASE.seed, npc: true })));
    expect(without.reopenings).toBe(0);
    expect(without.brokeDays).toBeGreaterThan(50);
    expect(story.brokeDays).toBeLessThan(without.brokeDays / 3);
    expect(measureEconomy("showcase", e).broke).toBeLessThan(0.1);
  });

  it("pays the investors a share of the fees, and shows what they risk: most of their Bits are still in her tills", () => {
    const e = showcase();
    const story = investStory(e);
    const last = e.history.at(-1)!.investors!;
    expect(story.earned).toBeGreaterThan(50);
    // Sellers took the Bits the investors put in; the stakes wait for someone to buy that stock.
    expect(story.staked).toBeGreaterThan(story.invested * 0.8);
    expect(story.invested - story.withdrawn).toBe(story.staked);
    // Never principal: what they hold, plus what they have staked, is what they started with plus fees earned.
    expect(last.wallet + last.staked).toBe(LAB_INVESTORS.count * LAB_INVESTORS.bits + story.earned);
  });

  it("counts her closed item-days one way: the lab's header, the investors' panel and docs/INVESTING.md read the same number", () => {
    const e = showcase();
    const limits = vendorLimits(e.history);
    // The header's "unable to buy on N of M item-days" and the panel's "Shop-days closed" are both this.
    expect(limits.broke).toBe(investStory(e).brokeDays);
    expect(limits.itemDays).toBe(INVEST_SHOWCASE.days * e.book.pools.length);
    // It agrees with the measured share (balance.ts `measureEconomy`), which works the till out from the curve.
    expect(Math.round(measureEconomy("showcase", e).broke * limits.itemDays)).toBe(limits.broke);
    // The old header ignored the Bits investors had put in and read one item-day too many (12). Without investors nothing changes.
    const feeBps = e.book.params.feeBps;
    const ignoringInvestors = (h: typeof e.history) => h.slice(1).reduce((n, d) => n + seededPools().filter((p) => sellQuote({ ...p, stock: d.stock[p.item] ?? 0, bits: d.tills[p.item] ?? 0 }, 1, feeBps) === null).length, 0);
    expect(ignoringInvestors(e.history)).toBe(limits.broke + 1);
    const plain = play(economyConfig(MAINNET, { ...DRAIN, seed: INVEST_SHOWCASE.seed, npc: true }));
    expect(ignoringInvestors(plain.history)).toBe(vendorLimits(plain.history).broke);
    // And the document says this number.
    expect(readFileSync(new URL("../../../../../docs/INVESTING.md", import.meta.url), "utf8")).toContain(`her shops end ${limits.broke} item-days closed, against ${vendorLimits(plain.history).broke} in the same run without investors`);
  });

  it("gives the numbers docs/INVESTING.md quotes for seed 2026", () => {
    const story = investStory(showcase());
    const without = investStory(play(economyConfig(MAINNET, { ...DRAIN, seed: INVEST_SHOWCASE.seed, npc: true })));
    expect({ closedWith: story.brokeDays, closedWithout: without.brokeDays, invested: story.invested, earned: story.earned, staked: story.staked }).toEqual({
      closedWith: 11,
      closedWithout: 70,
      invested: 1_195,
      earned: 133,
      staked: 1_130,
    });
  });

  it("balances to the Bit every day, the investors' wallets, stakes and unclaimed earnings included, for several seeds", () => {
    for (const seed of [INVEST_SHOWCASE.seed, 1, 7]) {
      const e = play(economyConfig(MAINNET, { ...INVEST_SHOWCASE, seed, npc: true }));
      const till = e.history[0]!.till;
      for (const d of e.history) expect(d.supply, `seed ${seed} day ${d.day}`).toBe(till + d.minted - d.burned);
      // Their starting Bits are counted as minted once, like Sandwich Man's seed.
      expect(e.history[0]!.minted).toBe(LAB_INVESTORS.count * LAB_INVESTORS.bits + 300);
    }
  });
});
