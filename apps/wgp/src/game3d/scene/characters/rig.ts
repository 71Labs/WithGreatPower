/**
 * The characters' skeleton: one humanoid layout (root, hips, spine, chest, neck, head, two
 * arms with clavicles, two legs) built from a `BodySpec`, plus optional extra bones (Gas
 * Goblin's glider). Every bone rests with an identity rotation and its offset from the
 * parent, so a bone's own axis is the direction to its child and posing is "swing this bone
 * from its rest axis to that direction".
 *
 * The bind pose is an A-pose: arms angled down and out, legs straight. Units are world
 * units (the hero is ~88 tall), +Y up, the character faces +Z, its left hand is on +X.
 */
import { Bone, Group, Matrix4, Quaternion, Skeleton, Vector3 } from "three";

export interface BodySpec {
  /** Ankle height above the soles. */
  ankle: number;
  shin: number;
  thigh: number;
  /** Hip joints sit this far either side of the centre line… */
  hipWidth: number;
  /** …and the pelvis bone this far above them. */
  pelvis: number;
  /** Pelvis → spine (waist), spine → chest, chest → neck base, neck base → head pivot. */
  waist: number;
  chest: number;
  neckBase: number;
  neck: number;
  /** Shoulder joints: height above the chest bone and distance from the centre line. */
  shoulderY: number;
  shoulderX: number;
  /** Clavicle start, as a fraction of shoulderX from the centre. */
  clavicleStart: number;
  upperArm: number;
  foreArm: number;
  hand: number;
  /** A-pose: the arms' angle down from horizontal (radians). */
  armDrop: number;
  /** Characters with no legs (The Sybil) still get leg bones; their mesh just skips them. */
  legs: boolean;
}

export type CoreBone =
  | "root"
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "clavL"
  | "armL"
  | "foreL"
  | "handL"
  | "clavR"
  | "armR"
  | "foreR"
  | "handR"
  | "thighL"
  | "shinL"
  | "footL"
  | "thighR"
  | "shinR"
  | "footR";

export interface ExtraBone {
  name: string;
  parent: CoreBone | string;
  /** Offset from the parent's joint, in bind space. */
  at: [number, number, number];
}

export const CORE_BONES: CoreBone[] = [
  "root",
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "clavL",
  "armL",
  "foreL",
  "handL",
  "clavR",
  "armR",
  "foreR",
  "handR",
  "thighL",
  "shinL",
  "footL",
  "thighR",
  "shinR",
  "footR",
];

/** Side: 0 = left (+X), 1 = right (−X). */
export type Side = 0 | 1;
export const SIDE_SIGN = [1, -1] as const;

export interface Limb {
  /** The limb's first bone (upper arm, thigh), its middle (forearm, shin) and end (hand, foot). */
  upper: Bone;
  lower: Bone;
  end: Bone;
  /** Its parent (clavicle, hips). */
  parent: Bone;
  l1: number;
  l2: number;
  /** Rest axes (unit, in each bone's own frame). */
  axis1: Vector3;
  axis2: Vector3;
}

export interface Rig {
  spec: BodySpec;
  bones: Bone[];
  index: Map<string, number>;
  get(name: CoreBone | string): Bone;
  skeleton: Skeleton;
  /** Bind-space joint positions by bone name. */
  joints: Map<string, Vector3>;
  /** Rest local positions, for resetting after a pose moved a bone. */
  rest: Vector3[];
  arms: [Limb, Limb];
  legs: [Limb, Limb];
  /** Pelvis height above the soles at rest. */
  hipHeight: number;
  /** Top of the head above the soles (filled by the mesh builder from the head shape). */
  height: number;
}

export function createRig(spec: BodySpec, extras: ExtraBone[] = [], height = 88): Rig {
  const bones: Bone[] = [];
  const index = new Map<string, number>();
  const joints = new Map<string, Vector3>();
  const add = (name: string, parent: string | null, x: number, y: number, z: number) => {
    const b = new Bone();
    b.name = name;
    b.position.set(x, y, z);
    if (parent) bones[index.get(parent)!].add(b);
    index.set(name, bones.length);
    bones.push(b);
    const base = parent ? joints.get(parent)! : new Vector3();
    joints.set(name, base.clone().add(new Vector3(x, y, z)));
    return b;
  };
  const s = spec;
  const hipJoint = s.ankle + s.shin + s.thigh;
  const hipHeight = hipJoint + s.pelvis;
  add("root", null, 0, 0, 0);
  add("hips", "root", 0, hipHeight, 0);
  add("spine", "hips", 0, s.waist, 0);
  add("chest", "spine", 0, s.chest, 0);
  add("neck", "chest", 0, s.neckBase, 0);
  add("head", "neck", 0, s.neck, 0);
  const dropX = Math.cos(s.armDrop);
  const dropY = -Math.sin(s.armDrop);
  for (const [side, sign] of [
    ["L", 1],
    ["R", -1],
  ] as const) {
    const cx = s.shoulderX * s.clavicleStart;
    add(`clav${side}`, "chest", sign * cx, s.shoulderY, 0);
    add(`arm${side}`, `clav${side}`, sign * (s.shoulderX - cx), 0, 0);
    add(`fore${side}`, `arm${side}`, sign * dropX * s.upperArm, dropY * s.upperArm, 0);
    add(`hand${side}`, `fore${side}`, sign * dropX * s.foreArm, dropY * s.foreArm, 0);
  }
  for (const [side, sign] of [
    ["L", 1],
    ["R", -1],
  ] as const) {
    add(`thigh${side}`, "hips", sign * s.hipWidth, -s.pelvis, 0);
    add(`shin${side}`, `thigh${side}`, 0, -s.thigh, 0);
    add(`foot${side}`, `shin${side}`, 0, -s.shin, 0);
  }
  for (const e of extras) add(e.name, e.parent, e.at[0], e.at[1], e.at[2]);

  const get = (name: string) => {
    const i = index.get(name);
    if (i === undefined) throw new Error(`no bone ${name}`);
    return bones[i];
  };
  // Bind: the skeleton's inverses from the rest pose at the origin.
  const holder = new Group();
  holder.add(bones[0]);
  holder.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  holder.remove(bones[0]);

  const limb = (upper: string, lower: string, end: string, parent: string): Limb => {
    const u = get(upper);
    const l = get(lower);
    const e = get(end);
    return {
      upper: u,
      lower: l,
      end: e,
      parent: get(parent),
      l1: l.position.length(),
      l2: e.position.length(),
      axis1: l.position.clone().normalize(),
      axis2: e.position.clone().normalize(),
    };
  };
  return {
    spec,
    bones,
    index,
    get,
    skeleton,
    joints,
    rest: bones.map((b) => b.position.clone()),
    arms: [limb("armL", "foreL", "handL", "clavL"), limb("armR", "foreR", "handR", "clavR")],
    legs: [limb("thighL", "shinL", "footL", "hips"), limb("thighR", "shinR", "footR", "hips")],
    hipHeight,
    height,
  };
}

/** A standard heroic body, ~88 tall (5.3 heads), for scaling into the rest of the cast. */
export const HERO_BODY: BodySpec = {
  ankle: 3.5,
  shin: 19.5,
  thigh: 20,
  hipWidth: 5.4,
  pelvis: 2,
  waist: 7,
  chest: 9,
  neckBase: 7,
  neck: 3.2,
  shoulderY: 4.6,
  shoulderX: 12.2,
  clavicleStart: 0.25,
  upperArm: 15,
  foreArm: 13.5,
  hand: 6,
  armDrop: 0.95,
  legs: true,
};

/** Scale every length of a body (and override any). */
export function scaleBody(base: BodySpec, k: number, over: Partial<BodySpec> = {}): BodySpec {
  const out = { ...base };
  for (const key of Object.keys(out) as (keyof BodySpec)[]) {
    const v = out[key];
    if (typeof v === "number" && key !== "armDrop" && key !== "clavicleStart") (out as Record<string, number | boolean>)[key] = v * k;
  }
  return { ...out, ...over };
}

/* ------------------------------------------------------------------ posing helpers */

const _m = new Matrix4();
const _q = new Quaternion();
const _qi = new Quaternion();
const _v = new Vector3();

/** A bone's world rotation, read from its world matrix (bones carry no scale). */
export function worldQuat(bone: Bone, out: Quaternion): Quaternion {
  return out.setFromRotationMatrix(_m.extractRotation(bone.matrixWorld));
}

/** A bone's world position. */
export function worldPos(bone: Bone, out: Vector3): Vector3 {
  return out.setFromMatrixPosition(bone.matrixWorld);
}

/**
 * Swing `bone` (whose parent's world rotation is `parentWorld`) so its rest axis points
 * along the world direction `dir`. Writes the bone's new world rotation to `outWorld`.
 * A pure swing, so a limb never twists against its parent.
 */
export function aimBone(bone: Bone, axis: Vector3, parentWorld: Quaternion, dir: Vector3, outWorld: Quaternion): Quaternion {
  _qi.copy(parentWorld).invert();
  _v.copy(dir).applyQuaternion(_qi);
  const len = _v.length();
  if (len < 1e-6) bone.quaternion.identity();
  else bone.quaternion.setFromUnitVectors(axis, _v.multiplyScalar(1 / len));
  return outWorld.copy(parentWorld).multiply(bone.quaternion);
}

/** Give `bone` the world rotation `world` under a parent with world rotation `parentWorld`. */
export function setWorldQuat(bone: Bone, parentWorld: Quaternion, world: Quaternion): void {
  _q.copy(parentWorld).invert();
  bone.quaternion.copy(_q).multiply(world);
}
