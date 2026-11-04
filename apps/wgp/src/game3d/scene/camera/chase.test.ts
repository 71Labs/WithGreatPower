import { describe, expect, it } from "vitest";

import type { City } from "@wgp/game-core/sim3d/contract";

import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import { arenaFit, CHASE_TUNING, ChaseCamera, chaseDistance, chaseFov, createChaseInput, steersByHand, type ChaseInput, type ChasePose } from "./chase";
import { TRAVEL_TUNING } from "./framing";
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

describe("travel shots", () => {
  /** The view's yaw (atan2(x, z) of position → target). */
  const viewYaw = (p: ChasePose) => Math.atan2(p.target.x - p.position.x, p.target.z - p.position.z);

  it("stands calmly over the shoulder toward the next stop: the hero left of centre, the stop ahead of the view", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 300, z: 0 };
    input.vel = { x: 0, y: 0, z: 0 };
    input.grounded = true;
    // Facing +z, the next stop off to the side (+x, at 60°).
    input.facing = { x: 0, y: 0, z: 1 };
    input.goal = { x: 2600, y: 300, z: 1500 };
    let lastYaw: number | null = null;
    let fastest = 0;
    let pose = cam.update(input, DT);
    for (let t = 0; t < 5; t += DT) {
      pose = cam.update(input, DT);
      const y = viewYaw(pose);
      if (lastYaw !== null) fastest = Math.max(fastest, Math.abs(angleDelta(lastYaw, y)) / DT);
      lastYaw = y;
    }
    const toStop = Math.atan2(2600, 1500);
    expect(Math.abs(angleDelta(toStop, viewYaw(pose)))).toBeLessThan(0.05);
    // Calm: never faster than the standing turn's cap (and a little for the look point).
    expect(fastest).toBeLessThan(1.1);
    const hero = ndc(pose, input.hero, input.aspect)!;
    expect(hero.x).toBeLessThan(-0.12);
    expect(hero.x).toBeGreaterThan(-0.3);
    const stop = ndc(pose, input.goal, input.aspect)!;
    expect(stop.x).toBeGreaterThan(hero.x + 0.1);
    // A little higher than the travel shot (11.5°): about 17° above.
    const lift = Math.atan2(pose.position.y - input.hero.y, Math.hypot(pose.position.x - input.hero.x, pose.position.z - input.hero.z));
    expect(lift).toBeGreaterThan(0.25);
  });

  it("eases out of the standing shot once the hero moves, without a jump", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 300, z: 0 };
    input.vel = { x: 0, y: 0, z: 0 };
    input.grounded = true;
    input.facing = { x: 0, y: 0, z: 1 };
    input.goal = { x: 0, y: 300, z: 3000 };
    let pose = run(cam, input, 3);
    let last = { ...pose.position };
    let step = { x: 0, y: 0, z: 0 };
    let worst = 0;
    // Runs toward the stop.
    input.vel = { x: 0, y: 0, z: 390 };
    for (let t = 0; t < 2; t += DT) {
      input.hero = { x: 0, y: 300, z: input.hero.z + 390 * DT };
      pose = cam.update(input, DT);
      const now = { x: pose.position.x - last.x, y: pose.position.y - last.y, z: pose.position.z - last.z };
      // The camera's change in velocity, a frame to the next (units a frame, per frame).
      worst = Math.max(worst, Math.hypot(now.x - step.x, now.y - step.y, now.z - step.z));
      step = now;
      last = { ...pose.position };
    }
    // The hero goes from still to running in one tick (6.5 units a frame); the camera takes it up gently.
    expect(worst).toBeLessThan(1.5);
    // Back behind the hero: centred across.
    expect(Math.abs(ndc(pose, input.hero, input.aspect)!.x)).toBeLessThan(0.05);
  });

  it("turns before the way ahead leaves a phone's narrow view (the dead zone fits the screen)", () => {
    /** The yaw after the heading turns 15°, on a screen of this aspect. */
    const turned = (aspect: number) => {
      const cam = new ChaseCamera();
      const input = createChaseInput();
      input.aspect = aspect;
      input.hero = { x: 0, y: 400, z: 0 };
      input.vel = { x: 0, y: 0, z: 800 };
      run(cam, input, 3);
      const a = (15 * Math.PI) / 180;
      input.vel = { x: 800 * Math.sin(a), y: 0, z: 800 * Math.cos(a) };
      return run(cam, input, 4).yaw;
    };
    // A 16:9 screen sees ±44° across: 15° off is inside its dead zone. A phone sees ±17.5°.
    expect(Math.abs(turned(16 / 9))).toBeLessThan(0.02);
    expect(turned(390 / 844)).toBeGreaterThan(0.15);
  });

  it("leans toward the next stop when it's roughly ahead, more on the last stretch", () => {
    const lean = (goalDist: number) => {
      const cam = new ChaseCamera();
      const input = createChaseInput();
      input.hero = { x: 0, y: 400, z: 0 };
      input.vel = { x: 0, y: 0, z: 900 };
      // The stop 40° off the heading.
      const a = (40 * Math.PI) / 180;
      input.goal = { x: goalDist * Math.sin(a), y: 400, z: goalDist * Math.cos(a) };
      for (let t = 0; t < 4; t += DT) {
        input.hero = { x: 0, y: 400, z: input.hero.z + 900 * DT };
        input.goal = { x: input.goal.x, y: 400, z: input.goal.z + 900 * DT };
        cam.update(input, DT);
      }
      return cam.pose.yaw;
    };
    const far = lean(5000);
    const near = lean(600);
    expect(far).toBeGreaterThan(0.08);
    expect(far).toBeLessThan(0.45);
    expect(near).toBeGreaterThan(far + 0.1);
  });

  it("sits a little lower at speed", () => {
    const lift = (speed: number) => {
      const cam = new ChaseCamera();
      const input = createChaseInput();
      input.hero = { x: 0, y: 400, z: 0 };
      input.vel = { x: speed, y: 0, z: 0 };
      const p = run(cam, input, 4);
      return Math.atan2(p.position.y - 400, Math.hypot(p.position.x, p.position.z));
    };
    expect(lift(1600)).toBeLessThan(lift(200) - 0.03);
  });

  it("kicks the FOV a little when the speed jumps, never under reduced motion", () => {
    const peak = (reducedMotion: boolean) => {
      const cam = new ChaseCamera();
      const input = createChaseInput();
      input.reducedMotion = reducedMotion;
      input.hero = { x: 0, y: 400, z: 0 };
      input.vel = { x: 500, y: 0, z: 0 };
      const steady = run(cam, input, 4).fov;
      // A boost: 500 → 1300 at once.
      input.vel = { x: 1300, y: 0, z: 0 };
      let most = 0;
      for (let t = 0; t < 1; t += DT) most = Math.max(most, cam.update(input, DT).fov);
      const settled = run(cam, input, 6).fov;
      return { steady, most, settled };
    };
    const on = peak(false);
    expect(on.most).toBeGreaterThan(on.steady + 1);
    expect(on.most - on.steady).toBeLessThan(CHASE_TUNING.fovFast - CHASE_TUNING.fovSlow + 4);
    const off = peak(true);
    expect(off.most).toBeCloseTo(off.steady, 6);
    expect(off.settled).toBeCloseTo(off.steady, 6);
  });

  it("eases behind a run on a roof while the stick keeps the heading it was pushed with", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: 0, y: 300, z: 0 };
    input.grounded = true;
    input.vel = { x: 0, y: 0, z: 0 };
    input.facing = { x: 0, y: 0, z: 1 };
    run(cam, input, 2);
    // Stick right: the hero runs right of the view (−x, for a view along +z).
    input.steer = { x: 1, y: 0 };
    input.vel = { x: -390, y: 0, z: 0 };
    const first = cam.update(input, DT);
    const steer = { ...first.steer! };
    expect(Math.abs(steer.fx)).toBeLessThan(0.01);
    expect(steer.fz).toBeCloseTo(1, 3);
    let pose = first;
    for (let t = 0; t < 4; t += DT) {
      input.hero = { x: input.hero.x - 390 * DT, y: 300, z: 0 };
      pose = cam.update(input, DT);
      // The stick's heading never moves while it's held.
      expect(pose.steer!.fx).toBeCloseTo(steer.fx, 6);
      expect(pose.steer!.fz).toBeCloseTo(steer.fz, 6);
    }
    // The camera came round behind the run.
    expect(Math.abs(angleDelta(-Math.PI / 2, viewYaw(pose)))).toBeLessThan(0.3);
    // Mouse look still steers.
    input.orbitYaw = 0.2;
    pose = cam.update(input, DT);
    input.orbitYaw = 0;
    expect(Math.atan2(pose.steer!.fx, pose.steer!.fz)).toBeCloseTo(0.2, 3);
    // Let go: the stick goes by the view again.
    input.steer = { x: 0, y: 0 };
    expect(cam.update(input, DT).steer).toBeNull();
  });

  it("keeps the plain chase where the travel shots are off (a fight's encounter, its end, a knockout)", () => {
    /** Standing facing +z with the next stop off at 60°: where the view ends up looking. */
    const standing = (framing: boolean | undefined) => {
      const cam = new ChaseCamera();
      const input = createChaseInput();
      input.framing = framing;
      input.grounded = true;
      input.facing = { x: 0, y: 0, z: 1 };
      input.goal = { x: 2600, y: 300, z: 1500 };
      input.hero = { x: 0, y: 300, z: 0 };
      return viewYaw(run(cam, input, 4));
    };
    // On, it turns to the stop; off, it stays behind the hero's facing.
    expect(standing(undefined)).toBeGreaterThan(0.9);
    expect(Math.abs(standing(false))).toBeLessThan(0.01);

    // Off: no held steering heading, and the arm pulls in as fast as the plain chase's.
    const cam = new ChaseCamera(createCityRaycast(wallCity()));
    const input = createChaseInput();
    input.framing = false;
    input.grounded = true;
    input.steer = { x: 1, y: 0 };
    input.vel = { x: 300, y: 0, z: 0 };
    input.hero = { x: 0, y: 300, z: 900 };
    let last = run(cam, input, 2).arm;
    expect(cam.pose.steer).toBeNull();
    let fastest = 0;
    for (let t = 0; t < 2; t += DT) {
      input.hero = { x: 0, y: 300, z: Math.max(0, input.hero.z - 900 * DT) };
      const arm = cam.update(input, DT).arm;
      fastest = Math.max(fastest, last - arm);
      last = arm;
    }
    expect(fastest).toBeGreaterThan(TRAVEL_TUNING.armRate * DT * 1.5);
  });

  it("hands back from the plain chase (a fight's end) without a jump", () => {
    for (const aspect of [16 / 9, 390 / 844]) {
      const cam = new ChaseCamera(createCityRaycast(wallCity()));
      const input = createChaseInput();
      input.aspect = aspect;
      // Heading +x close in front of the slab's face (x = −200): the arm behind is boxed in.
      input.vel = { x: 300, y: 0, z: 0 };
      input.hero = { x: -150, y: 300, z: 0 };
      run(cam, input, 3);
      // A fight's end: the plain chase for a while, the hero moving on.
      input.framing = false;
      for (let t = 0; t < 1.5; t += DT) {
        input.hero = { x: input.hero.x + 300 * DT, y: 300, z: 0 };
        cam.update(input, DT);
      }
      // The shots come back: no step in the view's direction over 2° a frame.
      input.framing = true;
      let last = { yaw: viewYaw(cam.pose), pitch: Math.atan2(cam.pose.target.y - cam.pose.position.y, Math.hypot(cam.pose.target.x - cam.pose.position.x, cam.pose.target.z - cam.pose.position.z)) };
      for (let t = 0; t < 1; t += DT) {
        input.hero = { x: input.hero.x + 300 * DT, y: 300, z: 0 };
        const p = cam.update(input, DT);
        const now = { yaw: viewYaw(p), pitch: Math.atan2(p.target.y - p.position.y, Math.hypot(p.target.x - p.position.x, p.target.z - p.position.z)) };
        expect(Math.hypot(angleDelta(last.yaw, now.yaw), now.pitch - last.pitch)).toBeLessThan((2 * Math.PI) / 180);
        last = now;
      }
    }
  });

  it("on a phone, keeps a pendulum-swinging hero near the middle by sliding with him, not turning", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.aspect = 390 / 844;
    input.hero = { x: 0, y: 400, z: 0 };
    let worstX = 0;
    let worstRate = 0;
    let last: number | null = null;
    for (let i = 0; i < 6 * 60; i++) {
      const t = i * DT;
      // Travelling +x at 700 with a 1.2 s swing: ±650 sideways, ±400 along, ±350 vertical.
      const w = (2 * Math.PI) / 1.2;
      input.vel = { x: 700 + 400 * Math.cos(w * t), y: 350 * Math.sin(w * t), z: 650 * Math.sin(w * t) };
      input.hero = { x: input.hero.x + input.vel.x * DT, y: 400 + (350 / w) * (1 - Math.cos(w * t)), z: input.hero.z + input.vel.z * DT };
      const pose = cam.update(input, DT);
      const y = viewYaw(pose);
      if (t > 1) {
        worstX = Math.max(worstX, Math.abs(ndc(pose, input.hero, input.aspect)!.x));
        if (last !== null) worstRate = Math.max(worstRate, Math.abs(angleDelta(last, y)) / DT);
      }
      last = y;
    }
    // Before, the hero swung out to a third of the half width and the view swung after him at 17°/s.
    expect(worstX).toBeLessThan(0.2);
    expect(worstRate).toBeLessThan((8 * Math.PI) / 180);
  });

  it("never changes the arm's length faster than its rate when a wall cuts across it", () => {
    const cam = new ChaseCamera(createCityRaycast(wallCity()));
    const input = createChaseInput();
    // Heading +x, the camera behind on −x; 600 off the slab's end (z = 400), so clear of it.
    input.vel = { x: 300, y: 0, z: 0 };
    input.hero = { x: 0, y: 300, z: 900 };
    let last = run(cam, input, 2).arm;
    let shortest = last;
    // Slide across behind the slab: it cuts the arm to under half.
    for (let t = 0; t < 2; t += DT) {
      input.hero = { x: 0, y: 300, z: Math.max(0, input.hero.z - 900 * DT) };
      const arm = cam.update(input, DT).arm;
      expect(Math.abs(arm - last)).toBeLessThanOrEqual(TRAVEL_TUNING.armRate * DT + 1e-6);
      shortest = Math.min(shortest, arm);
      last = arm;
    }
    expect(shortest).toBeLessThan(220);
  });

  it("keeps the camera out of a wall the pivot lags into, and never folds the arm onto the hero", () => {
    // The slab spans x ∈ [−260, −200]; the hero runs along it at x = −170, the camera behind (−z) and to its side.
    const city = wallCity();
    const cam = new ChaseCamera(createCityRaycast(city));
    const input = createChaseInput();
    input.hero = { x: 400, y: 300, z: -300 };
    input.vel = { x: -900, y: 0, z: 300 };
    const s = citySolids(city, { props: false });
    const inside = (p: Vec3) => p.x > s.minX[0] && p.x < s.maxX[0] && p.y > s.minY[0] && p.y < s.maxY[0] && p.z > s.minZ[0] && p.z < s.maxZ[0];
    let insideFrames = 0;
    let shortest = Infinity;
    for (let t = 0; t < 2.5; t += DT) {
      // Swings in toward the wall and turns along it.
      const vx = input.hero.x > -150 ? -900 : 0;
      input.vel = { x: vx, y: 0, z: vx ? 300 : 900 };
      input.hero = { x: Math.max(-170, input.hero.x + vx * DT), y: 300, z: input.hero.z + input.vel.z * DT };
      const pose = cam.update(input, DT);
      if (inside(pose.position)) insideFrames++;
      shortest = Math.min(shortest, pose.arm);
    }
    expect(insideFrames).toBeLessThan(6);
    expect(shortest).toBeGreaterThanOrEqual(TRAVEL_TUNING.minArm - 1);
  });
});

/** A point on screen from a pose, NDC (x right, y up), and its depth; null behind the camera. */
function ndc(pose: ChasePose, p: Vec3, aspect: number): { x: number; y: number; z: number } | null {
  const f = { x: pose.target.x - pose.position.x, y: pose.target.y - pose.position.y, z: pose.target.z - pose.position.z };
  const fl = Math.hypot(f.x, f.y, f.z);
  f.x /= fl;
  f.y /= fl;
  f.z /= fl;
  // right = f × up, up' = right × f
  const rl = Math.hypot(f.z, f.x);
  const r = { x: -f.z / rl, y: 0, z: f.x / rl };
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const o = { x: p.x - pose.position.x, y: p.y - pose.position.y, z: p.z - pose.position.z };
  const z = o.x * f.x + o.y * f.y + o.z * f.z;
  if (z <= 1) return null;
  const tanV = Math.tan((pose.fov * Math.PI) / 360);
  return { x: (o.x * r.x + o.y * r.y + o.z * r.z) / (z * tanV * aspect), y: (o.x * u.x + o.y * u.y + o.z * u.z) / (z * tanV), z };
}

/** The arm's camera for a fit: back from `pivot` along `yaw`, up by `pitch`, looking at the pivot. */
function poseAt(pivot: Vec3, yaw: number, pitch: number, dist: number, fov: number): ChasePose {
  const cp = Math.cos(pitch);
  return {
    position: { x: pivot.x - Math.sin(yaw) * cp * dist, y: pivot.y + Math.sin(pitch) * dist, z: pivot.z - Math.cos(yaw) * cp * dist },
    target: { ...pivot },
    fov,
    arm: dist,
    want: dist,
    yaw,
  };
}

describe("arena two-shot fit", () => {
  const T = CHASE_TUNING;
  const pivot = { x: 0, y: 400, z: 0 };

  it("is the shortest arm that keeps both bodies inside the safe frame across", () => {
    // Side on (the camera on −z looking +z), the fighters 500 apart along x.
    const a = { x: -250, y: 400, z: 0 };
    const b = { x: 250, y: 400, z: 0 };
    const d = arenaFit(a, b, pivot, 0, 0, 55, 16 / 9);
    const edge = (dist: number) => Math.max(...[a, b].map((f) => Math.abs(ndc(poseAt(pivot, 0, 0, dist, 55), { ...f, x: f.x + Math.sign(f.x) * T.arenaBody }, 16 / 9)!.x)));
    expect(edge(d)).toBeCloseTo(T.arenaSafeX, 2);
    expect(edge(d * 0.95)).toBeGreaterThan(T.arenaSafeX);
  });

  it("fits a flyer far overhead by the pair's spread up and down", () => {
    const hero = { x: -60, y: 200, z: 0 };
    const near = arenaFit(hero, { x: 60, y: 350, z: 0 }, pivot, 0, 0.28, 58, 16 / 9);
    const high = arenaFit(hero, { x: 60, y: 750, z: 0 }, pivot, 0, 0.28, 58, 16 / 9);
    expect(high).toBeGreaterThan(near + 300);
    // At that arm, centred on the pair, both bodies sit inside the safe frame's height.
    const pose = poseAt(pivot, 0, 0.28, high, 58);
    const top = ndc(pose, { x: 60, y: 750 + T.arenaBody, z: 0 }, 16 / 9)!.y;
    const bottom = ndc(pose, { x: -60, y: 200 - T.arenaBody, z: 0 }, 16 / 9)!.y;
    expect((top - bottom) / 2).toBeLessThanOrEqual(T.arenaSafeY * 1.02);
  });

  it("backs off for a portrait screen, which is narrower than it is tall", () => {
    const a = { x: -250, y: 400, z: 0 };
    const b = { x: 250, y: 400, z: 0 };
    expect(arenaFit(a, b, pivot, 0, 0.28, 69, 9 / 16)).toBeGreaterThan(arenaFit(a, b, pivot, 0, 0.28, 55, 16 / 9) * 1.5);
  });

  it("counts the nearer fighter bigger: a pair along the view needs more than its spread", () => {
    // The camera on −z: the hero 300 nearer than the pivot, the rival 300 further.
    const a = { x: 120, y: 400, z: -300 };
    const b = { x: -120, y: 400, z: 300 };
    const along = arenaFit(a, b, pivot, 0, 0, 55, 16 / 9);
    const across = arenaFit({ x: 120, y: 400, z: 0 }, { x: -120, y: 400, z: 0 }, pivot, 0, 0, 55, 16 / 9);
    expect(along).toBeGreaterThan(across + 250);
  });

  it("is capped, and finite for any input", () => {
    const far = arenaFit({ x: -5000, y: 0, z: 0 }, { x: 5000, y: 3000, z: 0 }, pivot, 1, 0.3, 60, 16 / 9);
    expect(far).toBe(T.arenaMaxDist);
    const same = arenaFit(pivot, pivot, pivot, 0, 0, 55, 16 / 9);
    expect(Number.isFinite(same)).toBe(true);
    expect(same).toBeGreaterThan(0);
  });
});

describe("arena two-shot", () => {
  const arena = { x0: -900, z0: -900, x1: 900, z1: 900, h: 1020 };

  it("frames a close fight tighter than a far one, both fighters in frame", () => {
    const close = createChaseInput();
    close.hero = { x: -100, y: 300, z: 0 };
    close.rival = { x: 100, y: 380, z: 0 };
    close.arena = arena;
    const cam = new ChaseCamera();
    const near = run(cam, close, 4);
    expect(near.arm).toBeLessThan(470);
    for (const f of [close.hero, close.rival]) {
      const p = ndc(near, f, close.aspect)!;
      expect(Math.abs(p.x)).toBeLessThan(0.9);
      expect(Math.abs(p.y)).toBeLessThan(0.9);
    }
    const wide = { ...close, hero: { x: -350, y: 150, z: 0 }, rival: { x: 350, y: 650, z: 0 } };
    const far = run(new ChaseCamera(), wide, 4);
    expect(far.arm).toBeGreaterThan(near.arm + 200);
    for (const f of [wide.hero, wide.rival]) {
      const p = ndc(far, f, wide.aspect)!;
      expect(Math.abs(p.x)).toBeLessThan(0.9);
      expect(Math.abs(p.y)).toBeLessThan(0.9);
    }
  });

  it("on a portrait screen, never backs off further than the roomy two-shot", () => {
    const input = createChaseInput();
    input.arena = arena;
    input.hero = { x: -250, y: 300, z: 0 };
    input.rival = { x: 250, y: 300, z: 0 };
    // A tall phone (20:9), fully portrait; a 16:9 one blends most of the way there.
    input.aspect = 9 / 20;
    const roomy = 500 * 1.05 + 330;
    expect(run(new ChaseCamera(), input, 5).want).toBeLessThanOrEqual(roomy + 1);
    input.aspect = 16 / 9;
    expect(run(new ChaseCamera(), input, 5).want).toBeLessThan(roomy - 100);
  });

  it("doesn't breathe with a swing: the arm holds steady while the hero pendulums under a flyer", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.arena = arena;
    input.rival = { x: 0, y: 650, z: 0 };
    input.rivalVel = { x: 0, y: 0, z: 0 };
    const at = (time: number) => {
      // A 1.6 s pendulum, 260 each way, rising at the ends.
      const w = (2 * Math.PI) / 1.6;
      const s = Math.sin(w * time);
      input.hero = { x: 260 * s, y: 260 + 90 * s * s, z: 0 };
      input.vel = { x: 260 * w * Math.cos(w * time), y: 90 * w * Math.sin(2 * w * time), z: 0 };
    };
    let time = 0;
    for (; time < 4; time += DT) {
      at(time);
      cam.update(input, DT);
    }
    let lo = Infinity;
    let hi = -Infinity;
    let worstStep = 0;
    let last = cam.pose.arm;
    for (; time < 9; time += DT) {
      at(time);
      const pose = cam.update(input, DT);
      lo = Math.min(lo, pose.arm);
      hi = Math.max(hi, pose.arm);
      worstStep = Math.max(worstStep, Math.abs(pose.arm - last));
      last = pose.arm;
      for (const f of [input.hero, input.rival]) {
        const p = ndc(pose, f, input.aspect)!;
        expect(Math.abs(p.x)).toBeLessThan(1);
        expect(Math.abs(p.y)).toBeLessThan(1);
      }
    }
    // Under 5% of the arm, and no step bigger than a couple of units a frame.
    expect(hi - lo).toBeLessThan(0.05 * hi);
    expect(worstStep).toBeLessThan(2.5);
  });

  it("tightens more slowly under reduced motion once the fighters close in", () => {
    /** How much of the way from the wide shot to the close one the arm has come, a second after they close in. */
    const progress = (reducedMotion: boolean) => {
      const cam = new ChaseCamera();
      const input = createChaseInput();
      input.reducedMotion = reducedMotion;
      input.arena = arena;
      input.hero = { x: -350, y: 300, z: 0 };
      input.rival = { x: 350, y: 300, z: 0 };
      const wide = run(cam, input, 4).arm;
      input.hero = { x: -60, y: 300, z: 0 };
      input.rival = { x: 60, y: 300, z: 0 };
      const soon = run(cam, input, 1).arm;
      const close = run(cam, input, 10).arm;
      return (wide - soon) / (wide - close);
    };
    expect(progress(true)).toBeLessThan(progress(false) - 0.1);
    expect(progress(true)).toBeGreaterThan(0);
  });

  it("eases into a boxed-in climb instead of stepping the camera up", () => {
    const cam = new ChaseCamera();
    const input = createChaseInput();
    input.hero = { x: -150, y: 200, z: 0 };
    input.rival = { x: 150, y: 260, z: 0 };
    input.arena = { x0: -900, z0: -900, x1: 900, z1: 900, h: 1020 };
    let pose = run(cam, input, 4);
    let lastY = pose.position.y;
    // The room behind the camera shrinks in one step (a fighter crossing into a narrow part).
    input.arena = { x0: -900, z0: -120, x1: 900, z1: 120, h: 1020 };
    let worst = 0;
    for (let t = 0; t < 1.5; t += DT) {
      pose = cam.update(input, DT);
      worst = Math.max(worst, Math.abs(pose.position.y - lastY));
      lastY = pose.position.y;
    }
    // An instant climb steps about 3.3 units in one frame here; the eased one stays under 0.3.
    expect(worst).toBeLessThan(1.5);
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
