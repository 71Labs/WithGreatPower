import { describe, expect, it } from "vitest";

import type { City } from "@wgp/game-core/sim3d/contract";

import { CHASE_TUNING, ChaseCamera, chaseDistance, chaseFov, createChaseInput, type ChaseInput } from "./chase";
import { citySolids, createCityRaycast, raycastSolids, surfaceBelow } from "./raycast";
import { angleDelta, SmoothedAngle } from "./springs";

const DT = 1 / 60;

function run(cam: ChaseCamera, input: ChaseInput, seconds: number) {
  let pose = cam.update(input, DT);
  for (let t = DT; t < seconds; t += DT) pose = cam.update(input, DT);
  return pose;
}

const horiz = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

function wallCity(): City {
  // One tall slab behind a hero standing at the origin facing +x: the slab spans x ∈ [-260, -200].
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

describe("chase camera", () => {
  it("sits behind the velocity heading and looks ahead of the hero", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 400, z: 0 };
    input.vel = { x: 600, y: 0, z: 0 };
    const pose = run(cam, input, 3);
    expect(pose.position.x).toBeLessThan(input.hero.x - 300);
    expect(Math.abs(pose.position.z)).toBeLessThan(5);
    expect(pose.position.y).toBeGreaterThan(input.hero.y);
    expect(pose.target.x).toBeGreaterThan(input.hero.x);
  });

  it("turns with the heading but holds it when the hero stops", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 300, z: 0 };
    input.vel = { x: 0, y: 0, z: 800 };
    let pose = run(cam, input, 3);
    expect(pose.position.z).toBeLessThan(-300);
    input.vel = { x: 0, y: 0, z: 0 };
    pose = run(cam, input, 2);
    expect(pose.position.z).toBeLessThan(-300);
  });

  it("pulls back and widens with speed", () => {
    expect(chaseDistance(0)).toBeCloseTo(CHASE_TUNING.distSlow);
    expect(chaseDistance(5000)).toBeCloseTo(CHASE_TUNING.distFast);
    expect(chaseFov(0, 16 / 9, false)).toBeCloseTo(55);
    expect(chaseFov(5000, 16 / 9, false)).toBeCloseTo(65);
    // Portrait widens; reduced motion holds the FOV whatever the speed.
    expect(chaseFov(0, 390 / 844, false)).toBeGreaterThan(62);
    expect(chaseFov(0, 16 / 9, true)).toBe(chaseFov(5000, 16 / 9, true));

    const slow = new ChaseCamera();
    const fast = new ChaseCamera();
    const a = createChaseInput();
    a.hero = { x: 0, y: 400, z: 0 };
    a.vel = { x: 200, y: 0, z: 0 };
    const b = { ...a, vel: { x: 1600, y: 0, z: 0 } };
    const ps = run(slow, a, 4);
    const pf = run(fast, b, 4);
    expect(ps.arm).toBeCloseTo(420, 0);
    expect(pf.arm).toBeCloseTo(620, 0);
    expect(pf.fov).toBeGreaterThan(ps.fov + 8);
  });

  it("pulls in when a building is between the hero and the camera, then eases back out", () => {
    const city = wallCity();
    const cam = new ChaseCamera(createCityRaycast(city));
    const input = createChaseInput();
    input.hero = { x: 0, y: 300, z: 0 };
    input.vel = { x: 300, y: 0, z: 0 };
    const pose = run(cam, input, 2);
    // The wall face is at x = -200; the camera must stay in front of it.
    expect(pose.position.x).toBeGreaterThan(-200);
    expect(pose.arm).toBeLessThan(pose.want);
    expect(pose.arm).toBeGreaterThanOrEqual(CHASE_TUNING.minArm);

    // Move away from the wall: the arm grows back, not in one frame.
    input.hero = { x: 1200, y: 300, z: 0 };
    const first = cam.update(input, DT);
    expect(first.arm).toBeLessThan(first.want);
    const later = run(cam, input, 3);
    expect(later.arm).toBeCloseTo(later.want, 0);
  });

  it("frames both fighters from the side inside the arena", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: -200, y: 300, z: 0 };
    input.vel = { x: 0, y: 0, z: 0 };
    input.rival = { x: 200, y: 300, z: 0 };
    input.arena = { x0: -600, z0: -600, x1: 600, z1: 600, h: 900 };
    const pose = run(cam, input, 4);
    const p = pose.position;
    expect(p.x).toBeGreaterThanOrEqual(-600);
    expect(p.x).toBeLessThanOrEqual(600);
    expect(p.z).toBeGreaterThanOrEqual(-600);
    expect(p.z).toBeLessThanOrEqual(600);
    // Looking at the midpoint, from well off the fighters' line.
    expect(Math.abs(pose.target.x)).toBeLessThan(5);
    const view = { x: pose.target.x - p.x, z: pose.target.z - p.z };
    const len = Math.hypot(view.x, view.z);
    expect(Math.abs(view.x / len)).toBeLessThan(0.6);
    // Both fighters are in front of the camera.
    for (const f of [input.hero, input.rival]) expect((f.x - p.x) * view.x + (f.z - p.z) * view.z).toBeGreaterThan(0);
  });

  it("climbs rather than closing in when the arena is small", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: -150, y: 300, z: 0 };
    input.rival = { x: 150, y: 300, z: 0 };
    input.arena = { x0: -350, z0: -350, x1: 350, z1: 350, h: 900 };
    const pose = run(cam, input, 4);
    expect(Math.abs(pose.position.x)).toBeLessThanOrEqual(350);
    expect(Math.abs(pose.position.z)).toBeLessThanOrEqual(350);
    expect(pose.arm).toBeGreaterThan(pose.want * 0.95);
    expect(pose.position.y).toBeGreaterThan(300 + 300);
  });

  it("orbits on input and recentres 1.5 s after it stops", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 300, z: 0 };
    input.vel = { x: 500, y: 0, z: 0 };
    const base = { ...run(cam, input, 2).position };
    input.orbiting = true;
    input.orbitYaw = Math.PI / 2;
    cam.update(input, DT);
    input.orbitYaw = 0;
    const turned = { ...run(cam, input, 0.5).position };
    expect(horiz(turned, base)).toBeGreaterThan(300);
    input.orbiting = false;
    // Still held just before the idle delay…
    const held = { ...run(cam, input, 1.3).position };
    expect(horiz(held, turned)).toBeLessThan(20);
    // …and back behind the hero after it.
    const back = run(cam, input, 3).position;
    expect(horiz(back, base)).toBeLessThan(15);
  });

  it("never returns NaN, even with no motion and zero or bad dt", () => {
    const cam = new ChaseCamera(createCityRaycast(wallCity()));
    const input = createChaseInput();
    for (const dt of [0, -1, Number.NaN, 5, DT]) {
      const p = cam.update(input, dt);
      for (const v of [p.position.x, p.position.y, p.position.z, p.target.x, p.target.y, p.target.z, p.fov, p.arm]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("leans the look point toward the web anchor", () => {
    const a = new ChaseCamera();
    const b = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 300, z: 0 };
    input.vel = { x: 600, y: 0, z: 0 };
    const free = run(a, input, 1).target.y;
    input.anchor = { x: 200, y: 800, z: 0 };
    const tied = run(b, input, 1).target.y;
    expect(tied).toBeGreaterThan(free + 50);
  });

  it("keeps the camera above the street", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 10, z: 0 };
    input.vel = { x: 300, y: 0, z: 0 };
    input.orbiting = true;
    input.orbitPitch = -2;
    const pose = run(cam, input, 1);
    expect(pose.position.y).toBeGreaterThanOrEqual(CHASE_TUNING.minCameraY);
  });
});

describe("city raycast", () => {
  it("hits the near face of a box and misses past it", () => {
    const s = citySolids(wallCity());
    expect(raycastSolids(s, { x: 0, y: 300, z: 0 }, { x: -1, y: 0, z: 0 }, 1000)).toBeCloseTo(200);
    expect(raycastSolids(s, { x: 0, y: 300, z: 0 }, { x: 1, y: 0, z: 0 }, 1000)).toBeNull();
    expect(raycastSolids(s, { x: 0, y: 300, z: 0 }, { x: -1, y: 0, z: 0 }, 150)).toBeNull();
  });

  it("finds the roof under a point", () => {
    const s = citySolids(wallCity());
    expect(surfaceBelow(s, -230, 0)).toBe(2000);
    expect(surfaceBelow(s, 0, 0)).toBe(0);
    expect(surfaceBelow(s, -230, 0, 500)).toBe(0);
  });
});

describe("springs", () => {
  it("turns the short way round", () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    const s = new SmoothedAngle();
    s.snap(3);
    for (let i = 0; i < 200; i++) s.step(-3, 0.1, DT);
    expect(Math.abs(angleDelta(s.value, -3))).toBeLessThan(1e-3);
    expect(s.value).toBeGreaterThan(3);
  });
});
