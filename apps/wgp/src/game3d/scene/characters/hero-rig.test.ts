import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Group, Matrix4, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";

import { MotionLayer } from "./anim/motion";
import { applyPose, newPose, newSolved, type Pose } from "./anim/pose";
import { assetFromScene, clipsFromGltf, heroGeometry, heroScale, HERO_ANIMS, HERO_MODEL, type HeroAsset } from "./hero-asset";
import { rigFromAsset } from "./hero-rig";
import type { Rig } from "./rig";

const HEIGHT = 88;

async function parse(url: string) {
  const file = readFileSync(fileURLToPath(new URL(`../../../../public${url}`, import.meta.url)));
  const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  return new GLTFLoader().parseAsync(buf, "");
}

async function load(url: string): Promise<HeroAsset> {
  return assetFromScene((await parse(url)).scene, url);
}

/** A pose that should reproduce the bind pose: no turns, every limb aimed at its rest joints. */
function restPose(rig: Rig): Pose {
  const p = newPose();
  const j = (n: string) => rig.joints.get(n)!;
  p.hand[0].copy(j("handL"));
  p.hand[1].copy(j("handR"));
  p.foot[0].copy(j("footL"));
  p.foot[1].copy(j("footR"));
  const side = (u: string, m: string, e: string) => {
    const d = j(e).clone().sub(j(u)).normalize();
    const v = j(m).clone().sub(j(u));
    return v.addScaledVector(d, -v.dot(d)).normalize();
  };
  p.elbow[0].copy(side("armL", "foreL", "handL"));
  p.elbow[1].copy(side("armR", "foreR", "handR"));
  p.knee[0].copy(side("thighL", "shinL", "footL"));
  p.knee[1].copy(side("thighR", "shinR", "footR"));
  return p;
}

describe("the hero's MPFB rig", () => {
  let asset: HeroAsset;
  let rig: Rig;
  const group = new Group();

  beforeAll(async () => {
    asset = await load(HERO_MODEL.hi);
    rig = rigFromAsset(asset, HEIGHT);
    group.add(rig.bones[0]);
    group.updateMatrixWorld(true);
  });

  it("is the game's height, with game names on the MPFB bones", () => {
    expect(asset.bones).toHaveLength(53);
    expect(asset.bones[0].parent).toBe(-1);
    expect(asset.bones.every((b, i) => b.parent < i)).toBe(true);
    expect(heroScale(asset, HEIGHT) * asset.height).toBeCloseTo(HEIGHT, 6);
    expect(rig.get("foreL").name).toBe("lowerarm_l");
    expect(rig.get("hips").name).toBe("pelvis");
    expect(rig.hipHeight).toBeGreaterThan(44);
    expect(rig.hipHeight).toBeLessThan(52);
    expect(rig.spec.ankle).toBeGreaterThan(2);
    expect(rig.fingers?.[0]).toHaveLength(15);
  });

  it("holds the bind pose when posed at rest (so the skin stays put)", () => {
    applyPose(rig, group, restPose(rig));
    group.updateMatrixWorld(true);
    rig.skeleton.update();
    const m = new Matrix4();
    let worst = 0;
    for (let i = 0; i < rig.bones.length; i++) {
      // Skinning matrix = world · inverse bind: the identity at rest.
      m.multiplyMatrices(rig.bones[i].matrixWorld, rig.skeleton.boneInverses[i]);
      const e = m.elements;
      const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      // Fingers are posed (relaxed), so compare everything but them.
      if (/^(thumb|index|middle|ring|pinky)_/.test(rig.bones[i].name)) continue;
      for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(e[k] - id[k]) * (k >= 12 ? 0.01 : 1));
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it("reaches IK targets and bends elbows and knees only on their hinges", () => {
    const p = restPose(rig);
    const solved = newSolved();
    const shoulder = rig.joints.get("armR")!.clone();
    p.hand[1].copy(shoulder).add(new Vector3(-6, 22, 4));
    p.elbow[1].set(-1, -0.2, 0.2);
    p.foot[0].add(new Vector3(0, 14, 8));
    applyPose(rig, group, p, solved);
    group.updateMatrixWorld(true);
    const at = new Vector3();
    expect(at.setFromMatrixPosition(rig.get("handR").matrixWorld).distanceTo(p.hand[1])).toBeLessThan(1e-3);
    expect(at.setFromMatrixPosition(rig.get("footL").matrixWorld).distanceTo(p.foot[0])).toBeLessThan(1e-3);
    for (const limb of [...rig.arms, ...rig.legs]) {
      // The lower bone's turn from rest is about the hinge (in the upper bone's frame).
      const rest = rig.restQ[rig.index.get(limb.lower.name)!];
      const turn = limb.lower.quaternion.clone().multiply(rest.clone().invert());
      const axis = new Vector3(turn.x, turn.y, turn.z);
      if (axis.length() < 1e-4) continue;
      const hinge = new Vector3(1, 0, 0).applyQuaternion(limb.hinge!);
      expect(Math.abs(axis.normalize().dot(hinge))).toBeGreaterThan(0.999);
    }
  });

  it("closes the fingers into a fist", () => {
    const p = restPose(rig);
    p.grip[1] = 1;
    applyPose(rig, group, p);
    const joint = rig.fingers![1].find((f) => f.bone.name === "index_02_r")!;
    expect(joint.bone.quaternion.angleTo(joint.fist)).toBeLessThan(1e-6);
    expect(joint.bone.quaternion.angleTo(new Quaternion().copy(rig.restQ[rig.index.get("index_02_r")!]))).toBeGreaterThan(1.5);
  });

  it("builds the game geometry with the shader's attributes", () => {
    const g = heroGeometry(asset, heroScale(asset, HEIGHT));
    for (const name of ["aWebP", "aWebQ", "aWebR", "aAO", "aHull", "skinIndex", "skinWeight"]) expect(g.getAttribute(name)).toBeTruthy();
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeCloseTo(HEIGHT, 3);
    expect(g.getIndex()!.count / 3).toBeLessThanOrEqual(16000);
  });

  it("has a lighter file for the low tier", async () => {
    const lo = await load(HERO_MODEL.lo);
    expect(lo.geometry.getIndex()!.count / 3).toBeLessThan(6000);
    expect(lo.bones.map((b) => b.name)).toEqual(asset.bones.map((b) => b.name));
  });

  it("plays the retargeted clips: feet on the roof, strides measured, every cycle in order", async () => {
    const clips = clipsFromGltf((await parse(HERO_ANIMS)).animations);
    for (const name of ["idle", "walk", "jog", "sprint", "land", "hit-chest", "jab", "death"]) expect(clips.has(name)).toBe(true);
    const motion = new MotionLayer(clips, rigFromAsset(asset, HEIGHT), heroScale(asset, HEIGHT), ["idle", "idle-talk", "walk", "jog", "sprint", "jump-loop"]);
    const [walk, jog, sprint] = ["walk", "jog", "sprint"].map((n) => motion.strides.get(n)!);
    // Captured at human paces (46.7 units a metre): a walk near 1 m/s, the runs near 5.
    expect(walk.speed).toBeGreaterThan(30);
    expect(walk.speed).toBeLessThan(90);
    for (const run of [jog, sprint]) {
      expect(run.speed).toBeGreaterThan(150);
      expect(run.speed).toBeLessThan(350);
    }
    // The sprint turns over faster: shorter strides at the same foot speed.
    expect(sprint.stride).toBeLessThan(jog.stride);
    // Standing and walking soles sit on the rest pose's (within a centimetre or two).
    expect(Math.abs(motion.floorOf("idle"))).toBeLessThan(1);
    expect(Math.abs(motion.floorOf("walk"))).toBeLessThan(1);
  });
});
