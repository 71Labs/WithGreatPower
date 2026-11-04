import { describe, expect, it } from "vitest";

import { generateCity } from "@wgp/game-core/sim3d";
import type { City } from "@wgp/game-core/sim3d/contract";
import type { Stop } from "@wgp/game-core/types";

import { generateFixtureCity } from "../fixture-city";
import { inferStreets } from "../city/streets";
import { CHANNEL } from "./clips";
import { CROWD_TIERS } from "./lod";
import { CLEAR, forbidden, inArena, lampPoles, planCrowd, rectDistance, walkAt, walkPaths, type BodyInfo } from "./placement";
import { CrowdRng, hash32 } from "./rng";

/** A night with every kind of stop: an arena, an errand, Doc's bridge, the boss. */
const STOPS: Stop[] = [
  { kind: "fight", villain: "gas-goblin", district: "sector-7", level: 1, boss: false, quest: false },
  { kind: "errand", ally: "aunt-mainnet", errand: "groceries", district: "queens-block" },
  { kind: "fight", villain: "doc-octochain", district: "bridge-district", level: 2, boss: false, quest: false },
  { kind: "fight", villain: "sandwich-man", district: "mempool-market", level: 2, boss: true, quest: false },
];

const BODIES: BodyInfo[] = Array.from({ length: 8 }, (_, i) => ({ phone: i % 3 === 0, looks: 12 }));
const cities: [string, City][] = [
  ["generated 7", generateCity(7, STOPS)],
  ["generated 12345", generateCity(12345, STOPS)],
  ["fixture", generateFixtureCity(7)],
];

describe("the crowd's seeded randomness", () => {
  it("is its own: the same seed and salt give the same stream, another salt another", () => {
    const a = new CrowdRng(42, 1);
    const b = new CrowdRng(42, 1);
    const c = new CrowdRng(42, 2);
    const xs = Array.from({ length: 8 }, () => a.next());
    expect(Array.from({ length: 8 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 8 }, () => c.next())).not.toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    expect(hash32(1, 2, 3)).toBe(hash32(1, 2, 3));
    expect(hash32(1, 2, 3)).not.toBe(hash32(3, 2, 1));
  });
});

describe.each(cities)("the crowd on a %s city", (name, city) => {
  const high = planCrowd(city, BODIES, CROWD_TIERS.high.density);

  it("is the same every time for a night's seed, and another for another seed", () => {
    expect(planCrowd(city, BODIES, CROWD_TIERS.high.density)).toEqual(high);
    const other = planCrowd(city, BODIES, CROWD_TIERS.high.density, city.seed + 1);
    expect(other.spots.map((s) => [s.x, s.z])).not.toEqual(high.spots.map((s) => [s.x, s.z]));
  });

  it("never touches the city it reads", () => {
    const before = JSON.stringify(city);
    planCrowd(city, BODIES, CROWD_TIERS.high.density);
    expect(JSON.stringify(city)).toBe(before);
  });

  it("puts people on the roofs, round the stops and on the sidewalks", () => {
    const kinds = new Set(high.spots.map((s) => s.kind));
    expect(kinds.has("roof")).toBe(true);
    if (city.zones.some((z) => z.kind === "fight")) expect(kinds.has("fight")).toBe(true);
    // The real errand roofs have room round the ally (the fixture's small towers don't).
    if (name !== "fixture") expect(kinds.has("errand")).toBe(true);
    expect(high.walkers.length).toBeGreaterThan(20);
  });

  it("keeps everyone out of the arenas, off the start, the river and the bridge", () => {
    for (const s of high.spots) {
      expect(inArena(city, s.x, s.z)).toBe(false);
      expect(forbidden(city, s.x, s.z)).toBe(false);
      expect(Math.hypot(s.x - city.start.x, s.z - city.start.z)).toBeGreaterThanOrEqual(CLEAR.start);
    }
    // Walk loops keep their distance from every arena, the river and the deck, all the way round.
    const tmp = { x: 0, z: 0, yaw: 0 };
    for (const p of high.paths) {
      for (let s = 0; s < p.len; s += 40) {
        walkAt(p, s, tmp);
        for (const z of city.zones) if (z.kind === "fight") expect(rectDistance(z.bounds, tmp.x, tmp.z)).toBeGreaterThanOrEqual(CLEAR.arenaWalk - 1);
        expect(forbidden(city, tmp.x, tmp.z) && Math.hypot(tmp.x - city.start.x, tmp.z - city.start.z) >= CLEAR.start).toBe(false);
      }
    }
  });

  it("stands spectators at a safe distance outside their arena, facing it", () => {
    for (const s of high.spots.filter((p) => p.kind === "fight")) {
      const zone = city.zones[s.zone];
      const d = rectDistance(zone.bounds, s.x, s.z);
      expect(d).toBeGreaterThanOrEqual(CLEAR.arena);
      if (s.y === 0) expect(d).toBeLessThanOrEqual(CLEAR.arenaFar);
      const toward = Math.atan2(zone.center.x - s.x, zone.center.z - s.z);
      const off = Math.abs(Math.atan2(Math.sin(s.yaw - toward), Math.cos(s.yaw - toward)));
      expect(off).toBeLessThan(0.6);
    }
  });

  it("keeps errand onlookers on the ally's roof, beyond the space kept clear round the ally", () => {
    for (const s of high.spots.filter((p) => p.kind === "errand")) {
      const ally = city.zones[s.zone].allyAt!;
      expect(Math.hypot(s.x - ally.x, s.z - ally.z)).toBeGreaterThanOrEqual(CLEAR.allyMin - 1e-6);
      // On the roof (or the tier) the ally stands on, never above them.
      const under = city.buildings.find((bd) => ally.x > bd.x0 && ally.x < bd.x1 && ally.z > bd.z0 && ally.z < bd.z1 && (bd.h === s.y || bd.top?.h === s.y));
      expect(under).toBeDefined();
      expect(s.y).toBeLessThanOrEqual(ally.y);
    }
  });

  it("stands roof people on a roof, inside its edge, off its setback and props", () => {
    for (const s of high.spots.filter((p) => p.kind === "roof" || (p.kind !== "errand" && p.y > 0))) {
      const b = city.buildings.find((bd) => s.x > bd.x0 && s.x < bd.x1 && s.z > bd.z0 && s.z < bd.z1 && bd.h === s.y);
      expect(b).toBeDefined();
      expect(Math.min(s.x - b!.x0, b!.x1 - s.x, s.z - b!.z0, b!.z1 - s.z)).toBeGreaterThan(CLEAR.roofEdge - 1e-6);
      if (b!.top) expect(s.x > b!.top.x0 - CLEAR.roofEdge && s.x < b!.top.x1 + CLEAR.roofEdge && s.z > b!.top.z0 - CLEAR.roofEdge && s.z < b!.top.z1 + CLEAR.roofEdge).toBe(false);
      for (const p of city.props) if (p.buildingId === b!.id) expect(Math.hypot(p.at.x - s.x, p.at.z - s.z)).toBeGreaterThanOrEqual(Math.max(p.w, p.d) / 2 + CLEAR.prop - 1e-6);
    }
  });

  it("spaces people apart, and off the street lamps", () => {
    const lamps = lampPoles(city, inferStreets(city));
    for (let i = 0; i < high.spots.length; i++) {
      const a = high.spots[i];
      for (let j = i + 1; j < high.spots.length; j++) expect(Math.hypot(a.x - high.spots[j].x, a.z - high.spots[j].z)).toBeGreaterThanOrEqual(CLEAR.person - 1e-6);
      if (a.y === 0) for (const l of lamps) expect(Math.hypot(a.x - l.x, a.z - l.z)).toBeGreaterThanOrEqual(CLEAR.lamp - 1e-6);
    }
  });

  it("thins out by tier: no sidewalks and only a few people on low", () => {
    const low = planCrowd(city, BODIES, CROWD_TIERS.low.density);
    const medium = planCrowd(city, BODIES, CROWD_TIERS.medium.density);
    expect(low.walkers).toHaveLength(0);
    expect(low.spots.length).toBeLessThan(medium.spots.length);
    expect(medium.spots.length + medium.walkers.length).toBeLessThan(high.spots.length + high.walkers.length);
    expect(low.spots.length).toBeLessThanOrEqual(CROWD_TIERS.low.density.roofGroups * 4 + city.zones.length * 8);
  });

  it("gives phone moves only to bodies with a phone in hand", () => {
    const phoneMoves = new Set([CHANNEL.phone, CHANNEL.photo, CHANNEL["walk-phone"]]);
    for (const s of high.spots) if (!BODIES[s.body].phone) expect(phoneMoves.has(s.idle) || phoneMoves.has(s.react)).toBe(false);
    for (const w of high.walkers) if (!BODIES[w.body].phone) expect(phoneMoves.has(w.channel) || phoneMoves.has(w.react)).toBe(false);
  });
});

describe("walk loops", () => {
  const city = generateCity(7, STOPS);
  const paths = walkPaths(city);

  it("go round the blocks on the sidewalk, continuously, heading along the way", () => {
    expect(paths.length).toBeGreaterThan(10);
    const a = { x: 0, z: 0, yaw: 0 };
    const b = { x: 0, z: 0, yaw: 0 };
    for (const p of paths) {
      for (let s = 0; s < p.len; s += 5) {
        walkAt(p, s, a);
        walkAt(p, s + 1, b);
        expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(1, 1);
        // The heading points where the next step goes.
        expect(Math.hypot(Math.sin(a.yaw) - (b.x - a.x), Math.cos(a.yaw) - (b.z - a.z))).toBeLessThan(0.15);
        // On the loop's rectangle (within its rounded corners).
        expect(a.x).toBeGreaterThanOrEqual(p.x0 - 1e-6);
        expect(a.x).toBeLessThanOrEqual(p.x1 + 1e-6);
      }
      // It closes: one lap ends where it began.
      walkAt(p, 0, a);
      walkAt(p, p.len, b);
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(1e-6);
    }
  });
});
