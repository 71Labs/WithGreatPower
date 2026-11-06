/**
 * The hero's motion capture, driven by the sim's motion (anim/hero.ts owns the states):
 *
 * - Standing: the mocap idle moves his upper body (breath, arms, head) over legs planted
 *   about hip-width apart (anim/stand.ts) with his weight on one of them.
 * - Moving: walk, jog and sprint cycles blended by ground speed on one shared phase that
 *   advances by distance over the blend's stride (never backwards: the body always faces
 *   where it's going), so planted feet don't slide. Starts and stops cross-fade in about a
 *   quarter of a second; a stop squares the feet up after. A pivot (a sharp start or a
 *   reversal) takes the legs off the cycle while the stance turns him (anim/stand.ts).
 * - One-shots laid on top: a landing (deeper for a harder hit, played quick so he's up in
 *   under half a second), a flinch when hurt, a jab or a cross when a villain he's facing
 *   takes a hit, and a fall into the ragdoll on a knockout.
 * - In the air the jump loop loosens the upper body a little over the physics pose.
 *
 * After the layer, the procedural parts are put back on top: the web hand re-reaches its
 * line, standing legs re-reach their planted feet (the landing's dip bends the knees), a
 * moving foot over a step in the roof is lifted onto it, the torso and head lead a turn, and
 * the head glances or looks at a rival. A planted foot's target is never let across the
 * body's midline (a last guard: the stance's own limits keep it there).
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
/** Stood still this long by the sim's own speed (s), the stride ends: a stop, not a reversal. */
const DEAD_STOP = 0.045;
/** Slowing down, the gait eases toward the walk over about this much ground (units). */
const GAIT_EASE = 30;
/** A planted ankle stays at least this far its own side of the hips' midline (units). */
const MIDLINE_GUARD = 1.5;
/** Where a stride ends, each foot is planted at least this far its own side of the midline. */
const PLANT_SIDE = 3;
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const _q = new Quaternion();
const _p = new Quaternion();
const _f = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _h = new Vector3();
const _r = new Vector3();
const _s = new Vector3();

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
  /** A pivot under way: the stance has the legs. */
  pivot: boolean;
  /** Horizontal speed (smoothed) and distance moved this frame. */
  speed: number;
  moved: number;
  /** The sim's own ground speed this frame, unsmoothed: at a dead stop the stride ends at once. */
  raw?: number;
}

export class Mocap {
  readonly motion: MotionLayer;
  readonly stand: Stand;
  readonly clipW = new Spring(12, 1);
  readonly moveW = new Spring(12, 1);
  /** The legs taken off the cycle by a pivot (1 at once, handed back to the stride quickly). */
  readonly pivotW = new Spring(28, 1);
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
  private readonly legMask: Float32Array;
  private readonly upper: Float32Array;
  private readonly whole: Float32Array;
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
    this.legMask = new Float32Array(rig.bones.length);
    // Never the root: it carries the body's turn and lean (applyPose writes them there), and
    // the clips' own root is only their rest pose. Laid over it, a clip would turn the whole
    // body back to face one way in the world whichever way he's heading.
    this.upper = new Float32Array(rig.bones.map((_, i) => (this.legs[i] || i === this.pelvis || i === 0 ? 0 : 1)));
    this.whole = new Float32Array(rig.bones.map((_, i) => (i === 0 ? 0 : 1)));
  }

  /** Lay a one-shot over the next frames. */
  private play(name: string, opts: Partial<Shot> = {}): void {
    if (!this.motion.has(name)) return;
    this.shot = { name, t: 0, rate: 1, weight: 1, legs: false, ...opts };
  }

  /**
   * A landing, `impact` the downward speed plus a share of the forward: the feet come down
   * where they touch (on the roof at `at`'s height) and step under him once he's up.
   */
  land(impact: number, at: Vector3, yaw: number): void {
    for (let i = 0; i < 2; i++) this.stand.plant(i, worldPos(this.rig.legs[i].end, _a).setY(at.y), yaw + (i === 0 ? 0.12 : -0.12));
    this.stand.settle();
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

  /** How much the legs run the locomotion cycle (not planted, not in a pivot). */
  get legsMove(): number {
    return this.moveW.value * (1 - this.pivotW.value);
  }

  step(dt: number, inp: MocapInput): void {
    const ground = inp.ground || this.dying >= 0;
    this.onGround = inp.ground;
    this.clipW.step(ground ? 1 : 0, dt);
    this.airW.step(inp.air ? 1 : 0, dt);
    // A dead stop by the sim's word (stood still a few frames: not a reversal passing through
    // zero) ends the stride now. Waiting for the smoothed speed to fall held him frozen in the
    // stride's flight, both feet off the roof, for a tenth of a second at every stop.
    const raw = inp.raw ?? Infinity;
    this.stillFor = raw < 4 ? this.stillFor + dt : 0;
    if (!this.moving && inp.speed > 30 && this.stillFor <= 0) {
      this.moving = true;
      this.gait = inp.speed;
    } else if (this.moving && (inp.speed < 14 || this.stillFor >= DEAD_STOP)) this.moving = false;
    // The speed the walk / jog / sprint blend is picked for. It speeds up with him, but slows
    // only as he covers ground, and holds once he's stopped: at the same phase the three
    // clips have their feet in different places, so a blend changing while the feet stand
    // still would slide them.
    if (this.moving) {
      if (inp.speed > this.gait) this.gait += (inp.speed - this.gait) * (1 - Math.exp(-dt * 12));
      else this.gait += (inp.speed - this.gait) * (1 - Math.exp(-inp.moved / GAIT_EASE));
    }
    this.moveW.step(this.moving && ground && this.dying < 0 ? 1 : 0, dt);
    if (inp.pivot) this.pivotW.snap(1);
    else this.pivotW.step(0, dt);
    this.idleT += dt;
    this.airT = inp.air ? this.airT + dt : 0;
    if (this.dying >= 0) this.dying += dt;
    const s = this.shot;
    if (s) {
      s.t += dt * s.rate;
      if (s.t >= this.motion.duration(s.name) && s.name !== "death") this.shot = null;
    }
    // The cycle advances by distance over the blend's stride (never backwards: the body
    // faces where it's going, so the distance is all forward).
    const w = this.locoWeights(this.gait);
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
  layer(pose: Pose, gripW: number, headYaw: number, headPitch: number, groundAt: (x: number, z: number, y: number) => number, bodyGround: number, twist = 0): void {
    const m = this.motion;
    const rig = this.rig;
    const clipW = this.clipW.value;
    const moveW = this.moveW.value;
    const legsW = this.legsMove;
    const airW = this.airW.value;
    if (clipW < 0.002 && airW < 0.002) return;
    const root = rig.bones[0];

    if (clipW >= 0.002) {
      // Standing and moving.
      const w = this.locoWeights(this.gait);
      const strides = (k: number) => {
        for (let i = 0; i < LOCO.length; i++) {
          const st = m.strides.get(LOCO[i]);
          if (st && w[i] > 0) m.add(LOCO[i], ((this.phase + st.strike) % 1) * m.duration(LOCO[i]), k * w[i]);
        }
      };
      m.begin();
      m.add("idle", this.idleT, 1 - moveW);
      if (moveW > 0.002) strides(moveW);
      const s = this.shot;
      const shotLegs = s?.legs ? 1 : 0;
      for (let i = 0; i < rig.bones.length; i++) {
        if (this.legs[i]) this.mask[i] = shotLegs;
        else if (this.armR[i]) this.mask[i] = 1 - gripW;
        else this.mask[i] = i === 0 ? 0 : 1;
        this.legMask[i] = this.legs[i] ? legsW : 0;
      }
      m.apply(clipW, this.mask, legsW);
      this.baseFloor = m.floor;
      // The legs take the stride alone: never the idle's stance, which as a run fades out
      // would drag the feet across the roof from where the last stride left them.
      if (legsW > 0.002) {
        m.begin();
        strides(1);
        m.apply(clipW, this.legMask, 0, false);
      }
      // One-shots on top, fading in and out.
      if (s) {
        const len = m.duration(s.name);
        const fade = s.name === "death" ? 1 : smoothstep(0, 0.08, s.t) * (1 - smoothstep(len - 0.18 * s.rate, len, s.t));
        m.begin();
        m.over(s.name, s.t, 1);
        m.apply(clipW * s.weight * fade, s.legs ? this.whole : this.upper, s.legs ? 1 : 0);
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
    // The torso leads a turn (the pelvis follows the feet): the lower back, then the chest.
    if (Math.abs(twist) > 1e-4) {
      addBoneDelta(rig, rig.index.get("spine")!, _q.setFromAxisAngle(Y, twist * 0.4 * clipW));
      addBoneDelta(rig, rig.index.get("chest")!, _q.setFromAxisAngle(Y, twist * 0.6 * clipW));
    }
    // The head: glances, a rival, the lead into a turn.
    const yaw = headYaw + st.glanceYaw.value * standing;
    const pitch = st.glancePitch.value * standing + headPitch;
    if (Math.abs(yaw) + Math.abs(pitch) > 1e-4) {
      addBoneDelta(rig, rig.index.get("neck")!, _q.setFromAxisAngle(Y, yaw * 0.35 * clipW));
      addBoneDelta(rig, rig.index.get("head")!, _q.setFromAxisAngle(Y, yaw * 0.65 * clipW).multiply(_p.setFromAxisAngle(X, pitch * clipW)));
    }
    root.updateMatrixWorld(true);

    // Legs: standing ones back on their planted feet; moving ones lifted onto a step. Once
    // he's stopped the stance has the legs outright (it took the feet where the stride left
    // them), so a foot on the roof can't creep while the stride fades out above it. Their
    // targets are the pose's own (already eased in from the air), so they're re-reached in
    // full on the ground however far the clips are in: a landing's dip bends the knees, never
    // sinks the feet. Leaving the ground they fade out with the clips.
    const plant = (this.onGround ? 1 : clipW) * (1 - Math.max(this.moving ? legsW : 0, this.shot?.legs ? 1 : 0));
    // The hips' midline (between the hip joints), for the guard on planted feet.
    const hipL = worldPos(rig.legs[0].upper, _h);
    const hipR = worldPos(rig.legs[1].upper, _r);
    const side = _s.subVectors(hipL, hipR).setY(0).normalize();
    hipL.add(hipR).multiplyScalar(0.5);
    for (let i = 0; i < 2; i++) {
      const leg = rig.legs[i];
      const ankle = worldPos(leg.end, _a);
      if (plant > 0.002) {
        const target = _b.copy(ankle).lerp(pose.foot[i], plant);
        const s = i === 0 ? 1 : -1;
        const over = MIDLINE_GUARD - s * _r.subVectors(target, hipL).dot(side);
        if (over > 0 && this.onGround && this.dying < 0) target.addScaledVector(side, s * over);
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

  private gait = 0;
  private onGround = true;
  /** Seconds the sim has had him standing still (DEAD_STOP). */
  private stillFor = 0;

  /** Up again after a knockout. */
  recover(): void {
    this.dying = -1;
    if (this.shot?.name === "death") this.shot = null;
  }

  /** Where the feet are now (world ankles), to plant them when a stride ends. */
  plantWhereTheyAre(groundY: number, ankleH: number, yaw: number, stop = false): void {
    let up = -1;
    let high = groundY + ankleH + 3;
    // A sprint's feet land near the midline: each is planted at least a little its own side.
    const rig = this.rig;
    const hipL = worldPos(rig.legs[0].upper, _h);
    const hipR = worldPos(rig.legs[1].upper, _r);
    const side = _s.subVectors(hipL, hipR).setY(0).normalize();
    hipL.add(hipR).multiplyScalar(0.5);
    for (let i = 0; i < 2; i++) {
      const p = worldPos(this.rig.legs[i].end, _a);
      if (p.y > high) {
        high = p.y;
        up = i;
      }
      p.y = groundY + ankleH;
      const s = i === 0 ? 1 : -1;
      const over = PLANT_SIDE - s * _b.subVectors(p, hipL).setY(0).dot(side);
      if (over > 0) p.addScaledVector(side, s * over);
      this.stand.plant(i, p, yaw + (i === 0 ? 0.12 : -0.12));
    }
    // A stop that caught a foot in the air puts it down beside the other.
    this.stand.settle(stop ? up : -1);
    if (stop && up >= 0) this.stand.foot[up].y = high;
  }

  /** Whether the body counts as moving (for the stride-end plant). */
  get isMoving(): boolean {
    return this.moving;
  }
}

