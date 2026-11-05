import { describe, expect, it } from "vitest";

import type { City, Prop } from "@wgp/game-core/sim3d/contract";

import { citySolids, surfaceBelow } from "../camera/raycast";
import { billboardAt, cluePlacement } from "./clues";

/** One roof 600 × 400 at y 300, a lower one beside it, and whatever props the test puts up. */
function roofCity(props: Prop[]): City {
  const b = (id: number, x0: number, z0: number, x1: number, z1: number, h: number) => ({ id, x0, z0, x1, z1, h, top: null, district: "bridge-district" as const, tone: 0, accent: false, seed: id });
  return {
    seed: 1,
    bounds: { x0: -2000, z0: -2000, x1: 2000, z1: 2000 },
    buildings: [b(0, -300, -200, 300, 200, 300), b(1, 400, -200, 900, 200, 120)],
    props,
    anchors: [],
    zones: [],
    river: null,
    bridge: null,
    start: { x: 0, y: 300, z: 1500 },
  };
}

const tower = (x: number, z: number): Prop => ({ kind: "water-tower", at: { x, y: 300, z }, facing: 0, w: 70, h: 120, d: 70, buildingId: 0 });

describe("where a clue's prop stands", () => {
  it("stays on the clue's point when the roof there is clear, facing the night's start", () => {
    const city = roofCity([]);
    const p = cluePlacement(city, citySolids(city), "tabs", { x: 0, y: 300, z: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(0);
    expect(p.floor).toBeCloseTo(300);
    // The start is at +z: facing it is yaw 0.
    expect(Math.abs(Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw)))).toBeLessThan(0.01);
  });

  it("steps clear of a water tower on the same roof, staying on it and near the clue", () => {
    const city = roofCity([tower(60, 0)]);
    const solids = citySolids(city);
    const p = cluePlacement(city, solids, "cursor", { x: 0, y: 300, z: 0 });
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(110 + 1e-6);
    // Clear of the tower's footprint by the billboard's room.
    const gap = (x: number, z: number) => Math.hypot(Math.max(0, Math.abs(x - 60) - 35), Math.max(0, Math.abs(z) - 35));
    expect(gap(p.x, p.z)).toBeGreaterThanOrEqual(95 - 1e-6);
    expect(surfaceBelow(solids, p.x, p.z, 310)).toBeCloseTo(300);
  });

  it("takes the clearest spot in reach when none is clear enough", () => {
    const city = roofCity([tower(0, 0)]);
    const p = cluePlacement(city, citySolids(city), "cursor", { x: 0, y: 300, z: 0 });
    const gap = Math.hypot(Math.max(0, Math.abs(p.x) - 35), Math.max(0, Math.abs(p.z) - 35));
    expect(gap).toBeGreaterThan(40);
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(110 + 1e-6);
  });

  it("finds the city billboard the cursor clue stands under, and only that one", () => {
    const board: Prop = { kind: "billboard", at: { x: 40, y: 300, z: -20 }, facing: 1, w: 120, h: 50, d: 6, text: "GAS 400% OFF", buildingId: 0 };
    const city = roofCity([tower(-150, 0), board]);
    expect(billboardAt(city, { x: 40, y: 300, z: -20 })).toBe(board);
    expect(billboardAt(city, { x: 0, y: 300, z: 0 })).toBeNull();
    expect(billboardAt(city, { x: -150, y: 300, z: 0 })).toBeNull();
  });

  it("turns to the side with open roof in front when the start's side is blocked", () => {
    // The clue near the roof's +z edge: facing +z (the start) there's no roof to walk up on.
    const city = roofCity([]);
    const p = cluePlacement(city, citySolids(city), "tabs", { x: 0, y: 300, z: 170 });
    const fz = Math.cos(p.yaw);
    expect(fz).toBeLessThan(0.5);
  });
});
