import { describe, expect, it } from "vitest";

import type { City, Vec3 } from "@wgp/game-core/sim3d/contract";

import { project } from "@/game3d/nav/waypoint";

import { TRAVEL_TUNING, TravelFraming, bearing, guardAcross, guardUpDown, halfWidth, portraitShare, sphereCast } from "./framing";
import { createLocalRaycast } from "./raycast";

/** One slab, x ∈ [−260, −200], z ∈ [−400, 400], 2000 tall. */
function wallCity(): City {
  return {
    seed: 1,
    bounds: { x0: -2000, z0: -2000, x1: 2000, z1: 2000 },
    buildings: [{ id: 0, x0: -260, z0: -400, x1: -200, z1: 400, h: 2000, top: null, district: "sector-7", tone: 0, accent: false, seed: 1 }],
    props: [],
    anchors: [],
    zones: [],
    river: null,
    bridge: null,
    start: { x: 0, y: 300, z: 0 },
  };
}

const cast = createLocalRaycast(wallCity());
/** A camera at `position` looking at `target`, for the screen checks. */
const pose = (position: Vec3, target: Vec3, fov = 55) => ({ position, target, fov });

describe("the sphere cast", () => {
  it("stops a radius short of a wall straight ahead", () => {
    expect(sphereCast(cast, { x: 0, y: 300, z: 0 }, { x: -1, y: 0, z: 0 }, 1000, 16)).toBeCloseTo(184, 0);
    expect(sphereCast(cast, { x: 0, y: 300, z: 0 }, { x: 1, y: 0, z: 0 }, 1000, 16)).toBeNull();
  });

  it("catches a corner the centre ray just misses", () => {
    // Along −x, 10 past the slab's end (z = 410): the centre ray misses, the ring brushes the corner.
    const hit = sphereCast(cast, { x: 0, y: 300, z: 410 }, { x: -1, y: 0, z: 0 }, 1000, 16);
    expect(hit).not.toBeNull();
    expect(hit!).toBeGreaterThan(150);
    expect(hit!).toBeLessThan(200);
  });

  it("ignores the wall the sphere already brushes when it runs along it (no folding onto the hero)", () => {
    // Beside the slab's face (x = −190, 10 off it), running along it in +z.
    expect(sphereCast(cast, { x: -190, y: 300, z: 0 }, { x: 0, y: 0, z: 1 }, 300, 16)).toBeNull();
  });
});

describe("the travel framing", () => {
  it("reads the screen: half width, portrait share, bearings", () => {
    // 55° tall at 16:9 is about 85.5° across.
    expect(halfWidth(55, 16 / 9)).toBeCloseTo(0.747, 2);
    expect((halfWidth(68.7, 390 / 844) * 180) / Math.PI).toBeLessThan(18);
    expect(portraitShare(16 / 9)).toBe(0);
    expect(portraitShare(390 / 844)).toBeCloseTo(0.98, 2);
    expect(bearing({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 })).toBeCloseTo(Math.PI / 2);
    expect(bearing({ x: 0, y: 0, z: 0 }, { x: 0, y: 50, z: 0 })).toBeNull();
  });

  it("pulls a pivot that lags into a wall back out to the hero's side", () => {
    const f = new TravelFraming();
    const hero = { x: -180, y: 300, z: 0 };
    // The pivot lags 60 into the slab.
    const pivot = { x: -240, y: 340, z: 0 };
    f.clearPivot(cast, hero, pivot);
    expect(pivot.x).toBeGreaterThan(-200);
    // Clear: untouched.
    const free = { x: 100, y: 340, z: 0 };
    f.clearPivot(cast, { x: 0, y: 300, z: 0 }, free);
    expect(free).toEqual({ x: 100, y: 340, z: 0 });
  });

  it("shortens the arm before a wall, but never under the floor", () => {
    const f = new TravelFraming();
    const still = { x: 0, y: 0, z: 0 };
    // The slab 200 behind: the arm stops the pad short of it.
    expect(f.collide(cast, { x: 0, y: 300, z: 0 }, { x: -1, y: 0, z: 0 }, 420, still, 24)).toBeCloseTo(176, 0);
    // 60 behind: the floor holds (the city shader fades the wall instead).
    expect(f.collide(cast, { x: -140, y: 300, z: 0 }, { x: -1, y: 0, z: 0 }, 420, still, 24)).toBe(TRAVEL_TUNING.minArm);
    // Moving toward the wall: the prediction eases in early.
    const now = f.collide(cast, { x: 200, y: 300, z: 0 }, { x: -1, y: 0, z: 0 }, 420, still, 24);
    const moving = f.collide(cast, { x: 200, y: 300, z: 0 }, { x: -1, y: 0, z: 0 }, 420, { x: -1200, y: 0, z: 0 }, 24);
    expect(moving).toBeLessThanOrEqual(now);
  });

  it("guards the hero inside the frame across: untouched in the middle, never past the hard edge", () => {
    const w = 390;
    const h = 844;
    const aspect = w / h;
    const fov = 69;
    const cam = { x: 0, y: 400, z: -400 };
    // In the middle: nothing moves.
    const centred = { x: 20, y: 400, z: 0 };
    expect(guardAcross(cam, { x: 0, y: 400, z: 0 }, centred, fov, aspect)).toBe(0);
    // Far off to the side on a phone: eased back, inside the hard edge.
    for (const off of [120, 300, 2000]) {
      const target = { x: 0, y: 400, z: 0 };
      const hero = { x: -off, y: 400, z: 0 };
      guardAcross(cam, target, hero, fov, aspect);
      const p = project(hero, pose(cam, target, fov), w, h);
      // NDC across is the share of the half width.
      expect(Math.abs((p.x / w) * 2 - 1)).toBeLessThan(TRAVEL_TUNING.guardHardPortrait + 0.01);
    }
  });

  it("guards the hero up and down: a phone keeps him off the power arc", () => {
    const w = 390;
    const h = 844;
    const fov = 69;
    const cam = { x: 0, y: 600, z: -400 };
    // The hero far below the view.
    const target = { x: 0, y: 600, z: 0 };
    const hero = { x: 0, y: 250, z: 0 };
    guardUpDown(cam, target, hero, fov, w / h);
    const p = project(hero, pose(cam, target, fov), w, h);
    const y = 1 - (p.y / h) * 2;
    expect(y).toBeGreaterThan(TRAVEL_TUNING.guardLowPortrait[1] - 0.01);
    expect(y).toBeLessThan(TRAVEL_TUNING.guardLowPortrait[0]);
    // Inside the band: nothing moves.
    const t2 = { x: 0, y: 380, z: 0 };
    guardUpDown(cam, t2, { x: 0, y: 380, z: 0 }, fov, w / h);
    expect(t2.y).toBe(380);
  });
});
