/**
 * The game's `Rig` on the hero's MPFB skeleton (hero-asset.ts), so the hero's animator, the
 * ragdoll and the debug overlay drive it by the game's bone names.
 *
 * - Every length is scaled into game units (the body is `height` tall), so IK targets and
 *   hip offsets mean what they mean on the procedural cast.
 * - Game names alias the MPFB bones (`hips` is `pelvis`, `foreL` is `lowerarm_l`, …); the
 *   pose's spine turn is shared by spine_01 and spine_02.
 * - The bones rest with real rotations, so the rig keeps each one's rest rotation (local and
 *   in the model frame) for rig.ts's rest-relative writes, and each limb's hinge: the elbow
 *   or knee axis, from the bend of the rest pose.
 * - Fingers pose from relaxed to a fist with launch/brand/hero/posing.py's presets (curls
 *   about each finger bone's own x, a fan about z at the knuckle).
 * - The web fist sits where the header renders put it: between the index and pinky
 *   knuckles, a little into the palm and toward the fingers.
 */
import { Bone, Group, Matrix4, Quaternion, Skeleton, Vector3 } from "three";

import { heroScale, type HeroAsset } from "./hero-asset";
import { worldQuat, type BodySpec, type CoreBone, type FingerJoint, type Limb, type Rig } from "./rig";

/** Game bone → MPFB bone. */
export const HERO_ALIAS: Record<CoreBone, string> = {
  root: "Root",
  hips: "pelvis",
  spine: "spine_01",
  chest: "spine_03",
  neck: "neck_01",
  head: "head",
  clavL: "clavicle_l",
  armL: "upperarm_l",
  foreL: "lowerarm_l",
  handL: "hand_l",
  clavR: "clavicle_r",
  armR: "upperarm_r",
  foreR: "lowerarm_r",
  handR: "hand_r",
  thighL: "thigh_l",
  shinL: "calf_l",
  footL: "foot_l",
  thighR: "thigh_r",
  shinR: "calf_r",
  footR: "foot_r",
};

const FINGERS = ["index", "middle", "ring", "pinky"] as const;
const DEG = Math.PI / 180;

/** posing.py's hands: per finger (knuckle, middle, tip) curl in degrees, the thumb, the fan. */
const FIST = { curl: [[78, 100, 60], [84, 100, 60], [88, 100, 60], [92, 100, 60]], thumb: [0, -20, 30, 40], spread: -3 };
const OPEN = { curl: [[10, 14, 8], [12, 16, 10], [16, 18, 12], [20, 20, 14]], thumb: [5, -12, 10, 12], spread: 11 };

const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

export function rigFromAsset(asset: HeroAsset, height: number): Rig {
  const k = heroScale(asset, height);
  const bones = asset.bones.map((b) => {
    const bone = new Bone();
    bone.name = b.name;
    bone.position.fromArray(b.position).multiplyScalar(k);
    bone.quaternion.fromArray(b.quaternion);
    return bone;
  });
  asset.bones.forEach((b, i) => {
    if (b.parent >= 0) bones[b.parent].add(bones[i]);
  });
  const index = new Map<string, number>();
  bones.forEach((b, i) => index.set(b.name, i));
  for (const [game, mpfb] of Object.entries(HERO_ALIAS)) {
    const i = index.get(mpfb);
    if (i === undefined) throw new Error(`hero rig: no bone ${mpfb}`);
    index.set(game, i);
  }
  const get = (name: string) => {
    const i = index.get(name);
    if (i === undefined) throw new Error(`no bone ${name}`);
    return bones[i];
  };

  // Bind at the origin, and read the rest pose in the model frame.
  const holder = new Group();
  holder.add(bones[0]);
  holder.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  const joints = new Map<string, Vector3>();
  for (const [name, i] of index) joints.set(name, new Vector3().setFromMatrixPosition(bones[i].matrixWorld));
  const restQ = bones.map((b) => b.quaternion.clone());
  const restWorld = bones.map((b) => worldQuat(b, new Quaternion()));
  const parentRest = asset.bones.map((b) => (b.parent >= 0 ? restWorld[b.parent].clone() : new Quaternion()));
  holder.remove(bones[0]);

  const J = (name: string) => joints.get(name)!;
  const limb = (upper: string, lower: string, end: string, parent: string, endChild: string): Limb => {
    const u = get(upper);
    const l = get(lower);
    const e = get(end);
    const axis1 = l.position.clone().normalize();
    // The hinge: the rest pose's bend plane (root → end crossed with the side the joint
    // sits on), in the upper bone's frame.
    const s0 = J(upper);
    const d = J(end).clone().sub(s0).normalize();
    const m = J(lower).clone().sub(s0);
    const side = m.addScaledVector(d, -m.dot(d)).normalize();
    const h = new Vector3().crossVectors(d, side).applyQuaternion(restWorld[index.get(upper)!].clone().invert());
    h.addScaledVector(axis1, -h.dot(axis1)).normalize();
    const frame = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(h, axis1, new Vector3().crossVectors(h, axis1)));
    return {
      upper: u,
      lower: l,
      end: e,
      parent: get(parent),
      l1: l.position.length(),
      l2: e.position.length(),
      axis1,
      axis2: e.position.clone().normalize(),
      endAxis: get(endChild).position.clone().normalize(),
      hinge: frame,
    };
  };
  const arms: [Limb, Limb] = [limb("armL", "foreL", "handL", "clavL", "middle_01_l"), limb("armR", "foreR", "handR", "clavR", "middle_01_r")];
  const legs: [Limb, Limb] = [limb("thighL", "shinL", "footL", "hips", "ball_l"), limb("thighR", "shinR", "footR", "hips", "ball_r")];

  // Fingers: open and fist rotations per joint, rest included.
  const fingerQ = (rest: Quaternion, fan: number, curl: number) => rest.clone().multiply(new Quaternion().setFromAxisAngle(Z, fan * DEG)).multiply(new Quaternion().setFromAxisAngle(X, curl * DEG));
  const thumbQ = (rest: Quaternion, curl: number, swing: number) => rest.clone().multiply(new Quaternion().setFromAxisAngle(X, curl * DEG)).multiply(new Quaternion().setFromAxisAngle(Z, swing * DEG));
  const hand = (side: "l" | "r"): FingerJoint[] => {
    const sign = side === "l" ? 1 : -1;
    const out: FingerJoint[] = [];
    const add = (name: string, open: (r: Quaternion) => Quaternion, fist: (r: Quaternion) => Quaternion) => {
      const i = index.get(name);
      if (i === undefined) return;
      out.push({ bone: bones[i], open: open(restQ[i]), fist: fist(restQ[i]) });
    };
    FINGERS.forEach((f, n) => {
      for (let j = 0; j < 3; j++) {
        const fan = (spread: number) => (j === 0 ? ((spread * (1.5 - n)) / 1.5) * sign : 0);
        add(
          `${f}_0${j + 1}_${side}`,
          (r) => fingerQ(r, fan(OPEN.spread), OPEN.curl[n][j]),
          (r) => fingerQ(r, fan(FIST.spread), FIST.curl[n][j]),
        );
      }
    });
    add(`thumb_01_${side}`, (r) => thumbQ(r, OPEN.thumb[0], OPEN.thumb[1] * sign), (r) => thumbQ(r, FIST.thumb[0], FIST.thumb[1] * sign));
    add(`thumb_02_${side}`, (r) => thumbQ(r, OPEN.thumb[2], 0), (r) => thumbQ(r, FIST.thumb[2], 0));
    add(`thumb_03_${side}`, (r) => thumbQ(r, OPEN.thumb[3], 0), (r) => thumbQ(r, FIST.thumb[3], 0));
    return out;
  };

  // The web fist, in hand_r's frame (palm out along +z).
  const index1 = get("index_01_r").position;
  const pinky1 = get("pinky_01_r").position;
  const grip = index1.clone().add(pinky1).multiplyScalar(0.5).addScaledVector(Z, 0.022 * k).addScaledVector(index1, 0.15);

  const hips = J("hips");
  const thigh = J("thighL");
  const chest = J("chest");
  const shoulder = J("armL");
  const spec: BodySpec = {
    ankle: J("footL").y,
    shin: legs[0].l2,
    thigh: legs[0].l1,
    hipWidth: Math.abs(thigh.x),
    pelvis: hips.y - thigh.y,
    waist: J("spine").y - hips.y,
    chest: chest.y - J("spine").y,
    neckBase: J("neck").y - chest.y,
    neck: J("head").y - J("neck").y,
    shoulderY: shoulder.y - chest.y,
    shoulderX: Math.abs(shoulder.x),
    clavicleStart: Math.abs(J("clavL").x) / Math.abs(shoulder.x),
    upperArm: arms[0].l1,
    foreArm: arms[0].l2,
    hand: get("middle_01_l").position.length(),
    armDrop: Math.atan2(shoulder.y - J("foreL").y, Math.abs(J("foreL").x - shoulder.x)),
    legs: true,
  };

  return {
    spec,
    bones,
    index,
    get,
    skeleton,
    joints,
    rest: bones.map((b) => b.position.clone()),
    arms,
    legs,
    hipHeight: hips.y,
    height,
    spine: [index.get("spine_01")!, index.get("spine_02")!],
    identityRest: false,
    restQ,
    restWorld,
    parentRest,
    grip,
    gripReach: grip.length(),
    fingers: [hand("l"), hand("r")],
  };
}
