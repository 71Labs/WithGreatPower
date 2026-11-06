/**
 * Free roam's City (roam-2): what the scene draws in the hero's way is what the sim has solid.
 * Every box the City's layout draws (props, lamps, signals, roof doors, the bridge's rails and
 * parts, cranes) lies inside the sim's solids (within a few units of trim), every water tank's
 * drum too; and every solid the sim has is drawn (no invisible walls). Plus: the City's cars come
 * from the sim, so its decorative traffic is off.
 */
import { describe, expect, it } from "vitest";

import { CityIndex } from "@wgp/game-core/sim3d";
import { furnitureSolids, isRoamCity, roamCity, roamCityFurniture, type SolidBox } from "@wgp/game-core/sim3d/roam";

import { buildCityLayout, KIND, type BoxSpec } from "./layout";

const city = roamCity();
const furniture = roamCityFurniture();
const layout = buildCityLayout(city, { roam: furniture });
/** The sim's solids: the city's own boxes (buildings, tiers, the bridge) and the furniture. */
const grid = new CityIndex(city);
const solids: SolidBox[] = [...grid.boxes.map((b) => ({ x0: b.x0, y0: b.y0, z0: b.z0, x1: b.x1, y1: b.y1, z1: b.z1 })), ...furnitureSolids(furniture)];
/** Trim the eye takes as the surface (a cornice's lip, a cap's overhang, an outline). */
const TOL = 6;

const ids: number[] = [];
const index = new CityIndex(city);
for (const s of furnitureSolids(furniture)) index.addSolid(s.x0, s.y0, s.z0, s.x1, s.y1, s.z1);

/** Whether a point is inside some solid (grown by TOL). */
function solidAt(x: number, y: number, z: number): boolean {
  const n = index.queryBoxes(x - TOL, z - TOL, x + TOL, z + TOL, ids);
  for (let k = 0; k < n; k++) {
    const b = index.boxes[ids[k]];
    if (x >= b.x0 - TOL && x <= b.x1 + TOL && y >= b.y0 - TOL && y <= b.y1 + TOL && z >= b.z0 - TOL && z <= b.z1 + TOL) return true;
  }
  return y < 0.5;
}

/** A drawn box's corners and middle, turned by its yaw (quarter turns in the City). */
function samples(b: BoxSpec): [number, number, number][] {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const out: [number, number, number][] = [];
  for (const u of [-0.5, 0, 0.5])
    for (const v of [0, 0.5, 1])
      for (const w of [-0.5, 0, 0.5]) {
        const lx = u * b.w;
        const lz = w * b.d;
        out.push([b.x + lx * c + lz * s, b.y + v * b.h, b.z - lx * s + lz * c]);
      }
  return out;
}

describe("free roam's City: drawn as the sim has it", () => {
  it("is the roam city, and draws its furniture from the sim's list", () => {
    expect(isRoamCity(city)).toBe(true);
    expect(layout.boxes.some((b) => b.kind === KIND.lamp)).toBe(true);
    expect(layout.boxes.some((b) => b.kind === KIND.door)).toBe(true);
    expect(layout.boxes.some((b) => b.kind === KIND.signal)).toBe(true);
    // No fire escapes or 6-unit parapets in the City (they can't be solid).
    expect(layout.boxes.some((b) => b.kind === KIND.grate)).toBe(false);
  });

  it("draws nothing he could pass through: every drawn box is inside the sim's solids", () => {
    const loose: string[] = [];
    for (const b of layout.boxes) {
      // Cables, wires and a crane's pendant lines (sloped segments) are lines to web, not barriers.
      if (b.to) continue;
      for (const [x, y, z] of samples(b)) {
        if (!solidAt(x, y, z)) {
          loose.push(`kind ${b.kind} at ${x.toFixed(0)},${y.toFixed(0)},${z.toFixed(0)} (${b.w.toFixed(0)}×${b.h.toFixed(0)}×${b.d.toFixed(0)})`);
          break;
        }
      }
    }
    const byKind = new Map<string, number>();
    for (const l of loose) byKind.set(l.split(" at ")[0] + " " + l.split("(")[1], (byKind.get(l.split(" at ")[0] + " " + l.split("(")[1]) ?? 0) + 1);
    expect([...byKind.entries()].slice(0, 20), `${loose.length} drawn boxes stand outside every solid: ${loose.slice(0, 6).join("; ")}`).toEqual([]);
  });

  it("draws every water tank's drum inside the sim's tank", () => {
    expect(layout.tanks.length).toBeGreaterThan(10);
    for (const t of layout.tanks) {
      expect(t.flat).toBe(true);
      const r = t.w / 2 - 2;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        for (const y of [t.y + 2, t.y + t.h * 0.5, t.y + t.h * 0.75]) expect(solidAt(t.x + Math.sin(a) * r, y, t.z + Math.cos(a) * r)).toBe(true);
      }
    }
  });

  it("has no invisible walls: every furniture solid has something drawn there", () => {
    const drawn = layout.boxes.filter((b) => !b.to);
    const near = (s: SolidBox) =>
      drawn.some((b) => {
        const hw = (Math.abs(Math.cos(b.yaw)) * b.w + Math.abs(Math.sin(b.yaw)) * b.d) / 2;
        const hd = (Math.abs(Math.sin(b.yaw)) * b.w + Math.abs(Math.cos(b.yaw)) * b.d) / 2;
        return b.x - hw < s.x1 && b.x + hw > s.x0 && b.z - hd < s.z1 && b.z + hd > s.z0 && b.y < s.y1 && b.y + b.h > s.y0;
      }) || layout.tanks.some((t) => Math.abs(t.x - (s.x0 + s.x1) / 2) < 1 && Math.abs(t.z - (s.z0 + s.z1) / 2) < 1);
    const bare = furnitureSolids(furniture).filter((s) => !near(s));
    expect(bare.slice(0, 8)).toEqual([]);
  });

  it("is the sim's own solids, box for box", () => {
    expect(solids.length).toBe(grid.boxes.length + furnitureSolids(furniture).length);
  });
});
