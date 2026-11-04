/**
 * A civilian's skeleton for the crowd: the 23 bones a passer-by moves (the trunk, head, arms
 * to the wrists, legs to the balls of the feet) out of the cast's 53, in game units, posed
 * straight into skinning matrices with plain forward kinematics. No three.js Bones, so a
 * crowd of a hundred costs a few small loops, not a scene graph.
 *
 * - The fingers were folded into the hands at export (launch/brand/hero/civilians.py), so
 *   the core bones skin the whole body; any other bone a file still names maps to its
 *   nearest core ancestor.
 * - Clips play as moves from this body's own rest pose, the way anim/motion.ts retargets the
 *   cast (bone = own rest · source rest⁻¹ · clip), the hips about this body's resting pelvis
 *   scaled by the ratio of the two hip heights.
 * - `floor` and `stride` measure a clip on this body once: how far its soles sit above the
 *   rest pose's (lower the body by that), and a walk's ground speed (move it by that, so the
 *   feet don't slide).
 */
import { Matrix4, Quaternion, Vector3 } from "three";

import type { HeroBone } from "../characters/hero-asset";
import type { ClipSample, CrowdClip } from "./clips";

/** The bones a crowd body poses, parents first. */
export const CROWD_BONES = [
  "Root",
  "pelvis",
  "spine_01",
  "spine_02",
  "spine_03",
  "neck_01",
  "head",
  "clavicle_l",
  "upperarm_l",
  "lowerarm_l",
  "hand_l",
  "clavicle_r",
  "upperarm_r",
  "lowerarm_r",
  "hand_r",
  "thigh_l",
  "calf_l",
  "foot_l",
  "ball_l",
  "thigh_r",
  "calf_r",
  "foot_r",
  "ball_r",
] as const;

export const CROWD_BONE_COUNT = CROWD_BONES.length;
/** Floats per pose block in the bone texture: a 4×4 matrix per bone. */
export const BLOCK_FLOATS = CROWD_BONE_COUNT * 16;

const PELVIS = CROWD_BONES.indexOf("pelvis");
const FOOT_L = CROWD_BONES.indexOf("foot_l");
const FOOT_R = CROWD_BONES.indexOf("foot_r");

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);

export interface SourceRest {
  /** The clips' skeleton: each bone's local rest rotation, and the pelvis's rest position (metres). */
  restQ?: Map<string, [number, number, number, number]>;
  pelvisRest?: [number, number, number];
}

export class CrowdSkeleton {
  /** Core parent per core bone (−1 for the root). */
  readonly parent: Int8Array;
  /** Rest local position (game units) and rotation per core bone. */
  readonly restP: Float32Array;
  readonly restQ: Float32Array;
  /** Per core bone, this rest · the source's rest⁻¹ (xyzw), or NaN where the source has none. */
  readonly fix: Float32Array;
  /** Inverse bind matrices (game units), 16 per core bone. */
  readonly bindInv: Float32Array;
  /** The file's joint index → core bone index (for the geometry's skinIndex). */
  readonly remap: Uint8Array;
  /** The resting pelvis, the source's (scaled), and the hip-height ratio. */
  readonly pelvisRest = new Vector3();
  readonly pelvisFrom = new Vector3();
  readonly hipK: number;
  /** Rest ankle height (game units). */
  readonly ankle: number;
  private readonly world: Float32Array;
  private readonly floors = new Map<string, number>();
  private readonly strides = new Map<string, number>();

  constructor(
    bones: HeroBone[],
    /** Metres to game units. */
    readonly k: number,
    source: SourceRest,
  ) {
    const n = CROWD_BONE_COUNT;
    const at = new Map<string, number>(bones.map((b, i) => [b.name, i]));
    const core = new Map<string, number>(CROWD_BONES.map((name, i) => [name, i]));
    for (const name of CROWD_BONES) if (!at.has(name)) throw new Error(`crowd skeleton: no bone ${name}`);
    this.parent = new Int8Array(n);
    this.restP = new Float32Array(n * 3);
    this.restQ = new Float32Array(n * 4);
    this.fix = new Float32Array(n * 4).fill(NaN);
    this.bindInv = new Float32Array(n * 16);
    this.world = new Float32Array(n * 16);
    // A core bone's parent is its nearest core ancestor.
    const coreAncestor = (i: number): number => {
      let j = bones[i].parent;
      while (j >= 0 && !core.has(bones[j].name)) j = bones[j].parent;
      return j < 0 ? -1 : core.get(bones[j].name)!;
    };
    CROWD_BONES.forEach((name, c) => {
      const b = bones[at.get(name)!];
      this.parent[c] = coreAncestor(at.get(name)!);
      if (c > 0 && this.parent[c] >= c) throw new Error(`crowd skeleton: ${name} before its parent`);
      this.restP.set([b.position[0] * k, b.position[1] * k, b.position[2] * k], c * 3);
      this.restQ.set(b.quaternion, c * 4);
      const src = source.restQ?.get(name);
      if (src) {
        _q.fromArray(b.quaternion).multiply(new Quaternion(...src).invert());
        _q.toArray(this.fix, c * 4);
      }
    });
    // Each file joint skins with its own core bone, or its nearest core ancestor.
    this.remap = new Uint8Array(bones.length);
    bones.forEach((b, i) => {
      this.remap[i] = core.has(b.name) ? core.get(b.name)! : Math.max(0, coreAncestor(i));
    });
    this.pelvisRest.fromArray(this.restP, PELVIS * 3);
    if (source.pelvisRest) this.pelvisFrom.fromArray(source.pelvisRest).multiplyScalar(k);
    else this.pelvisFrom.copy(this.pelvisRest);
    this.hipK = this.pelvisRest.length() / Math.max(1e-6, this.pelvisFrom.length());
    // The rest pose, and its inverse as the bind.
    this.fk(null);
    for (let c = 0; c < n; c++) _m.fromArray(this.world, c * 16).invert().toArray(this.bindInv, c * 16);
    this.ankle = Math.min(this.world[FOOT_L * 16 + 13], this.world[FOOT_R * 16 + 13]);
  }

  /** Model-space matrices for a clip sample (or the rest pose) into `world`. */
  private fk(sample: ClipSample | null): void {
    const w = this.world;
    for (let c = 0; c < CROWD_BONE_COUNT; c++) {
      if (sample && sample.has[c] && !Number.isNaN(this.fix[c * 4])) {
        _q.fromArray(sample.q, c * 4).premultiply(QF.fromArray(this.fix, c * 4));
      } else _q.fromArray(this.restQ, c * 4);
      if (sample && c === PELVIS && sample.pelvisW > 0) {
        // The clip's hips about this body's own, scaled to its legs (anim/motion.ts).
        _p.fromArray(sample.pelvis).multiplyScalar(this.k).sub(this.pelvisFrom).multiplyScalar(this.hipK).add(this.pelvisRest);
      } else _p.fromArray(this.restP, c * 3);
      _m.compose(_p, _q, _s);
      const parent = this.parent[c];
      if (parent >= 0) multiplyInto(w, parent * 16, _m.elements, w, c * 16);
      else _m.toArray(w, c * 16);
    }
  }

  /** Pose this body by one clip sample; its skinning matrices (world · bind⁻¹, 16 floats per core bone) go into `out` at `offset`. */
  pose(sample: ClipSample | null, out: Float32Array, offset: number): void {
    this.fk(sample);
    const w = this.world;
    for (let c = 0; c < CROWD_BONE_COUNT; c++) multiplyInto(w, c * 16, this.bindInv.subarray(c * 16, c * 16 + 16), out, offset + c * 16);
  }

  /** A bone's model-space position after the last pose (units). */
  joint(c: number, out: Vector3): Vector3 {
    return out.set(this.world[c * 16 + 12], this.world[c * 16 + 13], this.world[c * 16 + 14]);
  }

  /** How far this clip's lowest ankle sits above the rest pose's (units): lower the body by it. */
  floor(clip: CrowdClip, scratch: ClipSample): number {
    const have = this.floors.get(clip.name);
    if (have !== undefined) return have;
    let low = Infinity;
    for (let f = 0; f < clip.frames; f++) {
      clip.sampleFrame(f, scratch);
      this.fk(scratch);
      low = Math.min(low, this.world[FOOT_L * 16 + 13], this.world[FOOT_R * 16 + 13]);
    }
    const v = Number.isFinite(low) ? low - this.ankle : 0;
    this.floors.set(clip.name, v);
    return v;
  }

  /**
   * A walk's ground speed on this body (units/s): the planted foot's backward travel over
   * the frames it's down (within 4 units of the lowest), as anim/motion.ts measures it.
   */
  stride(clip: CrowdClip, scratch: ClipSample): number {
    const have = this.strides.get(clip.name);
    if (have !== undefined) return have;
    const L: Vector3[] = [];
    const R: Vector3[] = [];
    for (let f = 0; f < clip.frames; f++) {
      clip.sampleFrame(f, scratch);
      this.fk(scratch);
      L.push(this.joint(FOOT_L, new Vector3()));
      R.push(this.joint(FOOT_R, new Vector3()));
    }
    let low = Infinity;
    for (let f = 0; f < clip.frames; f++) low = Math.min(low, L[f].y, R[f].y);
    let dist = 0;
    let time = 0;
    for (let f = 0; f < clip.frames - 1; f++) {
      for (const foot of [L, R]) {
        if (foot[f].y > low + 4 || foot[f + 1].y > low + 4) continue;
        dist += foot[f].z - foot[f + 1].z;
        time += clip.dt;
      }
    }
    const v = time > 0 ? Math.max(10, dist / time) : 50;
    this.strides.set(clip.name, v);
    return v;
  }
}

const QF = new Quaternion();

/** out[oo..oo+16] = a[ao..ao+16] · b (column-major 4×4); `out` may be `a` at another block. */
export function multiplyInto(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, out: Float32Array, oo: number): void {
  const a11 = a[ao], a12 = a[ao + 4], a13 = a[ao + 8], a14 = a[ao + 12];
  const a21 = a[ao + 1], a22 = a[ao + 5], a23 = a[ao + 9], a24 = a[ao + 13];
  const a31 = a[ao + 2], a32 = a[ao + 6], a33 = a[ao + 10], a34 = a[ao + 14];
  const a41 = a[ao + 3], a42 = a[ao + 7], a43 = a[ao + 11], a44 = a[ao + 15];
  for (let j = 0; j < 4; j++) {
    const b1 = b[j * 4], b2 = b[j * 4 + 1], b3 = b[j * 4 + 2], b4 = b[j * 4 + 3];
    out[oo + j * 4] = a11 * b1 + a12 * b2 + a13 * b3 + a14 * b4;
    out[oo + j * 4 + 1] = a21 * b1 + a22 * b2 + a23 * b3 + a24 * b4;
    out[oo + j * 4 + 2] = a31 * b1 + a32 * b2 + a33 * b3 + a34 * b4;
    out[oo + j * 4 + 3] = a41 * b1 + a42 * b2 + a43 * b3 + a44 * b4;
  }
}
