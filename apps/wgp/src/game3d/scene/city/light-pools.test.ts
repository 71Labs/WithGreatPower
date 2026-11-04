import { describe, expect, it } from "vitest";

import { KIND, type BoxSpec } from "./kinds";
import { poolSpecs } from "./light-pools";

const box = (over: Partial<BoxSpec>): BoxSpec => ({
  x: 0,
  y: 300,
  z: 0,
  w: 44,
  h: 40,
  d: 36,
  yaw: 0,
  color: [0.5, 0.5, 0.5],
  kind: KIND.solid,
  seed: 1,
  style: 0,
  hull: 0,
  ref: { x: 0, z: 0 },
  atlas: 0,
  sector: 0,
  lod: 0,
  ...over,
});

describe("roof light pools", () => {
  it("lays a warm pool on the roof in front of a roof door, whichever way it faces", () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const [pool] = poolSpecs([box({ kind: KIND.door, yaw })]);
      // On the deck (just above it), ahead of the door's +z face.
      expect(pool.y).toBeGreaterThan(300);
      expect(pool.y).toBeLessThan(302);
      const ahead = pool.x * Math.sin(yaw) + pool.z * Math.cos(yaw);
      expect(ahead).toBeGreaterThan(18 + pool.r / 2);
      // Warm: more red than blue.
      expect(pool.color[0]).toBeGreaterThan(pool.color[2]);
    }
  });

  it("puts a billboard's pool on the roof under its legs, and none under plain props", () => {
    const pools = poolSpecs([box({ kind: KIND.billboard, y: 334, w: 120, d: 6 }), box({ kind: KIND.solid }), box({ kind: KIND.ac })]);
    expect(pools).toHaveLength(1);
    expect(pools[0].y).toBeCloseTo(300.8);
    expect(pools[0].r).toBeLessThanOrEqual(78);
  });
});
