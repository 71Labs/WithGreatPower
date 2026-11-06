import { describe, expect, it } from "vitest";

import type { City } from "@wgp/game-core/sim3d/contract";

import { citySolids } from "../camera/raycast";
import { wrapStrand } from "./web-wrap";

/** A main building (x, z in [0, 200], 300 tall) with a setback on it ([60, 140], up to 420). */
const solids = citySolids({
  buildings: [{ id: 0, x0: 0, z0: 0, x1: 200, z1: 200, h: 300, top: { x0: 60, z0: 60, x1: 140, z1: 140, h: 420 }, district: "sector-7", tone: 0, accent: false, seed: 1 }],
  props: [],
  bridge: null,
  bounds: { x0: -1000, z0: -1000, x1: 1000, z1: 1000 },
} as unknown as City);

/** How much of the strand's segments lie inside the building (past 3 units from every bend). */
function inside(points: Float32Array, n: number): number {
  let total = 0;
  for (let k = 0; k < n - 1; k++) {
    const a = [points[k * 3], points[k * 3 + 1], points[k * 3 + 2]];
    const b = [points[k * 3 + 3], points[k * 3 + 4], points[k * 3 + 5]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    for (let s = 3; s < L - 3; s += 0.5) {
      const t = s / L;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      const inMain = x > 0 && x < 200 && z > 0 && z < 200 && y < 300;
      const inTop = x > 60 && x < 140 && z > 60 && z < 140 && y > 300 && y < 420;
      if (inMain || inTop) total += 0.5;
    }
  }
  return total;
}

const strand = (...xyz: number[]) => {
  const p = new Float32Array(16 * 3);
  p.set(xyz);
  return p;
};

describe("the web strand drawn over the edge it would cut through", () => {
  it("leaves a clear strand straight", () => {
    const p = strand(-100, 250, 100, -10, 320, 100);
    expect(wrapStrand(solids, p, 2)).toBe(2);
  });

  it("bends a strand to a setback's edge over the roof below it, ending on the sim's anchor", () => {
    // From below the main roof, outside, up to the setback's roof edge (inset from the facade).
    const p = strand(-30, 100, 100, 60, 420, 100);
    expect(inside(p, 2)).toBeGreaterThan(20);
    const n = wrapStrand(solids, p, 2);
    expect(n).toBe(3);
    expect(inside(p, n)).toBe(0);
    expect([p[(n - 1) * 3], p[(n - 1) * 3 + 1], p[(n - 1) * 3 + 2]]).toEqual([60, 420, 100]);
    // The bend sits on the main roof's rim at x = 0.
    expect(Math.abs(p[3])).toBeLessThan(1);
    expect(p[4]).toBeGreaterThan(299);
  });

  it("goes round a building's corners when he's swung round its far side", () => {
    // An anchor on the west face, the hero off the east side near the north corner.
    const p = strand(230, 150, 190, -0.5, 250, 60);
    const n = wrapStrand(solids, p, 2);
    expect(n).toBeGreaterThan(2);
    expect(inside(p, n)).toBe(0);
    expect([p[(n - 1) * 3], p[(n - 1) * 3 + 1], p[(n - 1) * 3 + 2]]).toEqual([-0.5, 250, 60]);
  });
});
