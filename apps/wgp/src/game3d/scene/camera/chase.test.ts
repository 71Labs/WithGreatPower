import { describe, expect, it } from "vitest";

import type { City } from "@wgp/game-core/sim3d/contract";

import { CHASE_TUNING, ChaseCamera, chaseDistance, chaseFov, createChaseInput, steersByHand, type ChaseInput } from "./chase";
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

  it("frames both fighters from the side, near the arena", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: -200, y: 300, z: 0 };
    input.vel = { x: 0, y: 0, z: 0 };
    input.rival = { x: 200, y: 300, z: 0 };
    input.arena = { x0: -600, z0: -600, x1: 600, z1: 600, h: 900 };
    const pose = run(cam, input, 4);
    const p = pose.position;
    const reach = 600 + CHASE_TUNING.arenaSlack;
    expect(Math.abs(p.x)).toBeLessThanOrEqual(reach);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(reach);
    // Looking at the midpoint, from well off the fighters' line.
    expect(Math.abs(pose.target.x)).toBeLessThan(5);
    const view = { x: pose.target.x - p.x, z: pose.target.z - p.z };
    const len = Math.hypot(view.x, view.z);
    expect(Math.abs(view.x / len)).toBeLessThan(0.6);
    // Both fighters are in front of the camera.
    for (const f of [input.hero, input.rival]) expect((f.x - p.x) * view.x + (f.z - p.z) * view.z).toBeGreaterThan(0);
  });

  it("keeps a low angle on a narrow arena like the bridge, turning along it instead of climbing", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    // A deck along x, 600 across: side-on there is no room, so the shot swings toward the deck's line.
    input.hero = { x: -150, y: 200, z: 0 };
    input.rival = { x: 150, y: 200, z: 0 };
    input.arena = { x0: -560, z0: -300, x1: 560, z1: 300, h: 1020 };
    const pose = run(cam, input, 5);
    const p = pose.position;
    const flat = Math.hypot(p.x - pose.target.x, p.z - pose.target.z);
    const down = Math.atan2(p.y - pose.target.y, flat);
    expect(down).toBeLessThan(0.6);
    expect(pose.arm).toBeGreaterThan(CHASE_TUNING.arenaMinDist * 0.75);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(300 + CHASE_TUNING.arenaSlack);
  });

  it("ignores a pendulum's swing: the yaw holds through sideways and back-and-forth arcs", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 400, z: 0 };
    let maxRate = 0;
    let last = 0;
    let worst = 0;
    for (let i = 0; i < 6 * 60; i++) {
      const t = i * DT;
      // Travelling +x at 700 with a 1.2 s swing: ±650 sideways, ±400 along, ±350 vertical.
      const w = (2 * Math.PI) / 1.2;
      input.vel = { x: 700 + 400 * Math.cos(w * t), y: 350 * Math.sin(w * t), z: 650 * Math.sin(w * t) };
      input.hero = { x: input.hero.x + input.vel.x * DT, y: 400 + (350 / w) * (1 - Math.cos(w * t)), z: input.hero.z + input.vel.z * DT };
      const pose = cam.update(input, DT);
      if (i > 0) maxRate = Math.max(maxRate, Math.abs(angleDelta(last, pose.yaw)) / DT);
      last = pose.yaw;
      if (t > 1) worst = Math.max(worst, Math.abs(angleDelta(Math.PI / 2, pose.yaw)));
    }
    expect(maxRate).toBeLessThan((25 * Math.PI) / 180);
    expect(worst).toBeLessThan(CHASE_TUNING.followDeadZone + 0.05);
  });

  it("turns at most 90°/s with an eased start, and settles behind a new heading", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 300, z: 0 };
    input.vel = { x: 800, y: 0, z: 0 };
    run(cam, input, 2);
    input.vel = { x: 0, y: 0, z: 800 };
    let last = cam.pose.yaw;
    const rates: number[] = [];
    for (let i = 0; i < 4 * 60; i++) {
      const pose = cam.update(input, DT);
      rates.push(Math.abs(angleDelta(last, pose.yaw)) / DT);
      last = pose.yaw;
    }
    expect(Math.max(...rates)).toBeLessThanOrEqual(CHASE_TUNING.followMaxRate + 1e-3);
    // Eased in: the first frames of the turn are slow.
    const firstMoving = rates.findIndex((r) => r > 1e-3);
    expect(rates[firstMoving]).toBeLessThan(0.2);
    expect(Math.abs(angleDelta(0, last))).toBeLessThan(CHASE_TUNING.followSettle + 0.05);
  });

  it("pauses auto-follow while the player steers sideways, and eases back in about 2 s after", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 300, z: 0 };
    input.vel = { x: 0, y: 0, z: 800 };
    const start = run(cam, input, 2).yaw;
    // Holding right: the hero heads off at 90°, the camera stays put.
    input.steer = { x: 1, y: 0 };
    input.vel = { x: -800, y: 0, z: 0 };
    const held = run(cam, input, 3).yaw;
    expect(Math.abs(angleDelta(start, held))).toBeLessThan(0.01);
    // Let go: nothing for ~2 s, then it turns behind the new heading.
    input.steer = { x: 0, y: 0 };
    const waiting = run(cam, input, 1.8).yaw;
    expect(Math.abs(angleDelta(start, waiting))).toBeLessThan(0.02);
    const after = run(cam, input, 4).yaw;
    expect(Math.abs(angleDelta(-Math.PI / 2, after))).toBeLessThan(CHASE_TUNING.followSettle + 0.05);
  });

  it("follows the hero's height softly: a bob inside the dead band leaves the camera still", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 400, z: 0 };
    input.vel = { x: 600, y: 0, z: 0 };
    run(cam, input, 2);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 4 * 60; i++) {
      input.hero = { x: input.hero.x + 600 * DT, y: 400 + 40 * Math.sin(i * DT * 2 * Math.PI), z: 0 };
      const y = cam.update(input, DT).position.y;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    expect(hi - lo).toBeLessThan(12);
  });

  it("turns on manual look, holds it, then auto-follow brings it back behind the travel heading", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 300, z: 0 };
    input.vel = { x: 500, y: 0, z: 0 };
    const base = { ...run(cam, input, 2).position };
    input.orbitYaw = Math.PI / 2;
    cam.update(input, DT);
    input.orbitYaw = 0;
    const turned = { ...run(cam, input, 0.5).position };
    expect(horiz(turned, base)).toBeGreaterThan(300);
    // Held through the pause…
    const held = { ...run(cam, input, 1.3).position };
    expect(horiz(held, turned)).toBeLessThan(20);
    // …and back behind the hero once auto-follow has eased in.
    const back = run(cam, input, 5).position;
    expect(horiz(back, base)).toBeLessThan(40);
  });

  it("never returns NaN, even with no motion and zero or bad dt", () => {
    const cam = new ChaseCamera(createCityRaycast(wallCity()));
    const input = createChaseInput();
    for (const dt of [0, -1, Number.NaN, 5, DT]) {
      const p = cam.update(input, dt);
      for (const v of [p.position.x, p.position.y, p.position.z, p.target.x, p.target.y, p.target.z, p.fov, p.arm]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("leans the look point toward the web anchor without a jump when it attaches", () => {
    const a = new ChaseCamera();
    const b = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 300, z: 0 };
    input.vel = { x: 600, y: 0, z: 0 };
    const free = run(a, input, 1.5).target.y;
    run(b, input, 1.5);
    const before = { ...b.pose.target };
    input.anchor = { x: 200, y: 900, z: 0 };
    const next = b.update(input, DT).target;
    expect(Math.abs(next.y - before.y)).toBeLessThan(3);
    const tied = run(b, input, 2).target.y;
    expect(tied).toBeGreaterThan(free + 15);
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

  it("holds one FOV under reduced motion, at any speed and in a boxed-in two-shot", () => {
    const cam = new ChaseCamera(createCityRaycast(wallCity()));
    const input = createChaseInput();
    input.reducedMotion = true;
    input.hero = { x: 0, y: 300, z: 0 };
    const fovs: number[] = [];
    for (const v of [0, 600, 1600]) {
      input.vel = { x: v, y: 0, z: 0 };
      fovs.push(run(cam, input, 1).fov);
    }
    input.vel = { x: 0, y: 0, z: 0 };
    input.hero = { x: -100, y: 300, z: 0 };
    input.rival = { x: 100, y: 900, z: 0 };
    input.arena = { x0: -180, z0: -400, x1: 400, z1: 400, h: 1020 };
    fovs.push(run(cam, input, 2).fov);
    for (const f of fovs) expect(f).toBeCloseTo(fovs[0], 6);
  });

  it("only counts a stick off straight ahead as steering by hand", () => {
    expect(steersByHand(null)).toBe(false);
    expect(steersByHand({ x: 0, y: 1 })).toBe(false);
    expect(steersByHand({ x: 0.1, y: 0.05 })).toBe(false);
    expect(steersByHand({ x: 1, y: 0 })).toBe(true);
    expect(steersByHand({ x: 0, y: -1 })).toBe(true);
    expect(steersByHand({ x: Math.SQRT1_2, y: Math.SQRT1_2 })).toBe(true);
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
