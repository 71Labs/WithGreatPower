/**
 * The hero's motion capture, driven by the sim's motion (anim/hero.ts owns the states):
 *
 * - Standing: the mocap idle moves his upper body (breath, arms, head) over legs planted
 *   about hip-width apart (anim/stand.ts) with his weight on one of them.
 * - Moving: walk, jog and sprint cycles blended by ground speed on one shared phase that
 *   advances by distance over the blend's stride, so planted feet don't slide. Starts and
 *   stops cross-fade in about a quarter of a second; a stop squares the feet up after.
 * - One-shots laid on top: a landing (deeper for a harder hit, played quick so he's up in
 *   under half a second), a flinch when hurt, a jab or a cross when a villain he's facing
 *   takes a hit, and a fall into the ragdoll on a knockout.
 * - In the air the jump loop loosens the upper body a little over the physics pose.
 *
 * After the layer, the procedural parts are put back on top: the web hand re-reaches its
 * line, standing legs re-reach their planted feet (the landing's dip bends the knees), a
 * moving foot over a step in the roof is lifted onto it, and the head turns to glance,
 * look at a rival or lead a turn.
 */
import { Quaternion, Vector3 } from "three";

import { worldPos, worldQuat, type Rig } from "../rig";
import { clamp, smoothstep } from "./common";
import { MotionLayer } from "./motion";
import { addBoneDelta, reachLimb, type Pose } from "./pose";
import { Stand } from "./stand";
import { Spring } from "../physics/spring";
import type { HeroClips } from "../hero-asset";

const LOOPS = ["idle", "idle-talk", "walk", "jog", "sprint", "jump-loop"];
const LOCO = ["walk", "jog", "sprint"] as const;
/** Ground speed where the blend is all sprint (the sim's top speed on a roof). */
const SPRINT_TOP = 480;
const DEATH_HANDOFF = 0.9;
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const _q = new Quaternion();
const _p = new Quaternion();
const _f = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();

interface Shot {
  name: string;
  t: number;
  rate: number;
  weight: number;
  legs: boolean;
}

export interface MocapInput {
  /** On a roof, in a pose the clips can take (not mid-slam, not held). */
  ground: boolean;
  /** Plain flight (no flip, no dive): the jump loop may loosen the upper body. */
  air: boolean;
  /** Horizontal speed and distance moved this frame. */
  speed: number;
  moved: number;
}

export class Mocap {
  readonly motion: MotionLayer;
  readonly stand: Stand;
  readonly clipW = new Spring(12, 1);
  readonly moveW = new Spring(12, 1);
  private readonly airW = new Spring(6, 1);
  private moving = false;
  private phase = 0;
  private idleT = Math.random() * 2;
  private airT = 0;
  private shot: Shot | null = null;
  private punches = 0;
  /** Seconds into the knockout fall, or −1. */
  dying = -1;
  private readonly mask: Float32Array;
  private readonly upper: Float32Array;
  private readonly legs: boolean[];
  private readonly armR: boolean[];
  private readonly pelvis: number;

  constructor(
    private readonly rig: Rig,
    clips: HeroClips,
    k: number,
  ) {
    this.motion = new MotionLayer(clips, rig, k, LOOPS);
    this.stand = new Stand(rig.spec.hipWidth + 0.9);
    const name = (i: number) => rig.bones[i].name;
    this.legs = rig.bones.map((_, i) => /^(thigh|calf|foot|ball)_/.test(name(i)));
    this.armR = rig.bones.map((_, i) => /^(clavicle|upperarm|lowerarm|hand)_r$/.test(name(i)));
    this.pelvis = rig.index.get("hips")!;
    this.mask = new Float32Array(rig.bones.length);
    this.upper = new Float32Array(rig.bones.map((_, i) => (this.legs[i] || i === this.pelvis ? 0 : 1)));
  }

  /** Lay a one-shot over the next frames. */
  private play(name: string, opts: Partial<Shot> = {}): void {
    if (!this.motion.has(name)) return;
    this.shot = { name, t: 0, rate: 1, weight: 1, legs: false, ...opts };
  }

  /** A landing, `impact` the downward speed plus a share of the forward. */
  land(impact: number, at: Vector3, yaw: number): void {
    for (let i = 0; i < 2; i++) this.stand.plant(i, this.stand.homeOf(i, at, yaw, _a), yaw + (i === 0 ? 0.12 : -0.12));
    this.play("land", { t: 0.05, rate: 2, weight: clamp(impact / 1400, 0.2, 0.75) });
  }

  hurt(): void {
    this.play(Math.random() < 0.5 ? "hit-chest" : "hit-head", { weight: 0.9 });
  }

  /** A blow at a villain in reach. */
  punch(): void {
    if (this.shot && this.shot.name !== "land") return;
    this.play(this.punches++ % 2 === 0 ? "jab" : "cross", { rate: 1.5, weight: 0.95 });
  }

  /** Knocked out on a roof: fall, then the ragdoll takes over (`fallen` says when). */
  knockout(): void {
    this.dying = 0;
    this.play("death", { legs: true, weight: 1 });
  }

  get fallen(): boolean {
    return this.dying >= DEATH_HANDOFF;
  }

  /** How much the standing lower body (planted feet, the hips over one leg) is showing. */
  get standing(): number {
    return this.clipW.value * (1 - this.moveW.value);
  }

  step(dt: number, inp: MocapInput): void {
    const ground = inp.ground || this.dying >= 0;
    this.lastSpeed = inp.speed;
    this.clipW.step(ground ? 1 : 0, dt);
    this.airW.step(inp.air ? 1 : 0, dt);
    if (!this.moving && inp.speed > 30) this.moving = true;
    else if (this.moving && inp.speed < 14) this.moving = false;
    this.moveW.step(this.moving && ground && this.dying < 0 ? 1 : 0, dt);
    this.idleT += dt;
    this.airT = inp.air ? this.airT + dt : 0;
    if (this.dying >= 0) this.dying += dt;
    const s = this.shot;
    if (s) {
      s.t += dt * s.rate;
      if (s.t >= this.motion.duration(s.name) && s.name !== "death") this.shot = null;
    }
    // The cycle advances by distance over the blend's stride.
    const w = this.locoWeights(inp.speed);
    let stride = 0;
    for (let i = 0; i < LOCO.length; i++) stride += w[i] * (this.motion.strides.get(LOCO[i])?.stride ?? 100);
    this.phase = (this.phase + inp.moved / Math.max(20, stride)) % 1;
  }

  private readonly lw = [0, 0, 0];

  /** Walk, jog and sprint weights for a ground speed. */
  private locoWeights(speed: number): number[] {
    const vw = this.motion.strides.get("walk")?.speed ?? 50;
    const vj = this.motion.strides.get("jog")?.speed ?? 230;
    const w = this.lw;
    if (speed <= vw) w.splice(0, 3, 1, 0, 0);
    else if (speed <= vj) {
      const t = smoothstep(vw, vj, speed);
      w.splice(0, 3, 1 - t, t, 0);
    } else {
      const t = smoothstep(vj, SPRINT_TOP, speed);
      w.splice(0, 3, 0, 1 - t, t);
    }
    return w;
  }

  private baseFloor = 0;

  /** The blend's lowest sole above the rest pose's (lower the body by this). */
  get floor(): number {
    return this.baseFloor;
  }

  /**
   * Lay the clips over the pose applyPose just wrote, then put the procedural parts back:
   * the web hand on its line, standing legs on their planted feet, terrain under moving
   * feet, the head's glance and turn. `groundAt` is the roof height under a point.
   */
  layer(pose: Pose, gripW: number, headYaw: number, headPitch: number, groundAt: (x: number, z: number, y: number) => number, bodyGround: number): void {
    const m = this.motion;
    const rig = this.rig;
    const clipW = this.clipW.value;
    const moveW = this.moveW.value;
    const airW = this.airW.value;
    if (clipW < 0.002 && airW < 0.002) return;
    const root = rig.bones[0];

    if (clipW >= 0.002) {
      // Standing and moving.
      m.begin();
      m.add("idle", this.idleT, 1 - moveW);
      if (moveW > 0.002) {
        const w = this.locoWeights(Math.max(0, this.lastSpeed));
        for (let i = 0; i < LOCO.length; i++) {
          const st = m.strides.get(LOCO[i]);
          if (st && w[i] > 0) m.add(LOCO[i], ((this.phase + st.strike) % 1) * m.duration(LOCO[i]), moveW * w[i]);
        }
      }
      const s = this.shot;
      const shotLegs = s?.legs ? 1 : 0;
      for (let i = 0; i < rig.bones.length; i++) {
        if (this.legs[i]) this.mask[i] = Math.max(moveW, shotLegs);
        else if (this.armR[i]) this.mask[i] = 1 - gripW;
        else this.mask[i] = 1;
      }
      m.apply(clipW, this.mask, moveW);
      this.baseFloor = m.floor;
      // One-shots on top, fading in and out.
      if (s) {
        const len = m.duration(s.name);
        const fade = s.name === "death" ? 1 : smoothstep(0, 0.08, s.t) * (1 - smoothstep(len - 0.18 * s.rate, len, s.t));
        m.begin();
        m.over(s.name, s.t, 1);
        m.apply(clipW * s.weight * fade, s.legs ? undefined : this.upper, s.legs ? 1 : 0);
      }
    }
    if (airW >= 0.002) {
      m.begin();
      m.add("jump-loop", this.airT, 1);
      m.apply(airW * 0.3 * (1 - clipW), this.upper, 0);
    }
    root.updateMatrixWorld(true);

    // Leaning on one leg: the hips tip up over it, the shoulders tilt the other way.
    const st = this.stand;
    const standing = clipW * (1 - moveW) * (this.dying >= 0 ? 0 : 1);
    if (standing > 0.002) {
      addBoneDelta(rig, this.pelvis, _q.setFromAxisAngle(Z, st.weight.value * 0.07 * standing));
      addBoneDelta(rig, rig.index.get("spine")!, _q.setFromAxisAngle(Z, -st.weight.value * 0.06 * standing));
      addBoneDelta(rig, rig.index.get("chest")!, _q.setFromAxisAngle(Z, -st.weight.value * 0.04 * standing));
    }
    // The head: glances, a rival, the lead into a turn.
    const yaw = headYaw + st.glanceYaw.value * standing;
    const pitch = st.glancePitch.value * standing + headPitch;
    if (Math.abs(yaw) + Math.abs(pitch) > 1e-4) {
      addBoneDelta(rig, rig.index.get("neck")!, _q.setFromAxisAngle(Y, yaw * 0.35 * clipW));
      addBoneDelta(rig, rig.index.get("head")!, _q.setFromAxisAngle(Y, yaw * 0.65 * clipW).multiply(_p.setFromAxisAngle(X, pitch * clipW)));
    }
    root.updateMatrixWorld(true);

    // Legs: standing ones back on their planted feet; moving ones lifted onto a step.
    const plant = clipW * (1 - Math.max(moveW, this.shot?.legs ? 1 : 0));
    for (let i = 0; i < 2; i++) {
      const leg = rig.legs[i];
      const ankle = worldPos(leg.end, _a);
      if (plant > 0.002) {
        const target = _b.copy(ankle).lerp(pose.foot[i], plant);
        const foot = worldQuat(leg.end, _f).slerp(_q.copy(pose.footRot[i]).multiply(rig.restWorld[rig.index.get(leg.end.name)!]), plant);
        reachLimb(rig, leg, target, pose.knee[i], foot);
      } else if (clipW > 0.002) {
        const lift = groundAt(ankle.x, ankle.z, ankle.y + 30) - bodyGround;
        if (Math.abs(lift) > 0.5) reachLimb(rig, leg, _b.copy(ankle).setY(ankle.y + lift * clipW), pose.knee[i]);
      }
    }
    // The web hand back on its line.
    if (gripW > 0.002 && clipW > 0.002) reachLimb(rig, rig.arms[1], pose.hand[1], pose.elbow[1]);
  }

  private lastSpeed = 0;

  /** Up again after a knockout. */
  recover(): void {
    this.dying = -1;
    if (this.shot?.name === "death") this.shot = null;
  }

  /** Where the feet are now (world ankles), to plant them when a stride ends. */
  plantWhereTheyAre(groundY: number, ankleH: number, yaw: number): void {
    for (let i = 0; i < 2; i++) {
      const p = worldPos(this.rig.legs[i].end, _a);
      p.y = groundY + ankleH;
      this.stand.plant(i, p, yaw + (i === 0 ? 0.12 : -0.12));
    }
  }

  /** Whether the body counts as moving (for the stride-end plant). */
  get isMoving(): boolean {
    return this.moving;
  }
}

