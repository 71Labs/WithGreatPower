import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Group, Vector3 } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import { assetFromScene, HERO_MODEL, type HeroAsset } from "../hero-asset";
import { rigFromAsset } from "../hero-rig";
import type { AnimContext } from "./types";
import { SandwichAnimator } from "./villains";
import { CLIMB } from "./wall-pose";

/**
 * Sandwich Man up a facade as Front-run's race has him (task-frontrun.ts: 26 off the face, 300 a
 * second, to just over the top), on a real MPFB body: a face at x = 0 facing −x with its roof at
 * 370, the street at 0. While he climbs every planted hand and foot is on the face and stays where
 * it was put, he faces the wall with his hips close to it, and no hand goes over the roof's edge.
 */

const DT = 1 / 60;
const TOP = 370;
const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

async function parse(url: string) {
  const file = readFileSync(fileURLToPath(new URL(`../../../../../public${url}`, import.meta.url)));
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), "");
}

describe("Sandwich Man's climb", () => {
  let asset: HeroAsset;
  // The building is x > 0; he climbs its west face from the street.
  const ctx: AnimContext = {
    ground: (x, _z, y) => (x > 0 && y >= TOP ? TOP : 0),
    ray: (o, d) => (d.x > 0.5 && o.x < 0 && o.y < TOP ? -o.x / d.x : null),
    reducedMotion: false,
    secondary: true,
    hero: v(-300, 0, 0),
  };

  beforeAll(async () => {
    asset = assetFromScene((await parse(HERO_MODEL.hi)).scene, HERO_MODEL.hi);
  });

  it("goes up hand over hand: planted limbs on the face and still, facing it, nothing over the top", () => {
    const rig = rigFromAsset(asset, 88);
    const group = new Group();
    group.add(rig.bones[0]);
    const anim = new SandwichAnimator(rig, group);
    const pos = v(-26, 44, 0);
    // The race turns him the way on over the top, a little askew of the wall: he squares up to it himself.
    const facing = v(0.926, 0, -0.377);
    // A beat standing at the wall's foot, then up it.
    for (let i = 0; i < 20; i++) anim.update({ pos, vel: v(), facing, state: "idle", stateTicks: i }, DT, ctx);

    let planted = 0;
    let moved = 0;
    let slide = 0;
    let worstGap = 0;
    let highestHand = -Infinity;
    let prev: { on: boolean[]; at: Vector3[] } | null = null;
    const steps = Math.round((TOP + 14) / 300 / DT);
    for (let i = 0; i < steps; i++) {
      pos.y += 300 * DT;
      anim.update({ pos, vel: v(0, 300, 0), facing, state: "climb", stateTicks: i }, DT, ctx);
      const on = anim.climbing();
      if (!on) {
        prev = null;
        continue;
      }
      const at = [anim.pose.hand[0], anim.pose.hand[1], anim.pose.foot[0], anim.pose.foot[1]].map((p) => p.clone());
      const gap = [CLIMB.handGap, CLIMB.handGap].map((g, k) => Math.abs(-at[k].x - g));
      for (let k = 0; k < 4; k++) {
        if (!on[k]) {
          moved++;
          continue;
        }
        planted++;
        // A hand held down on the lip slides along nothing; below the lip a planted limb is where it was.
        const lip = k < 2 && at[k].y > TOP - 3;
        if (k < 2) worstGap = Math.max(worstGap, gap[k]);
        if (prev?.on[k] && !lip) slide = Math.max(slide, at[k].distanceTo(prev.at[k]));
      }
      highestHand = Math.max(highestHand, at[0].y, at[1].y);
      prev = { on, at };
      // He faces the wall, hips nearer to it than his centre.
      const fwd = new Vector3(0, 0, 1).applyQuaternion(anim.pose.rot);
      expect(fwd.x).toBeGreaterThan(0.9);
    }
    expect(planted).toBeGreaterThan(100);
    // He really climbs: limbs leave their holds to reach for the next ones.
    expect(moved).toBeGreaterThan(40);
    expect(worstGap).toBeLessThan(0.01);
    expect(slide).toBeLessThan(0.01);
    expect(highestHand).toBeLessThanOrEqual(TOP);

    // Off the top: the climb lets go within a few frames.
    for (let i = 0; i < 30; i++) anim.update({ pos: v(40, TOP + 44, 0), vel: v(), facing, state: "idle", stateTicks: i }, DT, ctx);
    expect(anim.climbing()).toBeNull();
  });
});
