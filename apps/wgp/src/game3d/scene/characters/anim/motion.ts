/**
 * Motion capture under the hero's animator: real clips (Quaternius' UAL, retargeted onto the
 * MPFB skeleton by launch/brand/hero/retarget.py) sampled on the rig, blended, and laid over
 * the bones applyPose wrote, by a weight per state and a mask per bone.
 *
 * - `add` builds a normalized blend (idle, walk, jog, sprint); `over` lays a one-shot on
 *   top of it (a landing, a hit, a punch) by a fraction.
 * - Locomotion loops share one phase, aligned on the left foot's strike, so walk, jog and
 *   sprint blend stride for stride. Each loop's natural speed and stride are measured once
 *   here by running its frames through the rig and timing the planted foot, so the animator
 *   can advance the phase by distance and the feet never slide.
 * - Each loop's lowest foot is measured too: `floor` says how far its soles sit above the
 *   rest pose's, so the body can be lowered onto the roof by exactly that.
 */
import { Matrix4, Quaternion, Vector3 } from "three";

import { CLIP_FPS, type HeroClip, type HeroClips } from "../hero-asset";
import type { Rig } from "../rig";

interface Sampled {
  clip: HeroClip;
  loop: boolean;
  /** Per rig bone: local rotations per frame, or null. */
  rot: (Float32Array | null)[];
  /** The pelvis's local position per frame, game units, and where it sits on average (loops) or at the start. */
  pelvis: Float32Array | null;
  base: Vector3;
  /** Lowest ankle over the clip, above the rest pose's (game units). */
  floor: number;
}

/** A locomotion loop's measurements. */
export interface Stride {
  /** Ground speed it was captured at (units/s), and distance per cycle. */
  speed: number;
  stride: number;
  /** Phase (0–1) of the left foot's strike. */
  strike: number;
}

const _q = new Quaternion();
const _r = new Quaternion();
const _v = new Vector3();
const _u = new Vector3();
const _m = new Matrix4();

export class MotionLayer {
  /** The blend, per rig bone: local rotation and how much of it there is (0–1). */
  readonly q: Quaternion[];
  readonly w: Float32Array;
  readonly pelvis = new Vector3();
  /** The same, as a move from each clip's own resting hips (for a body on other legs). */
  readonly pelvisMove = new Vector3();
  pelvisW = 0;
  /** The blend's lowest ankle above rest (units): lower the body by this. */
  floor = 0;
  private floorW = 0;
  private readonly clips = new Map<string, Sampled>();
  readonly strides = new Map<string, Stride>();
  private readonly pelvisIndex: number;

  /**
   * `retarget`: play the clips on a body of other proportions than the one they were made
   * for (the hero's). Each bone then turns from its own rest rotation by as much as the
   * clip's bone turns from the source's (the same move in the bone's own frame, so a spine
   * curved differently at rest isn't bent to the hero's shape), and the hips move about this
   * rig's resting pelvis, scaled by the ratio of the two hip heights.
   */
  constructor(
    clips: HeroClips,
    private readonly rig: Rig,
    k: number,
    loops: string[],
    retarget = false,
  ) {
    this.q = rig.bones.map(() => new Quaternion());
    this.w = new Float32Array(rig.bones.length);
    this.pelvisIndex = rig.index.get("pelvis") ?? rig.index.get("hips")!;
    const rest = rig.rest[this.pelvisIndex];
    const from = retarget && clips.pelvisRest ? new Vector3(...clips.pelvisRest).multiplyScalar(k) : null;
    const hipK = from ? rest.length() / Math.max(1e-6, from.length()) : 1;
    // Per bone: this rig's rest · the source's rest⁻¹, laid in front of every clip rotation.
    const fix = rig.bones.map((b, i) => {
      const src = retarget ? clips.restQ?.get(b.name) : undefined;
      return src ? rig.restQ[i].clone().multiply(new Quaternion(...src).invert()) : null;
    });
    const cache = new Map<Float32Array, Float32Array>();
    for (const clip of clips.values()) {
      const rot = rig.bones.map((b, i) => {
        const data = clip.rot.get(b.name) ?? null;
        const f = fix[i];
        if (!data || !f) return data;
        let out = cache.get(data);
        if (!out) {
          out = new Float32Array(data.length);
          for (let j = 0; j < data.length; j += 4) _q.fromArray(data, j).premultiply(f).toArray(out, j);
          cache.set(data, out);
        }
        return out;
      });
      let pelvis = clip.pelvis ? clip.pelvis.map((x) => x * k) : null;
      if (pelvis && from) {
        const p = pelvis;
        for (let i = 0; i < p.length; i += 3) {
          p[i] = rest.x + (p[i] - from.x) * hipK;
          p[i + 1] = rest.y + (p[i + 1] - from.y) * hipK;
          p[i + 2] = rest.z + (p[i + 2] - from.z) * hipK;
        }
        pelvis = p;
      }
      const loop = loops.includes(clip.name);
      const base = new Vector3();
      if (pelvis) {
        const n = clip.frames;
        if (loop) {
          for (let f = 0; f < n; f++) base.add(_v.fromArray(pelvis, f * 3));
          base.divideScalar(n);
        } else base.fromArray(pelvis, 0);
      }
      const s: Sampled = { clip, loop, rot, pelvis, base, floor: 0 };
      this.clips.set(clip.name, s);
      // Only loops stand the body on the roof (the one-shots ride on top of them).
      if (loop) this.measure(s);
    }
    this.rest();
  }

  has(name: string): boolean {
    return this.clips.has(name);
  }

  /** A clip's lowest ankle above the rest pose's (units). */
  floorOf(name: string): number {
    return this.clips.get(name)?.floor ?? 0;
  }

  duration(name: string): number {
    return this.clips.get(name)?.clip.duration ?? 0;
  }

  begin(): void {
    this.w.fill(0);
    this.pelvisW = 0;
    this.floor = 0;
    this.floorW = 0;
  }

  /** Add a clip at time `t` to the normalized blend with weight `weight`. */
  add(name: string, t: number, weight: number): void {
    const s = this.clips.get(name);
    if (!s || weight <= 1e-4) return;
    this.mix(s, t, weight, false);
  }

  /** Lay a clip at time `t` over the blend by `frac` (0–1). */
  over(name: string, t: number, frac: number): void {
    const s = this.clips.get(name);
    if (!s || frac <= 1e-4) return;
    this.mix(s, t, Math.min(1, frac), true);
  }

  private mix(s: Sampled, t: number, weight: number, over: boolean): void {
    const n = s.clip.frames;
    let f = t * CLIP_FPS;
    if (s.loop) f = ((f % (n - 1)) + (n - 1)) % (n - 1);
    else f = Math.min(n - 1, Math.max(0, f));
    const i0 = Math.floor(f);
    const i1 = Math.min(n - 1, i0 + 1);
    const a = f - i0;
    for (let i = 0; i < s.rot.length; i++) {
      const data = s.rot[i];
      if (!data) continue;
      _q.fromArray(data, i0 * 4).slerp(_r.fromArray(data, i1 * 4), a);
      const have = this.w[i];
      if (have <= 0) {
        this.q[i].copy(_q);
        this.w[i] = weight;
      } else if (over) {
        this.q[i].slerp(_q, weight);
        this.w[i] = have + (1 - have) * weight;
      } else {
        this.q[i].slerp(_q, weight / (have + weight));
        this.w[i] = have + weight;
      }
    }
    if (s.pelvis) {
      _v.fromArray(s.pelvis, i0 * 3).lerp(_u.fromArray(s.pelvis, i1 * 3), a);
      _u.copy(_v).sub(s.base);
      if (this.pelvisW <= 0) {
        this.pelvis.copy(_v);
        this.pelvisMove.copy(_u);
      } else {
        const k = over ? weight : weight / (this.pelvisW + weight);
        this.pelvis.lerp(_v, k);
        this.pelvisMove.lerp(_u, k);
      }
      this.pelvisW = over ? this.pelvisW + (1 - this.pelvisW) * weight : this.pelvisW + weight;
    }
    if (this.floorW <= 0) this.floor = s.floor;
    else this.floor += (s.floor - this.floor) * (over ? weight : weight / (this.floorW + weight));
    this.floorW = over ? this.floorW + (1 - this.floorW) * weight : this.floorW + weight;
  }

  /**
   * Lay the blend over the rig's bones by `amount`, scaled per bone by `mask` (1 if omitted).
   * The hips take the clips' own height where their legs are used (`absolute` 1), or just
   * their move (a dip, a sway) on top of the pose's where the legs are the pose's (0); or stay
   * put (`hips` false: a pass for some limbs only).
   */
  apply(amount: number, mask?: Float32Array, absolute = 1, hips = true): void {
    if (amount <= 1e-4) return;
    const bones = this.rig.bones;
    for (let i = 0; i < bones.length; i++) {
      const w = Math.min(1, this.w[i]) * amount * (mask ? mask[i] : 1);
      if (w > 1e-4) bones[i].quaternion.slerp(this.q[i], w);
    }
    if (hips && this.pelvisW > 0) {
      const p = bones[this.pelvisIndex].position;
      _v.copy(p).add(this.pelvisMove).lerp(this.pelvis, absolute);
      p.lerp(_v, Math.min(1, this.pelvisW) * amount);
    }
  }

  /** Put one frame of a clip on the rig (the rest elsewhere), for measuring. */
  private pose(s: Sampled, frame: number): void {
    this.rest();
    const bones = this.rig.bones;
    for (let i = 0; i < bones.length; i++) if (s.rot[i]) bones[i].quaternion.fromArray(s.rot[i]!, frame * 4);
    if (s.pelvis) bones[this.pelvisIndex].position.fromArray(s.pelvis, frame * 3);
    const root = bones[0];
    root.updateMatrixWorld(true);
  }

  private rest(): void {
    const r = this.rig;
    r.bones.forEach((b, i) => {
      b.quaternion.copy(r.restQ[i]);
      b.position.copy(r.rest[i]);
    });
    r.bones[0].updateMatrixWorld(true);
  }

  /** A foot's position in the rig's own frame (the root's parent's). */
  private foot(side: 0 | 1, out: Vector3): Vector3 {
    const leg = this.rig.legs[side];
    const parent = this.rig.bones[0].parent;
    out.setFromMatrixPosition(leg.end.matrixWorld);
    if (parent) out.applyMatrix4(_m.copy(parent.matrixWorld).invert());
    return out;
  }

  private measure(s: Sampled): void {
    const n = s.clip.frames;
    const restAnkle = this.rig.joints.get("footL")!.y;
    const L: Vector3[] = [];
    const R: Vector3[] = [];
    for (let f = 0; f < n; f++) {
      this.pose(s, f);
      L.push(this.foot(0, new Vector3()));
      R.push(this.foot(1, new Vector3()));
    }
    let low = Infinity;
    for (let f = 0; f < n; f++) low = Math.min(low, L[f].y, R[f].y);
    s.floor = low - restAnkle;
    if (!s.loop || !/^(walk|jog|sprint)$/.test(s.clip.name)) return;
    // A foot that's down (within 4 units of the lowest) slides back at the speed the body
    // would move: its backward travel over the frames it's down.
    let dist = 0;
    let time = 0;
    let strike = 0;
    for (let f = 0; f < n - 1; f++) {
      if (L[f].z > L[strike].z) strike = f;
      for (const foot of [L, R]) {
        if (foot[f].y > low + 4 || foot[f + 1].y > low + 4) continue;
        dist += foot[f].z - foot[f + 1].z;
        time += 1 / CLIP_FPS;
      }
    }
    const speed = time > 0 ? Math.max(10, dist / time) : 100;
    this.strides.set(s.clip.name, { speed, stride: speed * s.clip.duration, strike: strike / (n - 1) });
  }
}
