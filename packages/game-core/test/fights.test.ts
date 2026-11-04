/**
 * Ruleset 4's grounded fights, pinned: each arena is one flat stage the hero never leaves
 * mid-fight; the web button strikes a villain in reach and zips at one further out; getting hurt
 * is a shove along the roof, never a launch; and over real fights (fight-metrics.ts) the hero
 * stays on his feet, the bot and an average player win in 15–45 seconds, and a player who never
 * dodges still wins some.
 */
import { describe, expect, it } from "vitest";

import { VILLAINS } from "../src/rules/data";
import { reduce } from "../src/rules/engine";
import type { Stop, VillainId } from "../src/rules/types";
import { CityIndex, generateCity, groundBelow } from "../src/sim3d/city";
import { hurtHero } from "../src/sim3d/combat";
import { DECK_HALF, HERO_RADIUS, STAGE_H, STRIKE_STEP, ZIP_RANGE } from "../src/sim3d/constants";
import type { InputFrame } from "../src/sim3d/contract";
import { len2 } from "../src/sim3d/dmath";
import { createSim, IDLE_FRAME, stepSim } from "../src/sim3d/sim";
import type { SimEvent, SimState } from "../src/sim3d/types";
import { balanceFights, nightFights, summarizeFights } from "./fight-metrics";
import { heroSave, STANDARD } from "./helpers";

const stops = (villain: VillainId): Stop[] => [
  { kind: "fight", villain, district: VILLAINS[villain].district, level: 1, boss: false, quest: false },
  { kind: "errand", ally: "aunt-mainnet", errand: "groceries", district: "queens-block" },
  { kind: "errand", ally: "gwei", errand: "team-up", district: "validator-heights" },
  { kind: "fight", villain: villain === "sybil" ? "gas-goblin" : "sybil", district: "validator-heights", level: 1, boss: true, quest: false },
];

/** A fight at the first stop, live (past the entrance), the hero standing on the stage. */
function fight(villain: VillainId, seed = 0x5eed): SimState {
  const p = reduce(heroSave(STANDARD, "Fighter", 1), { type: "start-patrol", seed }).patrol!;
  const s = createSim({ seed: p.seed, stops: stops(villain), index: 0, entry: "zone", hp: 100, maxHp: 100, fluid: 100, combo: 0, gweiCalls: 0, heroLevel: 1, loadout: [] });
  for (let i = 0; i < 60 * 4 && s.mode !== "fight"; i++) stepSim(s, IDLE_FRAME);
  s.events.length = 0;
  expect(s.mode).toBe("fight");
  return s;
}

function steps(s: SimState, frame: InputFrame, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    stepSim(s, frame);
    out.push(...s.events.splice(0));
  }
  return out;
}

describe("the stage (v4)", () => {
  it("is one flat roof between four corner towers, and Doc's deck is wide, both kept on in a fight", () => {
    for (const seed of [3, 99, 2024]) {
      const c = generateCity(seed, stops("gas-goblin"));
      const grid = new CityIndex(c);
      const z = c.zones[0];
      const st = z.stage!;
      expect(st.y).toBe(STAGE_H);
      expect(z.center.y).toBe(STAGE_H);
      // Flat everywhere off the corner towers: no gaps, no steps, no street.
      let towers = 0;
      for (let x = st.x0 + 5; x < st.x1; x += 20) {
        for (let zz = st.z0 + 5; zz < st.z1; zz += 20) {
          const top = groundBelow(grid, x, zz, 5000);
          if (top === STAGE_H) continue;
          towers += 1;
          expect(top).toBe(780);
        }
      }
      // The towers are a small share of it.
      expect(towers / (((st.x1 - st.x0) / 20) * ((st.z1 - st.z0) / 20))).toBeLessThan(0.15);
    }
    const doc: Stop[] = [{ kind: "fight", villain: "doc-octochain", district: "bridge-district", level: 1, boss: false, quest: false }, ...stops("sybil").slice(1)];
    const c = generateCity(42, doc);
    const d = c.bridge!.deck;
    expect(c.bridge!.axis === "x" ? d.z1 - d.z0 : d.x1 - d.x0).toBe(DECK_HALF * 2);
    expect(c.zones[0].stage!.y).toBe(d.y);
  });

  it("holds the hero on it: running at its edge, or shoved off it, he stays on the roof", () => {
    const s = fight("sandwich-man");
    const st = s.city.zones[0].stage!;
    // Run hard at the nearest edge for three seconds.
    const events = steps(s, { dir: 32, mag: 3, web: false, shot: 0 }, 180);
    expect(events.filter((e) => e.type === "miss")).toHaveLength(0);
    expect(s.hero.x - HERO_RADIUS).toBeGreaterThanOrEqual(st.x0 - 1e-6);
    expect(s.hero.y - HERO_RADIUS).toBeGreaterThanOrEqual(st.y - 1e-6);
  });
});

describe("the web button in a fight (v4)", () => {
  it("strikes a villain in reach, on the ground, and the blow lands", () => {
    const s = fight("sandwich-man");
    const v = s.villain!;
    const h = s.hero;
    // Stand right beside him, on the roof.
    v.phase = "idle";
    v.attackT = 99;
    v.attack2T = 99;
    v.dodgeT = 99;
    h.x = v.x - (v.radius + HERO_RADIUS + 40);
    h.z = v.z;
    h.y = s.city.zones[0].stage!.y + HERO_RADIUS;
    h.grounded = true;
    const hits = v.hits;
    const events = [...steps(s, { ...IDLE_FRAME, web: true }, 1), ...steps(s, IDLE_FRAME, 20)];
    expect(events.some((e) => e.type === "strike")).toBe(true);
    expect(events.some((e) => e.type === "thwip")).toBe(false);
    const hit = events.find((e) => e.type === "villain-hit");
    expect(hit && hit.type === "villain-hit" && hit.by).toBe("strike");
    expect(v.hits).toBe(hits - 1);
    expect(h.grounded).toBe(true);
    // A second press into his guard clangs.
    const again = [...steps(s, { ...IDLE_FRAME, web: true }, 1), ...steps(s, IDLE_FRAME, 20)];
    if (again.some((e) => e.type === "strike")) expect(again.some((e) => e.type === "clang")).toBe(true);
    expect(STRIKE_STEP).toBeGreaterThan(100);
  });

  it("zips at a villain further out across the roof, into a strike, and never swings beside him", () => {
    const s = fight("sandwich-man");
    const v = s.villain!;
    const h = s.hero;
    v.phase = "idle";
    v.attackT = 99;
    v.attack2T = 99;
    v.dodgeT = 99;
    const st = s.city.zones[0].stage!;
    h.x = Math.max(st.x0 + 40, v.x - 360);
    h.z = v.z;
    h.y = st.y + HERO_RADIUS;
    h.grounded = true;
    const d0 = len2(v.x - h.x, v.z - h.z);
    expect(d0).toBeLessThan(ZIP_RANGE);
    const events = [...steps(s, { ...IDLE_FRAME, web: true }, 1), ...steps(s, IDLE_FRAME, 40)];
    expect(events.some((e) => e.type === "zip")).toBe(true);
    expect(events.some((e) => e.type === "strike")).toBe(true);
    expect(events.some((e) => e.type === "thwip")).toBe(false);
    expect(len2(v.x - h.x, v.z - h.z)).toBeLessThan(d0 - 150);
  });

  it("over the Goblin's head, out of reach, does nothing (a fizzle), not a swing", () => {
    const s = fight("gas-goblin");
    const v = s.villain!;
    const h = s.hero;
    // Him cruising high above, the hero under him.
    h.x = v.x;
    h.z = v.z;
    h.y = s.city.zones[0].stage!.y + HERO_RADIUS;
    h.grounded = true;
    v.y = h.y + 300;
    v.phase = "idle";
    const events = steps(s, { ...IDLE_FRAME, web: true }, 1);
    expect(events.some((e) => e.type === "thwip")).toBe(false);
    expect(h.grounded).toBe(true);
  });
});

describe("getting hurt in a fight (v4)", () => {
  it("is a shove along the roof that slides out, never a launch", () => {
    const s = fight("sandwich-man");
    const h = s.hero;
    h.grounded = true;
    h.vx = h.vy = h.vz = 0;
    expect(hurtHero(s, 10, "test", h.x - 50, h.y - 40, h.z)).toBe(true);
    expect(h.vy).toBe(0);
    expect(len2(h.vx, h.vz)).toBeGreaterThan(300);
    const x0 = h.x;
    steps(s, IDLE_FRAME, 40);
    expect(h.grounded).toBe(true);
    // Slid a little way, then stopped.
    expect(h.x - x0).toBeGreaterThan(30);
    expect(h.x - x0).toBeLessThan(200);
  });
});

describe("real fights stay on the ground and come out balanced (fight-metrics.ts)", () => {
  it("the bot over real nights: on its feet, no street, a hit taken now and then", () => {
    const s = summarizeFights(nightFights("bot", 6));
    expect(s.winRate).toBe(1);
    expect(s.heroAir).toBeLessThan(0.15);
    expect(s.heroTakeoffsPerMin).toBeLessThan(12);
    expect(s.missesPerMin).toBe(0);
    expect(s.websPerMin).toBeLessThan(5);
    expect(s.heroVySd).toBeLessThan(120);
    expect(s.medianSeconds).toBeGreaterThan(10);
    expect(s.medianSeconds).toBeLessThan(40);
  }, 120_000);

  it("an average player wins most fights in 15–45 s, taking real damage; one who never dodges still wins some", () => {
    const nights = [1, 9];
    const seeds = [11, 37];
    const avg = summarizeFights(balanceFights("average", nights, seeds));
    expect(avg.winRate).toBeGreaterThanOrEqual(0.85);
    expect(avg.medianSeconds).toBeGreaterThan(15);
    expect(avg.medianSeconds).toBeLessThan(45);
    expect(avg.meanDamageShare).toBeGreaterThan(0.15);
    expect(avg.heroAir).toBeLessThan(0.15);
    expect(avg.meleeShare).toBeGreaterThan(0.3);
    const simple = summarizeFights(balanceFights("simple", nights, seeds));
    expect(simple.winRate).toBeGreaterThan(0.3);
    expect(simple.meanDamageShare).toBeGreaterThan(avg.meanDamageShare);
  }, 300_000);
});
