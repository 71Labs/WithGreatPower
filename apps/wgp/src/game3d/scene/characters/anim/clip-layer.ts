/**
 * Motion capture for the cast's MPFB bodies: the hero's clips (hero-anims.glb) and the cast's
 * extras (cast-anims.glb), all Quaternius' UAL retargeted onto the same skeleton, laid over the
 * pose the animator's physics wrote (anim/actor.ts), the way anim/mocap.ts does for the hero.
 *
 * - `loops` blends looping clips (idle, a fighting stance, a run) by weight, through a bone
 *   mask: the upper body only (the legs stay planted or dangling by IK and springs), or the
 *   whole body (a run, a crouch, the hover's treading legs).
 * - `play` starts a one-shot (a punch, a flinch, a throw, a fall) that `over` lays on top,
 *   fading in and out unless it's held (a fall that ends lying down).
 * - The clips' hips play about this body's own resting hips, scaled to its leg length, so a
 *   short aunt and a tall villain both stand on their feet.
 */
import type { HeroClips } from "../hero-asset";
import type { Rig } from "../rig";
import { smoothstep } from "./common";
import { MotionLayer } from "./motion";

/** Clips that loop (the rest play once). */
export const CAST_LOOPS = ["idle", "idle-talk", "walk", "jog", "sprint", "jump-loop", "crouch-idle", "spell-idle", "sword-idle", "swim-idle"];

export interface ClipShot {
  name: string;
  t: number;
  rate: number;
  weight: number;
  /** The whole body (else the upper body only). */
  full: boolean;
  /** Stay on the last frame instead of fading out (a fall). */
  hold: boolean;
}

export class ClipLayer {
  readonly motion: MotionLayer;
  /** Per-bone masks: the trunk and up (the pelvis's turn included, which the spine's
   *  turns lean on); the arms; every bone; the legs. */
  readonly upper: Float32Array;
  readonly arms: Float32Array;
  readonly full: Float32Array;
  readonly legs: Float32Array;
  shot: ClipShot | null = null;

  /** `use`: the clips this body plays (the rest aren't prepared, which keeps a swap quick). */
  constructor(
    readonly rig: Rig,
    clips: HeroClips,
    k: number,
    use?: string[],
  ) {
    let source = clips;
    if (use) {
      source = new Map([...clips].filter(([name]) => use.includes(name)));
      source.pelvisRest = clips.pelvisRest;
      source.restQ = clips.restQ;
    }
    this.motion = new MotionLayer(source, rig, k, CAST_LOOPS, true);
    const name = (i: number) => rig.bones[i].name;
    const leg = rig.bones.map((_, i) => /^(thigh|calf|foot|ball)_/.test(name(i)));
    this.upper = new Float32Array(rig.bones.map((_, i) => (leg[i] || i === 0 ? 0 : 1)));
    this.arms = new Float32Array(rig.bones.map((_, i) => (/^(clavicle|upperarm|lowerarm|hand)_/.test(name(i)) ? 1 : 0)));
    this.full = new Float32Array(rig.bones.length).fill(1);
    this.legs = new Float32Array(rig.bones.map((_, i) => (leg[i] ? 1 : 0)));
  }

  has(name: string): boolean {
    return this.motion.has(name);
  }

  duration(name: string): number {
    return this.motion.duration(name);
  }

  /** Start a one-shot (replacing any other unless it's held). */
  play(name: string, opts: Partial<Omit<ClipShot, "name" | "t">> & { t?: number } = {}): void {
    if (!this.motion.has(name)) return;
    if (this.shot?.hold && !opts.hold) return;
    this.shot = { name, t: opts.t ?? 0, rate: opts.rate ?? 1, weight: opts.weight ?? 1, full: opts.full ?? false, hold: opts.hold ?? false };
  }

  stop(): void {
    this.shot = null;
  }

  /** Whether a one-shot named `name` (or any) is playing. */
  playing(name?: string): boolean {
    return !!this.shot && (!name || this.shot.name === name);
  }

  step(dt: number): void {
    const s = this.shot;
    if (!s) return;
    s.t += dt * s.rate;
    const len = this.motion.duration(s.name);
    if (s.t >= len) {
      if (s.hold) s.t = len;
      else this.shot = null;
    }
  }

  /**
   * Lay looping clips (name, time, weight) over the rig by `amount` through `mask`; the hips
   * take the clips' height where `absolute` is 1, else only their move (a sway, a dip).
   */
  loops(list: [string, number, number][], amount: number, mask: Float32Array, absolute = 0): void {
    if (amount <= 1e-3) return;
    const m = this.motion;
    m.begin();
    for (const [name, t, w] of list) m.add(name, t, w);
    m.apply(amount, mask, absolute);
  }

  /** The one-shot on top of whatever the bones hold now. */
  over(amount: number, mask?: Float32Array): void {
    const s = this.shot;
    if (!s || amount <= 1e-3) return;
    const m = this.motion;
    const len = m.duration(s.name);
    const fade = s.hold ? smoothstep(0, 0.1, s.t) : smoothstep(0, 0.08, s.t) * (1 - smoothstep(len - 0.18 * s.rate, len, s.t));
    m.begin();
    m.over(s.name, s.t, 1);
    m.apply(amount * s.weight * fade, mask ?? (s.full ? this.full : this.upper), s.full ? 1 : 0);
  }

  /** The blend's lowest ankle above the rest pose's, after `loops` (units). */
  get floor(): number {
    return this.motion.floor;
  }

  /** A loop's measured stride (locomotion), if any. */
  stride(name: string) {
    return this.motion.strides.get(name);
  }
}
