import { describe, expect, it } from "vitest";

import { animInterval, CROWD_TIERS, distanceFade, fogFor, heroFade, lineFade, REACT_IN, REACT_OUT, splitBands, wantsReaction } from "./lod";

describe("crowd tiers", () => {
  it("draw fewest on low, most on high, and load full bodies on high only", () => {
    const { low, medium, high } = CROWD_TIERS;
    expect(low.max).toBeLessThan(medium.max);
    expect(medium.max).toBeLessThan(high.max);
    expect(low.density.walkers).toBe(0);
    expect(low.near || medium.near).toBe(false);
    expect(high.near).toBe(true);
    expect(high.nearMax).toBeLessThan(high.max);
    for (const t of [low, medium, high]) expect(t.farDist).toBeGreaterThan(t.nearDist);
  });
});

describe("animation level of detail", () => {
  it("refreshes poses less often further from the camera", () => {
    expect(animInterval(300)).toBeCloseTo(1 / 30);
    expect(animInterval(1200)).toBeCloseTo(1 / 15);
    expect(animInterval(2400)).toBeCloseTo(1 / 8);
    for (let d = 0; d < 3000; d += 100) expect(animInterval(d + 100)).toBeGreaterThanOrEqual(animInterval(d));
  });
});

describe("splitting the drawn crowd", () => {
  const dist = [100, 200, 300, 900, 1000, 1100, 1200];
  const order = [0, 1, 2, 3, 4, 5, 6];

  it("gives the nearest the full bodies, up to the cap, and the rest the light ones", () => {
    const near: number[] = [];
    const far: number[] = [];
    splitBands(order, dist, { nearMax: 2, max: 5, nearDist: 720 }, near, far);
    expect(near).toEqual([0, 1]);
    expect(far).toEqual([2, 3, 4]);
  });

  it("puts everyone in the light bodies when there are no full ones", () => {
    const near: number[] = [];
    const far: number[] = [];
    splitBands(order, dist, { nearMax: 0, max: 10, nearDist: 720 }, near, far);
    expect(near).toEqual([]);
    expect(far).toEqual(order);
  });
});

describe("fades", () => {
  it("hide people right in front of the camera and fade them in at the draw distance", () => {
    expect(distanceFade(40, 2000)).toBe(1);
    expect(distanceFade(600, 2000)).toBe(0);
    expect(distanceFade(2000, 2000)).toBe(1);
    expect(distanceFade(1800, 2000)).toBeGreaterThan(0);
    expect(distanceFade(1800, 2000)).toBeLessThan(1);
  });

  it("hide whoever the hero lands among, not those above or below him", () => {
    expect(heroFade(10, 0)).toBe(1);
    expect(heroFade(200, 0)).toBe(0);
    expect(heroFade(10, 400)).toBe(0);
  });

  it("fade people standing between the camera and the hero, not those beside the line", () => {
    // Camera at the origin, hero 600 along +z.
    expect(lineFade(0, 0, 300, 0, 0, 0, 0, 0, 600)).toBeGreaterThan(0.8);
    expect(lineFade(200, 0, 300, 0, 0, 0, 0, 0, 600)).toBe(0);
    // Behind the hero or behind the camera: no fade.
    expect(lineFade(0, 0, 700, 0, 0, 0, 0, 0, 600)).toBe(0);
    expect(lineFade(0, 0, -100, 0, 0, 0, 0, 0, 600)).toBe(0);
  });

  it("fog people like the cast, half the city's", () => {
    expect(fogFor(100)).toBe(0);
    expect(fogFor(5000)).toBeGreaterThan(fogFor(2000));
    expect(fogFor(5000)).toBeLessThanOrEqual(0.5);
  });
});

describe("reactions", () => {
  it("start close and stop only once the hero's well gone (hysteresis)", () => {
    expect(wantsReaction(false, REACT_IN - 1)).toBe(true);
    expect(wantsReaction(false, REACT_IN + 1)).toBe(false);
    expect(wantsReaction(true, (REACT_IN + REACT_OUT) / 2)).toBe(true);
    expect(wantsReaction(true, REACT_OUT + 1)).toBe(false);
  });
});
