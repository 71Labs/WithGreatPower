import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Group, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";

import type { RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import { assetFromScene, clipsFromGltf, heroScale, HERO_ANIMS, HERO_MODEL, type HeroAsset, type HeroClips } from "../hero-asset";
import { rigFromAsset } from "../hero-rig";
import { HeroAnimator } from "./hero";
import { MotionLayer } from "./motion";
import type { AnimContext } from "./types";

/**
 * The hero on his feet, measured on the real body and clips: the feet (and knees) stay on
 * their own sides of the hips' midline in every clip frame and through standing, starts,
 * stops, reversals, sideways starts, turns on the spot and landings; he faces where he runs;
 * and his feet stay put while he stands.
 */

const HEIGHT = 88;
const ROOF = 300;
const DT = 1 / 60;
/** The sim's roof running (ruleset 2): top speed, the push from a standstill easing off near it, the brake. */
const RUN_TOP = 390;
const RUN_ACCEL = 1900;
const RUN_BRAKE = 2200;

async function parse(url: string) {
  const file = readFileSync(fileURLToPath(new URL(`../../../../../public${url}`, import.meta.url)));
  return new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), "");
}

const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** One leg of a scripted run: the stick (a unit xz direction, or null to let go) for `secs`, or the sim's facing turned to a yaw. */
type Leg = { stick: [number, number] | null; secs: number; facing?: number; drop?: number };

/** Plays legs through a copy of the sim's roof running into a render frame. */
function* script(legs: Leg[], start: Vec3 = v(0, ROOF + 26, 0)): Generator<RenderFrame3D> {
  const f: RenderFrame3D = {
    tick: 0,
    alpha: 1,
    hero: { pos: { ...start }, vel: v(), anchor: null, grounded: true, hp: 1, maxHp: 1, fluid: 0, hurtFlash: 0, shield: false, facing: v(0, 0, 1), action: "idle", actionTicks: 0 },
    villains: [],
    hazards: [],
    stop: 0,
    mode: "travel",
    timeScale: 1,
  };
  const h = f.hero;
  let facing = 0;
  for (const leg of legs) {
    let vy = 0;
    if (leg.drop) {
      h.pos.y = ROOF + 26 + leg.drop;
      h.grounded = false;
    }
    for (let t = 0; t < leg.secs; t += DT) {
      const hs = Math.hypot(h.vel.x, h.vel.z);
      const [hx, hz] = leg.stick ?? (hs > 1 ? [h.vel.x / hs, h.vel.z / hs] : [0, 1]);
      if (h.grounded) {
        const target = leg.stick ? RUN_TOP : 0;
        const side = -h.vel.x * hz + h.vel.z * hx;
        let a = h.vel.x * hx + h.vel.z * hz;
        if (a < target) a = a < 0 ? Math.min(target, a + RUN_BRAKE * DT) : Math.min(target, a + RUN_ACCEL * (1 - 0.6 * Math.min(1, a / target)) * DT);
        else if (a > target) a = Math.max(target, a - RUN_BRAKE * DT);
        const sd = side > 0 ? Math.max(0, side - RUN_BRAKE * DT) : Math.min(0, side + RUN_BRAKE * DT);
        h.vel = v(hx * a - hz * sd, 0, hz * a + hx * sd);
      } else {
        vy -= 1750 * DT;
        h.pos.y += vy * DT;
        if (h.pos.y <= ROOF + 26) {
          h.pos.y = ROOF + 26;
          h.grounded = true;
        }
        h.vel = v(h.vel.x, h.grounded ? 0 : vy, h.vel.z);
      }
      h.pos.x += h.vel.x * DT;
      h.pos.z += h.vel.z * DT;
      // The sim's facing: toward the velocity at 12 rad/s, or turned on the spot.
      const want = leg.facing ?? (Math.hypot(h.vel.x, h.vel.z) > 30 ? Math.atan2(h.vel.x, h.vel.z) : facing);
      const d = Math.atan2(Math.sin(want - facing), Math.cos(want - facing));
      facing += Math.max(-12 * DT, Math.min(12 * DT, d));
      h.facing = v(Math.sin(facing), 0, Math.cos(facing));
      const action = !h.grounded ? "air" : Math.hypot(h.vel.x, h.vel.z) > 1 ? "run" : "idle";
      h.actionTicks = action === h.action ? (h.actionTicks ?? 0) + 1 : 0;
      h.action = action;
      f.tick++;
      yield f;
    }
  }
}

interface Sample {
  t: number;
  grounded: boolean;
  /** Ankles and knees across the hips' midline (left positive), along the ground. */
  left: number;
  right: number;
  knees: number;
  /** The hips' facing against the motion (1 straight ahead), and the ground speed. */
  ahead: number;
  speed: number;
  /** How fast each ankle moved over the roof this frame, if it's on it (else 0). */
  creep: [number, number];
}

describe("the hero's motion on his feet", () => {
  let asset: HeroAsset;
  let clips: HeroClips;
  const ground = () => ROOF;
  const ctx: AnimContext = { ground, ray: () => null, reducedMotion: false, secondary: true, hero: v() };

  beforeAll(async () => {
    asset = assetFromScene((await parse(HERO_MODEL.hi)).scene, HERO_MODEL.hi);
    const gltf = await parse(HERO_ANIMS);
    clips = clipsFromGltf(gltf.animations);
    const pelvis = gltf.scene.getObjectByName("pelvis");
    if (pelvis) clips.pelvisRest = [pelvis.position.x, pelvis.position.y, pelvis.position.z];
  });

  /** Run a script through a fresh animator on the real body, measuring every frame. */
  function play(frames: Generator<RenderFrame3D>): Sample[] {
    const rig = rigFromAsset(asset, HEIGHT);
    const group = new Group();
    group.add(rig.bones[0]);
    const anim = new HeroAnimator(rig, group, ctx);
    anim.setClips(clips, heroScale(asset, HEIGHT));
    const p = (b: (typeof rig.bones)[number]) => new Vector3().setFromMatrixPosition(b.matrixWorld);
    const out: Sample[] = [];
    const last = [new Vector3(), new Vector3()];
    let t = 0;
    for (const f of frames) {
      anim.update(f, DT, ctx);
      group.updateMatrixWorld(true);
      const hipL = p(rig.legs[0].upper);
      const hipR = p(rig.legs[1].upper);
      const side = hipL.clone().sub(hipR).setY(0).normalize();
      const mid = hipL.add(hipR).multiplyScalar(0.5);
      const across = (b: (typeof rig.bones)[number]) => p(b).sub(mid).dot(side);
      const ankles = [p(rig.legs[0].end), p(rig.legs[1].end)];
      const speed = Math.hypot(f.hero.vel.x, f.hero.vel.z);
      const creep: [number, number] = [0, 0];
      for (let i = 0; i < 2; i++) {
        if (ankles[i].y < ROOF + rig.spec.ankle + 0.3) creep[i] = Math.hypot(ankles[i].x - last[i].x, ankles[i].z - last[i].z) / DT;
        last[i].copy(ankles[i]);
      }
      out.push({
        t,
        grounded: f.hero.grounded,
        left: across(rig.legs[0].end),
        right: across(rig.legs[1].end),
        knees: across(rig.legs[0].lower) - across(rig.legs[1].lower),
        ahead: speed > 1 ? (-side.z * f.hero.vel.x + side.x * f.hero.vel.z) / speed : 1,
        speed,
        creep,
      });
      t += DT;
    }
    return out.slice(20);
  }

  /** On his feet the feet and knees never cross the midline (a hand's width of margin for the feet). */
  function uncrossed(s: Sample[]): void {
    const feet = s.filter((x) => x.grounded);
    expect(Math.min(...feet.map((x) => x.left))).toBeGreaterThan(1);
    expect(Math.max(...feet.map((x) => x.right))).toBeLessThan(-1);
    expect(Math.min(...feet.map((x) => x.knees))).toBeGreaterThan(2);
  }

  /** Seconds spent moving with the hips turned more than 90° from the motion. */
  const backwards = (s: Sample[]) => s.filter((x) => x.grounded && x.speed > 60 && x.ahead < 0).length * DT;

  it("keeps each foot on its own side in every clip frame (no mirrored legs in the retarget)", () => {
    const rig = rigFromAsset(asset, HEIGHT);
    const group = new Group();
    group.add(rig.bones[0]);
    const motion = new MotionLayer(clips, rig, heroScale(asset, HEIGHT), ["idle", "idle-talk", "walk", "jog", "sprint", "jump-loop"]);
    const p = (b: (typeof rig.bones)[number]) => new Vector3().setFromMatrixPosition(b.matrixWorld);
    for (const name of ["idle", "idle-talk", "walk", "jog", "sprint", "land", "jab", "cross", "hit-chest", "hit-head"]) {
      expect(motion.has(name)).toBe(true);
      for (let t = 0; t <= motion.duration(name); t += 1 / 30) {
        rig.bones.forEach((b, i) => {
          b.quaternion.copy(rig.restQ[i]);
          b.position.copy(rig.rest[i]);
        });
        motion.begin();
        motion.add(name, t, 1);
        motion.apply(1);
        group.updateMatrixWorld(true);
        const hipL = p(rig.legs[0].upper);
        const hipR = p(rig.legs[1].upper);
        const side = hipL.clone().sub(hipR).setY(0).normalize();
        const mid = hipL.add(hipR).multiplyScalar(0.5);
        expect(p(rig.legs[0].end).sub(mid).dot(side), `${name} at ${t.toFixed(2)} s`).toBeGreaterThan(1.5);
        expect(p(rig.legs[1].end).sub(mid).dot(side), `${name} at ${t.toFixed(2)} s`).toBeLessThan(-1.5);
      }
    }
  });

  it("stands still without drifting: feet planted, nothing creeping", () => {
    const s = play(script([{ stick: null, secs: 4 }]));
    uncrossed(s);
    expect(Math.max(...s.flatMap((x) => x.creep))).toBeLessThan(5);
  });

  it("turns his hips with him on the run (the clips' root never pins his facing)", () => {
    // Round in a circle at speed: the hips face along the circle all the way round.
    const legs: Leg[] = [{ stick: [0, 1], secs: 0.6 }];
    for (let k = 1; k <= 24; k++) legs.push({ stick: [Math.sin((k * Math.PI) / 12), Math.cos((k * Math.PI) / 12)], secs: 0.15 });
    const s = play(script(legs)).filter((x) => x.t > 0.6);
    uncrossed(s);
    expect(Math.min(...s.map((x) => x.ahead))).toBeGreaterThan(0.8);
  });

  it("walks, runs and stops facing ahead, then settles his feet without sliding them", () => {
    const s = play(
      script([
        { stick: null, secs: 0.5 },
        { stick: [0, 1], secs: 1.6 },
        { stick: null, secs: 2 },
      ]),
    );
    uncrossed(s);
    expect(backwards(s)).toBe(0);
    // Running flat out he faces straight down the line.
    expect(Math.min(...s.filter((x) => x.speed >= RUN_TOP - 1).map((x) => x.ahead))).toBeGreaterThan(0.97);
    // Stopped, a planted foot doesn't creep (a step's touch-down aside).
    const still = s.filter((x) => x.t > 2.6);
    expect(Math.max(...still.flatMap((x) => x.creep))).toBeLessThan(40);
  });

  it("turns round to run back (a pivot), never running backwards", () => {
    const s = play(
      script([
        { stick: [0, 1], secs: 1.2 },
        { stick: [0, -1], secs: 1.2 },
        { stick: null, secs: 1 },
        // Setting off the way he isn't facing.
        { stick: [0, 1], secs: 1 },
      ]),
    );
    uncrossed(s);
    // Each turn round leaves the hips behind the motion for a couple of frames at most.
    expect(backwards(s)).toBeLessThan(0.15);
    expect(Math.min(...s.filter((x) => x.speed > 200).map((x) => x.ahead))).toBeGreaterThan(-0.2);
  });

  it("turns to run sideways when the stick goes sideways, whatever the sim's facing", () => {
    // The sim keeps facing +z (as with the camera behind him) while the stick pushes him to the side.
    const s = play(
      script([
        { stick: null, secs: 0.8, facing: 0 },
        { stick: [1, 0], secs: 1, facing: 0 },
        { stick: null, secs: 0.8, facing: 0 },
        { stick: [-1, 0], secs: 1, facing: 0 },
        { stick: null, secs: 0.8, facing: 0 },
      ]),
    );
    uncrossed(s);
    expect(backwards(s)).toBeLessThan(0.15);
    expect(Math.min(...s.filter((x) => x.speed >= RUN_TOP - 1).map((x) => x.ahead))).toBeGreaterThan(0.97);
  });

  it("turns on the spot in steps, the feet never crossing", () => {
    const s = play(
      script([
        { stick: null, secs: 1, facing: 0 },
        { stick: null, secs: 1.5, facing: Math.PI / 2 },
        { stick: null, secs: 2, facing: -Math.PI / 2 },
        { stick: null, secs: 1.5, facing: 0 },
      ]),
    );
    uncrossed(s);
  });

  it("lands, absorbs it on bent knees with the feet on the roof, and stands", () => {
    const s = play(
      script([
        { stick: null, secs: 0.4 },
        { stick: null, secs: 2.2, drop: 230 },
      ]),
    );
    uncrossed(s);
    const after = s.filter((x) => x.grounded && x.t > 1);
    expect(Math.max(...after.flatMap((x) => x.creep))).toBeLessThan(40);
  });

  it("waits where he stands when nobody is steering, even if the sim's facing moves", () => {
    const rig = rigFromAsset(asset, HEIGHT);
    const group = new Group();
    group.add(rig.bones[0]);
    const anim = new HeroAnimator(rig, group, ctx);
    anim.setClips(clips, heroScale(asset, HEIGHT));
    const yawOfHips = () => {
      const l = new Vector3().setFromMatrixPosition(rig.legs[0].upper.matrixWorld);
      const r = new Vector3().setFromMatrixPosition(rig.legs[1].upper.matrixWorld);
      const side = l.sub(r);
      return Math.atan2(-side.z, side.x);
    };
    const turnTo = (controlled: boolean | undefined) => {
      let n = 0;
      for (const f of script([
        { stick: null, secs: 0.5, facing: 0 },
        { stick: null, secs: 2.5, facing: Math.PI / 2 },
      ])) {
        (f.hero as { controlled?: boolean }).controlled = controlled;
        anim.update(f, DT, ctx);
        group.updateMatrixWorld(true);
        n++;
      }
      return n > 0 ? yawOfHips() : 0;
    };
    expect(Math.abs(turnTo(false))).toBeLessThan(0.5);
    // Steered (or a sim that doesn't say), he turns to the facing it gives him.
    expect(Math.abs(turnTo(undefined) - Math.PI / 2)).toBeLessThan(0.5);
  });
});
