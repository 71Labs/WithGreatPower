import { describe, expect, it } from "vitest";

import { BURST_SECONDS, burnTrail, heatColour, MAX_SWING, NEEDLE_SWEEP, needleAngle, puffAt, PUFF_LIFE, spikeBurst, spikeRing, stallSpot, swingTilt, yawToward } from "./math";

describe("the fee meter's needle and glow", () => {
  it("sweeps from cool on the left to MAX on the right, and trembles only when pegged", () => {
    expect(needleAngle(0, 0, false)).toBeCloseTo(-NEEDLE_SWEEP, 6);
    expect(needleAngle(0.5, 0, false)).toBeCloseTo(0, 6);
    expect(needleAngle(1, 0, true)).toBeCloseTo(NEEDLE_SWEEP, 6);
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 2; t += 0.01) {
      const a = needleAngle(1, t, false);
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
      expect(a).toBeLessThanOrEqual(NEEDLE_SWEEP + 0.031);
    }
    expect(hi - lo).toBeGreaterThan(0.02);
    // Held still: no tremble.
    expect(needleAngle(1, 0.3, true)).toBe(needleAngle(1, 1.7, true));
    // Below the peg: none either.
    expect(needleAngle(0.6, 0.3, false)).toBe(needleAngle(0.6, 1.7, false));
  });

  it("glows green when cool, amber halfway and red when hot", () => {
    const [r0, g0] = heatColour(0);
    expect(g0).toBeGreaterThan(r0);
    const [r1, g1, b1] = heatColour(1);
    expect(r1).toBeGreaterThan(0.9);
    expect(g1).toBeLessThan(0.4);
    expect(b1).toBeLessThan(0.4);
    const mid = heatColour(0.5);
    expect(mid[0]).toBeGreaterThan(0.9);
    expect(mid[1]).toBeGreaterThan(0.6);
  });
});

describe("the meter under his glider", () => {
  it("trails his flight, never past MAX_SWING, and hangs straight when still", () => {
    expect(swingTilt({ x: 0, y: 0, z: 0 }, false)).toEqual({ x: -0, z: 0 });
    const fast = swingTilt({ x: 4000, y: 0, z: -4000 }, false);
    expect(Math.abs(fast.x)).toBeLessThanOrEqual(MAX_SWING);
    expect(Math.abs(fast.z)).toBeLessThanOrEqual(MAX_SWING);
    expect(swingTilt({ x: 500, y: 0, z: 0 }, false).z).toBeGreaterThan(0);
    expect(swingTilt({ x: 500, y: 0, z: 300 }, true)).toEqual({ x: 0, z: 0 });
    expect(swingTilt(undefined, false)).toEqual({ x: 0, z: 0 });
  });
});

describe("the burn's trail", () => {
  it("leads off toward the meter, each scorch smaller, stopping short of it", () => {
    const from = { x: 0, y: 300, z: 0 };
    const to = { x: 1000, y: 280, z: 0 };
    const trail = burnTrail(from, to, 6);
    expect(trail).toHaveLength(6);
    for (let i = 0; i < trail.length; i++) {
      expect(trail[i].x).toBeGreaterThan(0);
      expect(Math.abs(trail[i].z)).toBeLessThan(25);
      if (i > 0) {
        expect(trail[i].x).toBeGreaterThan(trail[i - 1].x);
        expect(trail[i].size).toBeLessThanOrEqual(trail[i - 1].size);
      }
    }
    // A meter close by: only the scorches that fit before it.
    expect(burnTrail(from, { x: 200, y: 0, z: 0 }, 6).length).toBeLessThan(3);
    expect(burnTrail(from, from, 6)).toEqual([]);
  });
});

describe("the fee spike", () => {
  it("fills its ring through the wind-up, and bursts out and fades", () => {
    expect(spikeRing(0, 0, false).alpha).toBe(0);
    expect(spikeRing(0.5, 0, true).fill).toBe(0.5);
    expect(spikeRing(1, 0, true).alpha).toBeGreaterThan(spikeRing(0.3, 0, true).alpha);
    expect(spikeBurst(-0.1).alpha).toBe(0);
    expect(spikeBurst(0).alpha).toBe(1);
    expect(spikeBurst(BURST_SECONDS * 0.5).scale).toBeGreaterThan(spikeBurst(0).scale);
    expect(spikeBurst(BURST_SECONDS).alpha).toBe(0);
  });
});

describe("puffs", () => {
  it("rise and grow, fading in and out over their life; held still, they barely rise", () => {
    const a = puffAt(0, 20, false);
    const b = puffAt(PUFF_LIFE * 0.5, 20, false);
    expect(a.alpha).toBe(0);
    expect(b.rise).toBeGreaterThan(a.rise);
    expect(b.size).toBeGreaterThan(a.size);
    expect(puffAt(PUFF_LIFE, 20, false).alpha).toBeCloseTo(0, 6);
    expect(puffAt(PUFF_LIFE * 0.5, 20, true).rise).toBeLessThan(b.rise);
  });
});

describe("placing the stalls", () => {
  it("faces things the right way and only stands a stall where its footprint is all roof", () => {
    expect(yawToward(0, 0, 0, 10)).toBeCloseTo(0, 6);
    expect(yawToward(0, 0, 10, 0)).toBeCloseTo(Math.PI / 2, 6);
    const at = { x: 0, y: 300, z: 0 };
    const spot = stallSpot(at, 3, 78, 34, (x, z) => Math.abs(x) < 200 && Math.abs(z) < 200);
    expect(spot).not.toBeNull();
    expect(Math.hypot(spot!.x, spot!.z)).toBeCloseTo(78, 6);
    // A roof too small for one: no stall.
    expect(stallSpot(at, 3, 78, 34, (x, z) => Math.abs(x) < 40 && Math.abs(z) < 40)).toBeNull();
  });
});
