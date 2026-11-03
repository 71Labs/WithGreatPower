import { describe, expect, it } from "vitest";

import type { City, Zone } from "@wgp/game-core/sim3d/contract";

import { ComboClock, multiplierText } from "./combo";
import { clampToDisc, compass, fitCity, headingUpRotation, mapAngle, metres, remainingRoute, routeDirAt, routeLine, stopPoint, toMap, type MapView } from "./map";

const zone = (index: number, kind: Zone["kind"], x: number, z: number, allyAt?: { x: number; y: number; z: number }): Zone => ({
  index,
  kind,
  district: "sector-7",
  center: { x, y: 300, z },
  bounds: { x0: x - 300, z0: z - 300, x1: x + 300, z1: z + 300, h: 300 },
  villain: kind === "fight" ? "gas-goblin" : null,
  ally: kind === "errand" ? "aunt-mainnet" : null,
  allyAt: allyAt ?? null,
});

const CITY = {
  seed: 1,
  bounds: { x0: -180, z0: -180, x1: 7020, z1: 7020 },
  buildings: [],
  props: [],
  anchors: [],
  zones: [zone(0, "fight", 1000, 1000), zone(1, "errand", 3000, 1000, { x: 3100, y: 420, z: 900 }), zone(2, "fight", 3000, 5000)],
  river: null,
  bridge: null,
  start: { x: 500, y: 200, z: 500 },
} satisfies City;

const view = (over: Partial<MapView> = {}): MapView => ({ x: 0, z: 0, scale: 0.1, rotation: 0, cx: 80, cy: 80, ...over });

describe("map projection", () => {
  it("puts north up and east right when not turned", () => {
    const v = view();
    expect(toMap(v, 0, 0)).toEqual({ x: 80, y: 80 });
    // 100 units east → 10 px right; 100 units north (−z) → 10 px up.
    expect(toMap(v, 100, 0)).toEqual({ x: 90, y: 80 });
    const n = toMap(v, 0, -100);
    expect(n.x).toBeCloseTo(80, 9);
    expect(n.y).toBeCloseTo(70, 9);
  });

  it("turns the camera's forward to the top of a heading-up map", () => {
    for (const [fx, fz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [Math.SQRT1_2, -Math.SQRT1_2],
      [0.3, 0.954],
    ]) {
      const v = view({ rotation: headingUpRotation(fx, fz) });
      // A point straight ahead of the camera lands straight above the centre.
      const p = toMap(v, fx * 500, fz * 500);
      expect(p.x).toBeCloseTo(80, 6);
      expect(p.y).toBeLessThan(80);
      // And an arrow along the forward points up the screen (−π/2).
      const a = mapAngle(v, fx, fz);
      expect(Math.cos(a)).toBeCloseTo(0, 6);
      expect(Math.sin(a)).toBeCloseTo(-1, 6);
    }
    expect(headingUpRotation(0, -1)).toBeCloseTo(0, 12);
    expect(headingUpRotation(0, 0)).toBe(0);
  });

  it("keeps right on the right after turning (no mirror)", () => {
    // Facing east: south (+z) is to the right of the camera.
    const v = view({ rotation: headingUpRotation(1, 0) });
    const p = toMap(v, 0, 200);
    expect(p.x).toBeGreaterThan(80);
    expect(p.y).toBeCloseTo(80, 6);
  });

  it("clamps far points onto the rim along their bearing", () => {
    expect(clampToDisc(90, 80, 80, 80, 50)).toMatchObject({ x: 90, y: 80, clamped: false });
    const c = clampToDisc(80 + 300, 80 + 400, 80, 80, 50);
    expect(c.clamped).toBe(true);
    expect(Math.hypot(c.x - 80, c.y - 80)).toBeCloseTo(50, 9);
    expect(c.x - 80).toBeCloseTo(30, 9);
    expect(c.y - 80).toBeCloseTo(40, 9);
  });

  it("fits the whole city with padding, centred", () => {
    const v = fitCity(CITY.bounds, 400, 300, 10);
    // The tighter side (300 − 20 over 7,200 units) sets the scale.
    expect(v.scale).toBeCloseTo(280 / 7200, 9);
    const a = toMap(v, CITY.bounds.x0, CITY.bounds.z0);
    const b = toMap(v, CITY.bounds.x1, CITY.bounds.z1);
    expect(a.y).toBeCloseTo(10, 6);
    expect(b.y).toBeCloseTo(290, 6);
    expect((a.x + b.x) / 2).toBeCloseTo(200, 6);
  });
});

describe("the route", () => {
  it("heads for the ally on errands and the arena centre in fights", () => {
    expect(stopPoint(CITY.zones[0])).toEqual({ x: 1000, y: 300, z: 1000 });
    expect(stopPoint(CITY.zones[1])).toEqual({ x: 3100, y: 420, z: 900 });
  });

  it("falls back to the city's zones from the current stop without a v1.3 route", () => {
    expect(remainingRoute(CITY, { stop: 1 }).map((p) => p.x)).toEqual([3100, 3000]);
    expect(remainingRoute(CITY, { stop: 3 })).toEqual([]);
    const route = [{ x: 1, y: 2, z: 3 }];
    expect(remainingRoute(CITY, { stop: 0, route })).toBe(route);
  });

  it("starts the ring line at the last stop, or the start", () => {
    expect(routeLine(CITY, { stop: 0 })[0]).toBe(CITY.start);
    expect(routeLine(CITY, { stop: 2 })[0]).toEqual({ x: 3100, y: 420, z: 900 });
  });

  it("faces a ring along the nearest leg", () => {
    const line = [
      { x: 0, z: 0 },
      { x: 1000, z: 0 },
      { x: 1000, z: 1000 },
    ];
    expect(routeDirAt({ x: 400, z: 30 }, line)).toEqual({ x: 1, z: 0 });
    expect(routeDirAt({ x: 980, z: 600 }, line)).toEqual({ x: 0, z: 1 });
    const one = routeDirAt({ x: 0, z: 0 }, [{ x: 0, z: -50 }]);
    expect(one.x).toBeCloseTo(0, 9);
    expect(one.z).toBeCloseTo(-1, 9);
  });
});

describe("distances and words", () => {
  it("reads units as metres, in fives past 100", () => {
    expect(metres(0)).toBe(0);
    expect(metres(40)).toBe(1);
    expect(metres(1990)).toBe(50);
    expect(metres(4100)).toBe(105);
    expect(metres(4140)).toBe(105);
    expect(metres(-5)).toBe(0);
  });

  it("names compass directions with north as −z", () => {
    expect(compass(0, -10)).toBe("north");
    expect(compass(10, 0)).toBe("east");
    expect(compass(0, 10)).toBe("south");
    expect(compass(-10, -10)).toBe("north-west");
    expect(compass(0, 0)).toBe("here");
  });

  it("drains the combo timer over the window it started with, and refills on a rise", () => {
    const c = new ComboClock();
    expect(c.share(0, 0)).toBe(0);
    expect(c.share(3, 200)).toBe(1);
    expect(c.share(3, 100)).toBeCloseTo(0.5, 9);
    expect(c.share(4, 180)).toBe(1);
    expect(c.share(4, 45)).toBeCloseTo(0.25, 9);
    expect(multiplierText(2)).toBe("×2");
    expect(multiplierText(1.5)).toBe("×1.5");
  });
});
