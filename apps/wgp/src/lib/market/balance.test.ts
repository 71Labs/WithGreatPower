import { describe, expect, it } from "vitest";

import { ALTERNATIVES, BAND, DRAIN, MAINNET, RECOMMENDED, RECOMMENDED_WITH_TAPER, SEASON, SIXTY, economyConfig, gini, measure, measureEconomy, measured, median, play, poolConfigsFor, verdict, type Setting } from "./balance";
import { defaultPoolConfigs, seededPools } from "./config";
import { spotMilli } from "./math";

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
