import { describe, expect, it } from "vitest";

import type { City, Vec3 } from "@wgp/game-core/sim3d/contract";

import { project } from "@/game3d/nav/waypoint";

import { ChaseCamera, createChaseInput, type ChaseInput, type ChasePose } from "./chase";
import { CameraDirector, DIRECTOR_TUNING, smootherstep, type DirectorInput, type SceneCue } from "./director";
import { createLocalRaycast } from "./raycast";
import { angleDelta } from "./springs";

const DT = 1 / 60;
const T = DIRECTOR_TUNING;

/** A hero standing on a roof at (0, 300, 0), facing the first stop up +z. */
function standing(aspect = 16 / 9): { chase: ChaseCamera; input: ChaseInput; beat: DirectorInput; cue: SceneCue } {
  const input = createChaseInput();
  input.hero = { x: 0, y: 300, z: 0 };
  input.vel = { x: 0, y: 0, z: 0 };
  input.grounded = true;
  input.facing = { x: 0, y: 0, z: 1 };
  input.goal = { x: 0, y: 300, z: 3000 };
  input.aspect = aspect;
  const cue: SceneCue = { status: "intro", introLeft: 2.4, introTotal: 2.4 };
  const beat: DirectorInput = { cue, mode: "travel", hero: input.hero, goal: input.goal, ally: null, aspect, reducedMotion: false, input: false };
  return { chase: new ChaseCamera(), input, beat, cue };
}

type View = { position: Vec3; target: Vec3 };
const viewYaw = (p: View) => Math.atan2(p.target.x - p.position.x, p.target.z - p.position.z);
const viewPitch = (p: View) => Math.atan2(p.target.y - p.position.y, Math.hypot(p.target.x - p.position.x, p.target.z - p.position.z));
/** A copy of a pose (the director and the chase reuse theirs). */
const copy = (p: ChasePose) => ({ position: { ...p.position }, target: { ...p.target }, fov: p.fov });
const ndc = (p: Vec3, pose: { position: Vec3; target: Vec3; fov: number }, w: number, h: number) => {
  const pr = project(p, pose, w, h);
  return { x: (pr.x / w) * 2 - 1, y: 1 - (pr.y / h) * 2, behind: pr.behind };
};

describe("camera beats", () => {
  it("passes the chase straight through without a night (the lab, a bench)", () => {
    const { chase, input, beat } = standing();
    beat.cue = null;
    const d = new CameraDirector();
    const pose = chase.update(input, DT);
    expect(d.update(pose, beat, DT)).toBe(pose);
  });

  it("opens the countdown on a high, wide shot of the hero's roof and cranes down into the chase by the last count", () => {
    const { chase, input, beat, cue } = standing();
    const d = new CameraDirector();
    const frames: { pose: ReturnType<typeof copy>; chase: ReturnType<typeof copy> }[] = [];
    for (let t = 0; t < 2.4; t += DT) {
      cue.introLeft = 2.4 - t;
      const c = chase.update(input, DT);
      const cc = copy(c);
      frames.push({ pose: copy(d.update(c, beat, DT)), chase: cc });
    }
    const first = frames[0].pose;
    // High and wide: hundreds of units up and well back.
    expect(first.position.y - input.hero.y).toBeGreaterThan(400);
    expect(Math.hypot(first.position.x, first.position.z)).toBeGreaterThan(700);
    // The hero stands low in the frame, in view.
    const hero = ndc(input.hero, first, 1920, 1080);
    expect(hero.behind).toBe(false);
    expect(hero.y).toBeLessThan(-0.3);
    expect(hero.y).toBeGreaterThan(-0.7);
    expect(Math.abs(hero.x)).toBeLessThan(0.2);
    // By the end of the crane it's the chase's own pose.
    const end = frames[Math.ceil(T.introMove / DT) + 2];
    expect(Math.hypot(end.pose.position.x - end.chase.position.x, end.pose.position.y - end.chase.position.y, end.pose.position.z - end.chase.position.z)).toBeLessThan(1e-6);
    // Smooth: no step in the view's direction bigger than 1° a frame.
    for (let k = 1; k < frames.length; k++) {
      expect(Math.abs(angleDelta(viewYaw(frames[k - 1].pose), viewYaw(frames[k].pose)))).toBeLessThan(Math.PI / 180);
      expect(Math.abs(viewPitch(frames[k - 1].pose) - viewPitch(frames[k].pose))).toBeLessThan(Math.PI / 180);
    }
  });

  it("skips the countdown's shot on any input, easing to the chase, and doesn't bring it back", () => {
    const { chase, input, beat, cue } = standing();
    const d = new CameraDirector();
    for (let t = 0; t < 0.3; t += DT) {
      cue.introLeft = 2.4 - t;
      d.update(chase.update(input, DT), beat, DT);
    }
    expect(d.weight).toBeGreaterThan(0.9);
    beat.input = true;
    d.update(chase.update(input, DT), beat, DT);
    beat.input = false;
    for (let t = 0; t < T.skipTime + 0.05; t += DT) {
      cue.introLeft -= DT;
      d.update(chase.update(input, DT), beat, DT);
    }
    expect(d.beat).toBe("none");
    const c = chase.update(input, DT);
    expect(d.update(c, beat, DT)).toBe(c);
  });

  it("holds the chase through the countdown under reduced motion (the Steady camera)", () => {
    const { chase, input, beat } = standing();
    beat.reducedMotion = true;
    const d = new CameraDirector();
    const c = chase.update(input, DT);
    expect(d.update(c, beat, DT)).toBe(c);
  });

  it("frames an errand's two-shot in the band the sheet leaves clear, wide and on a phone", () => {
    for (const [w, h, band] of [
      [1920, 1080, { yLo: -0.1, yHi: 0.75, x: 0.6 }],
      [390, 844, { yLo: -0.07, yHi: 0.4, x: 0.75 }],
    ] as const) {
      const { chase, input, beat, cue } = standing(w / h);
      cue.status = "live";
      // The ally 120 ahead of the hero (Bearson on his roof).
      const ally = { x: 0, y: 300, z: 120 };
      beat.mode = "errand";
      beat.ally = ally;
      beat.goal = { x: 3000, y: 300, z: 0 };
      input.goal = null;
      const d = new CameraDirector();
      d.cut();
      let pose = d.update(chase.update(input, DT), beat, DT);
      // On the teleport's cut it starts on the shot.
      expect(d.weight).toBe(1);
      for (let t = 0; t < 3; t += DT) pose = d.update(chase.update(input, DT), beat, DT);
      for (const body of [input.hero, ally]) {
        for (const dy of [-T.errandBody * 0.8, T.errandBody * 0.8]) {
          const p = ndc({ x: body.x, y: body.y + dy, z: body.z }, pose, w, h);
          expect(p.behind).toBe(false);
          expect(p.y).toBeGreaterThan(band.yLo);
          expect(p.y).toBeLessThan(band.yHi);
          expect(Math.abs(p.x)).toBeLessThan(band.x);
        }
      }
      // From a 3/4 angle: neither body hides the other.
      const a = ndc(input.hero, pose, w, h);
      const b = ndc(ally, pose, w, h);
      expect(Math.abs(a.x - b.x)).toBeGreaterThan(0.15);
    }
  });

  it("eases an errand's shot in without a cut, back out when it's done, and gives way to input for the rest of it", () => {
    const { chase, input, beat, cue } = standing();
    cue.status = "live";
    beat.mode = "errand";
    beat.ally = { x: 0, y: 300, z: 120 };
    input.goal = null;
    const d = new CameraDirector();
    d.update(chase.update(input, DT), beat, DT);
    expect(d.weight).toBeLessThan(0.05);
    for (let t = 0; t < T.errandIn; t += DT) d.update(chase.update(input, DT), beat, DT);
    expect(d.weight).toBeGreaterThan(0.99);
    // Done: back to the chase over `errandOut`, smoothly.
    beat.mode = "travel";
    beat.ally = null;
    let last = d.weight;
    for (let t = 0; t < T.errandOut + 0.05; t += DT) {
      d.update(chase.update(input, DT), beat, DT);
      expect(d.weight).toBeLessThanOrEqual(last + 1e-9);
      last = d.weight;
    }
    expect(d.beat).toBe("none");
    // A new errand, and the player looks around: the shot goes and stays gone.
    beat.mode = "errand";
    beat.ally = { x: 0, y: 300, z: 120 };
    for (let t = 0; t < 1; t += DT) d.update(chase.update(input, DT), beat, DT);
    beat.input = true;
    d.update(chase.update(input, DT), beat, DT);
    beat.input = false;
    for (let t = 0; t < 2; t += DT) d.update(chase.update(input, DT), beat, DT);
    expect(d.beat).toBe("none");
  });

  it("ends the night with a slow crane up and back that starts on the chase's own pose", () => {
    const { chase, input, beat, cue } = standing();
    cue.status = "live";
    const d = new CameraDirector();
    for (let t = 0; t < 1; t += DT) d.update(chase.update(input, DT), beat, DT);
    cue.status = "outro";
    const c = chase.update(input, DT);
    const before = copy(c);
    const first = copy(d.update(c, beat, DT));
    expect(Math.hypot(first.position.x - before.position.x, first.position.y - before.position.y, first.position.z - before.position.z)).toBeLessThan(1);
    let pose = first;
    for (let t = 0; t < 4; t += DT) {
      cue.status = t < 1.4 ? "outro" : "done";
      pose = copy(d.update(chase.update(input, DT), beat, DT));
    }
    expect(pose.position.y).toBeGreaterThan(first.position.y + 150);
    expect(Math.hypot(pose.position.x - input.hero.x, pose.position.z - input.hero.z)).toBeGreaterThan(450);
    // The spot where the night ended sits low in the frame.
    const spot = ndc({ x: 0, y: 330, z: 0 }, pose, 1920, 1080);
    expect(spot.y).toBeLessThan(-0.15);
    expect(Math.abs(spot.x)).toBeLessThan(0.1);
  });

  it("keeps every beat's camera out of the city", () => {
    // A tall slab right behind the hero's back, where the countdown's shot would go.
    const city: City = {
      seed: 1,
      bounds: { x0: -3000, z0: -3000, x1: 3000, z1: 3000 },
      buildings: [{ id: 0, x0: -600, z0: -500, x1: 600, z1: -200, h: 3000, top: null, district: "sector-7", tone: 0, accent: false, seed: 1 }],
      props: [],
      anchors: [],
      zones: [],
      river: null,
      bridge: null,
      start: { x: 0, y: 300, z: 0 },
    };
    const cast = createLocalRaycast(city);
    const { input, beat, cue } = standing();
    const chase = new ChaseCamera(cast);
    const d = new CameraDirector(cast);
    const inside = (p: Vec3) => p.x > -600 && p.x < 600 && p.y < 3000 && p.z > -500 && p.z < -200;
    for (let t = 0; t < 2.4; t += DT) {
      cue.introLeft = 2.4 - t;
      expect(inside(d.update(chase.update(input, DT), beat, DT).position)).toBe(false);
    }
  });

  it("eases with zero speed at both ends", () => {
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(0.5)).toBeCloseTo(0.5);
    expect(smootherstep(0.01)).toBeLessThan(0.0001);
  });
});
