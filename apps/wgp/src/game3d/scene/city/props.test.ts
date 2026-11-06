import { describe, expect, it } from "vitest";

import { chapterCity, CityIndex, generateCity } from "@wgp/game-core/sim3d";
import type { City, Prop } from "@wgp/game-core/sim3d/contract";
import type { Stop } from "@wgp/game-core/types";

import { footingBelow, citySolids } from "../camera/raycast";
import { buildCityLayout } from "./layout";
import { drawnProps } from "./props";

/** Nights with every kind of stop, Gwei Stacy's errand on a water tower among them. */
const STOPS: Stop[] = [
  { kind: "errand", ally: "gwei", errand: "groceries", district: "validator-heights" } as Stop,
  { kind: "fight", villain: "sandwich-man", district: "mempool-market", level: 1, boss: false, quest: false },
  { kind: "errand", ally: "aunt-mainnet", errand: "groceries", district: "queens-block" } as Stop,
  { kind: "fight", villain: "doc-octochain", district: "bridge-district", level: 2, boss: true, quest: false },
];
const cities: [string, City][] = [
  ...[7, 42, 1234, 9001, 31337, 777].map((s): [string, City] => [`generated ${s}`, generateCity(s, STOPS)]),
  ["case 001", chapterCity("case-001", 4242)],
];

type Box = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 - 0.5 && a.x1 > b.x0 + 0.5 && a.y0 < b.y1 - 0.5 && a.y1 > b.y0 + 0.5 && a.z0 < b.z1 - 0.5 && a.z1 > b.z0 + 0.5;
const unitBox = (p: Prop): Box => (p.kind === "vent" ? { x0: p.at.x - 10, y0: p.at.y, z0: p.at.z - 10, x1: p.at.x + 10, y1: p.at.y + 31, z1: p.at.z + 10 } : { x0: p.at.x - p.w / 2, y0: p.at.y, z0: p.at.z - p.d / 2, x1: p.at.x + p.w / 2, y1: p.at.y + p.h, z1: p.at.z + p.d / 2 });

describe.each(cities)("the props as drawn (%s)", (_, city) => {
  const drawn = drawnProps(city);

  it("draws every prop with an anchor, at the sim's place, its top where the sim's anchor is", () => {
    for (const p of city.props) {
      if (p.kind === "ac" || p.kind === "vent") continue;
      const d = drawn.find((x) => x.prop === p);
      if (p.kind === "antenna" && !d) continue; // merged into a taller mast its top lies on (next test)
      expect(d, `${p.kind} at ${p.at.x},${p.at.z}`).toBeDefined();
      expect(d!.prop.at.x).toBe(p.at.x);
      expect(d!.prop.at.z).toBe(p.at.z);
      expect(d!.y + d!.h).toBeCloseTo(Math.max(p.at.y + p.h, d!.y + 12), 5);
    }
  });

  it("leaves no web anchor of the sim's with nothing drawn within reach", () => {
    const layout = buildCityLayout(city);
    for (const a of new CityIndex(city).anchors) {
      let best = Infinity;
      for (const b of layout.boxes) {
        const hx = b.to ? 0 : (b.w * Math.abs(Math.cos(b.yaw)) + b.d * Math.abs(Math.sin(b.yaw))) / 2;
        const hz = b.to ? 0 : (b.w * Math.abs(Math.sin(b.yaw)) + b.d * Math.abs(Math.cos(b.yaw))) / 2;
        const x0 = b.to ? Math.min(b.x, b.to.x) - b.w / 2 : b.x - hx;
        const x1 = b.to ? Math.max(b.x, b.to.x) + b.w / 2 : b.x + hx;
        const z0 = b.to ? Math.min(b.z, b.to.z) - b.d / 2 : b.z - hz;
        const z1 = b.to ? Math.max(b.z, b.to.z) + b.d / 2 : b.z + hz;
        const y0 = b.to ? Math.min(b.y, b.to.y) : b.y;
        const y1 = b.to ? Math.max(b.y, b.to.y) + b.h : b.y + b.h;
        best = Math.min(best, Math.hypot(Math.max(x0 - a.at.x, 0, a.at.x - x1), Math.max(y0 - a.at.y, 0, a.at.y - y1), Math.max(z0 - a.at.z, 0, a.at.z - z1)));
      }
      for (const t of layout.tanks) best = Math.min(best, Math.hypot(Math.max(0, Math.hypot(a.at.x - t.x, a.at.z - t.z) - t.w * 0.58), Math.max(0, t.y - a.at.y, a.at.y - (t.y + t.h))));
      expect(best, `${a.kind} anchor at ${a.at.x},${a.at.y},${a.at.z}`).toBeLessThanOrEqual(10);
    }
  });

  it("stands no unit (an AC, a vent) in another prop, a building, a setback or another unit", () => {
    const solids: Box[] = city.buildings.flatMap((b) => [{ x0: b.x0, y0: 0, z0: b.z0, x1: b.x1, y1: b.h, z1: b.z1 }, ...(b.top ? [{ x0: b.top.x0, y0: b.h, z0: b.top.z0, x1: b.top.x1, y1: b.top.h, z1: b.top.z1 }] : [])]);
    const units = drawn.filter((d) => d.prop.kind === "ac" || d.prop.kind === "vent").map((d) => unitBox(d.prop));
    // A tower's legs, a billboard's board on its legs, a mast's foot block.
    const others = drawn
      .filter((d) => d.prop.kind === "water-tower" || d.prop.kind === "billboard" || (d.prop.kind === "antenna" && !d.bare))
      .map(({ prop: p, y, h }): Box => {
        if (p.kind === "water-tower") return { x0: p.at.x - 27.8, y0: y, z0: p.at.z - 27.8, x1: p.at.x + 27.8, y1: y + h, z1: p.at.z + 27.8 };
        if (p.kind === "billboard") {
          const [hw, hd] = p.facing & 1 ? [p.d / 2, p.w / 2] : [p.w / 2, p.d / 2];
          return { x0: p.at.x - hw, y0: y, z0: p.at.z - hd, x1: p.at.x + hw, y1: y + 34 + h, z1: p.at.z + hd };
        }
        return { x0: p.at.x - 9, y0: y, z0: p.at.z - 9, x1: p.at.x + 9, y1: y + 12, z1: p.at.z + 9 };
      });
    units.forEach((u, i) => {
      for (const o of others) expect(overlaps(u, o)).toBe(false);
      for (const s of solids) if (!(Math.abs(s.y1 - u.y0) < 0.5)) expect(overlaps(u, s)).toBe(false);
      for (let j = i + 1; j < units.length; j++) expect(overlaps(u, units[j])).toBe(false);
    });
  });

  it("raises a mast standing inside a setback onto the setback's roof", () => {
    for (const d of drawn) {
      if (d.prop.kind !== "antenna") continue;
      const b = city.buildings.find((x) => x.id === d.prop.buildingId);
      const t = b?.top;
      if (!t || !(d.prop.at.x > t.x0 && d.prop.at.x < t.x1 && d.prop.at.z > t.z0 && d.prop.at.z < t.z1)) continue;
      expect(d.y).toBeGreaterThanOrEqual(t.h - 0.5);
    }
  });
});

describe("Gwei Stacy's water tower", () => {
  it("has a flat lid where she stands (Zone.allyAt), not a cone's point", () => {
    let seen = 0;
    for (const [, city] of cities) {
      const z = city.zones.find((x) => x.ally === "gwei");
      if (!z?.allyAt) continue;
      const at = z.allyAt;
      const tank = buildCityLayout(city).tanks.find((t) => Math.hypot(t.x - at.x, t.z - at.z) < 1);
      expect(tank?.flat).toBe(true);
      // The lid (the cone pressed to the eave) is at her feet.
      expect(tank!.y + tank!.h * 0.8).toBeCloseTo(at.y, 3);
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("leaves every other water tower pointed", () => {
    for (const [, city] of cities) for (const t of buildCityLayout(city).tanks) if (!city.zones.some((z) => z.allyAt && Math.hypot(t.x - z.allyAt.x, t.z - z.allyAt.z) < 1)) expect(t.flat).toBe(false);
  });
});

describe("the roof a body stands on (footingBelow)", () => {
  const solids = citySolids({
    buildings: [
      { id: 0, x0: 0, z0: 0, x1: 200, z1: 200, h: 300, top: null },
      { id: 1, x0: 200, z0: 0, x1: 400, z1: 200, h: 200, top: null },
    ],
    props: [],
    bridge: null,
    bounds: { x0: -1000, z0: -1000, x1: 1000, z1: 1000 },
  } as unknown as City);
  const out = { top: 0, x0: 0, z0: 0, x1: 0, z1: 0 };

  it("is the roof under the centre when it's within reach below", () => {
    expect(footingBelow(solids, 100, 100, 326, 27.5, 30, out).top).toBe(300);
    expect(footingBelow(solids, 300, 100, 226, 27.5, 30, out).top).toBe(200);
  });

  it("is the edge a sphere rests on with its centre out over a drop, not the street or the roof below", () => {
    // Off the west edge (the street below) and off the east edge (the lower roof below).
    expect(footingBelow(solids, -15, 100, 321, 27.5, 30, out)).toMatchObject({ top: 300, x0: 0, x1: 200 });
    expect(footingBelow(solids, 215, 100, 321, 27.5, 30, out)).toMatchObject({ top: 300, x0: 0, x1: 200 });
  });

  it("is the street, unbounded, with nothing near", () => {
    expect(footingBelow(solids, -300, -300, 26, 27.5, 30, out)).toMatchObject({ top: 0, x0: -Infinity, x1: Infinity });
  });
});
