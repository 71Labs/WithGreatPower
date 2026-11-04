import { describe, expect, it } from "vitest";

import type { City } from "@wgp/game-core/sim3d/contract";

import { TRAVEL_TUNING, TravelFraming, bearing, halfWidth, portraitShare, sphereCast } from "./framing";
import { createLocalRaycast } from "./raycast";
import { Smoothed, SmoothedVec3 } from "./springs";

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
    // The slab 200 behind: the arm stops the pad short of it.
    expect(f.collide(cast, { x: 0, y: 300, z: 0 }, { x: -1, y: 0, z: 0 }, 420, 24)).toBeCloseTo(176, 0);
    // 60 behind: the floor holds (the city shader fades the wall instead).
    expect(f.collide(cast, { x: -140, y: 300, z: 0 }, { x: -1, y: 0, z: 0 }, 420, 24)).toBe(TRAVEL_TUNING.minArm);
    // Clear: the whole reach.
    expect(f.collide(cast, { x: 0, y: 300, z: 0 }, { x: 1, y: 0, z: 0 }, 420, 24)).toBe(420);
  });

  it("changes the arm's length no faster than its rate, smoothly, and leaves small changes alone", () => {
    const f = new TravelFraming();
    const dt = 1 / 60;
    const most = TRAVEL_TUNING.armRate * dt;
    const arm = new Smoothed(400);
    // A wall cuts the arm from 400 to 150 in one frame.
    arm.value = 150;
    arm.velocity = -9000;
    f.capArm(arm, 400, dt);
    expect(400 - arm.value).toBeLessThanOrEqual(most);
    expect(400 - arm.value).toBeGreaterThan(most * 0.9);
    // The spring's velocity matches the capped step (no overshoot after).
    expect(arm.velocity).toBeCloseTo((arm.value - 400) / dt, 6);
    // A small step goes through untouched.
    const small = new Smoothed(400);
    small.value = 398;
    small.velocity = -120;
    f.capArm(small, 400, dt);
    expect(small.value).toBe(398);
    expect(small.velocity).toBe(-120);
  });

  it("climbs for room in a tight spot, and starts from nothing again after the plain chase", () => {
    // A low slab right behind, its top just above the pivot: no room straight back, room over the top.
    const low = createLocalRaycast({ ...wallCity(), buildings: [{ ...wallCity().buildings[0], h: 355 }] });
    const f = new TravelFraming();
    const pivot = { x: -150, y: 340, z: 0 };
    let climb = 0;
    // Looking along +x (yaw π/2), the arm points back along −x into the slab.
    for (let t = 0; t < 2; t += 1 / 60) climb = f.climbFor(low, pivot, Math.PI / 2, 0.2, 420, 24, 1 / 60);
    expect(climb).toBeGreaterThan(0.1);
    // A fight's end: the plain chase, then the shots again somewhere open.
    f.plain(0, { dist: 420, pitch: 0.2, deadZone: 0.35, settle: 0.07, yawTime: 0.45, maxRate: Math.PI / 2, fov: 55, pivotLift: 0.086, frameLift: 0.12 });
    expect(f.climbFor(null, pivot, Math.PI / 2, 0.2, 420, 24, 1 / 60)).toBeLessThan(0.001);
  });

  /** One frame of the travel shot on a screen of this aspect. */
  const shot = (aspect: number, standing: boolean) => {
    const f = new TravelFraming();
    const input = { hero: { x: 0, y: 300, z: 0 }, vel: { x: 0, y: 0, z: standing ? 0 : 600 }, grounded: standing, goal: { x: 0, y: 300, z: 3000 }, steer: null, orbitYaw: 0, aspect, reducedMotion: false };
    const base = { dist: 420, pitch: 0.2, deadZone: 0.35, settle: 0.07, yawTime: 0.45, maxRate: Math.PI / 2, fov: aspect < 1 ? 69 : 55, pivotLift: 0.086, frameLift: 0.12 };
    const view = { position: { x: 0, y: 400, z: -400 }, target: { x: 0, y: 340, z: 0 } };
    let s = f.update(input, 0, 0, 0, base, view, 1 / 60);
    for (let t = 0; t < 3; t += 1 / 60) s = f.update(input, 0, 0, 0, base, view, 1 / 60);
    return { f, s };
  };

  it("on a phone, looks more level when standing, so the stop sits below the tall top HUD", () => {
    const phone = shot(390 / 844, true).s;
    expect(phone.raise).toBeGreaterThan(30);
    // The view then looks down no more than `standViewPortrait`: the camera's height over the look point, over the flat distance.
    const camH = (0.086 + Math.sin(phone.pitch)) * phone.dist;
    const lookH = 0.12 * phone.dist + phone.raise;
    // (390×844 is 98% portrait, so a hair more.)
    expect(Math.abs(Math.atan2(camH - lookH, Math.cos(phone.pitch) * phone.dist) - TRAVEL_TUNING.standViewPortrait)).toBeLessThan(0.01);
    // Not on a wide screen, and not while moving.
    expect(shot(16 / 9, true).s.raise).toBe(0);
    expect(shot(390 / 844, false).s.raise).toBe(0);
  });

  it("on a phone, the pivot and the look point trail the hero less across (the camera slides, it doesn't turn), smoothly; not at 16:9", () => {
    const { f, s } = shot(390 / 844, false);
    // A phone upright sees about a third as far across as 16:9; the share floors at `narrowMin`.
    expect(s.narrow).toBe(TRAVEL_TUNING.narrowMin);
    // Viewing along +z (yaw 0): across is x. A spring 80 across and 50 along behind its goal.
    const spring = new SmoothedVec3();
    const now = { x: 80, y: 300, z: -50 };
    spring.snap(now);
    f.tighten(spring, now, { x: 0, y: 300, z: 0 }, 0, 90);
    expect(Math.abs(now.x)).toBeLessThan(90 * s.narrow);
    expect(now.x).toBeGreaterThan(0);
    expect(now.z).toBe(-50);
    expect(spring.x.value).toBe(now.x);
    // Smooth: a little more lag across means a little more trail, never a corner.
    const trail = (lag: number) => {
      const v = { x: lag, y: 0, z: 0 };
      f.tighten(new SmoothedVec3(), v, { x: 0, y: 0, z: 0 }, 0, 90);
      return v.x;
    };
    for (let lag = 0; lag < 200; lag += 10) expect(trail(lag + 10)).toBeGreaterThan(trail(lag));
    // The look-ahead and the lean shrink across, not along.
    const lead = { x: 60, y: 0, z: 100 };
    const lean = { x: -30, y: 20, z: 0 };
    f.narrowAcross(lead, lean, 0);
    expect(lead.x).toBeCloseTo(60 * s.narrow, 6);
    expect(lead.z).toBe(100);
    expect(lean.y).toBe(20);
    // At 16:9 nothing changes.
    const wide = shot(16 / 9, false);
    expect(wide.s.narrow).toBe(1);
    const w = { x: 80, y: 300, z: -50 };
    wide.f.tighten(new SmoothedVec3(), w, { x: 0, y: 300, z: 0 }, 0, 90);
    expect(w.x).toBe(80);
  });
});
