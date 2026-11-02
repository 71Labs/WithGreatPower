/**
 * The base every villain and ally animator builds on. It smooths the motion it is given
 * (deriving velocity and acceleration from the drawn positions when the frame has none),
 * turns the body with a rate-limited yaw, runs hand and foot springs in the body's moving
 * frame, wobbles when stunned, and, once a villain is caught, hangs the body webbed up on
 * a Verlet strand (`Dangle`). Subclasses say where the hips go, how the body tilts and
 * where the limbs reach.
 *
 * On an MPFB body with motion capture (`setClips`), subclasses lay clips over that pose in
 * `layerClips` (anim/clip-layer.ts) and put the physics back on top: planted feet, a hand
 * on its target, the cocoon's pinned arms. `struck` flinches the body when it takes a hit.
 */
import { Quaternion, Vector3, type Group } from "three";

import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import type { HeroClips } from "../hero-asset";
import { Spring, Spring3 } from "../physics/spring";
import { FixedStepper } from "../physics/stepper";
import { Verlet } from "../physics/verlet";
import { worldPos, worldQuat, type Rig } from "../rig";
import { ClipLayer } from "./clip-layer";
import { angleTo, clamp, frameQuat, Orient, smoothstep, Turn, yawOf } from "./common";
import { addBoneDelta, applyPose, newPose, newSolved, reachLimb, type Pose, type Solved } from "./pose";
import type { AnimContext } from "./types";

export interface ActorInput {
  pos: Vec3;
  vel?: Vec3;
  facing?: Vec3;
  state: string;
  stateTicks?: number;
  /** Roll into a turn (the sim's v1.2 `bank`), radians toward the body's right. */
  bank?: number;
}

const _q = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const X = new Vector3(1, 0, 0);
const _X = X;
const _Y = new Vector3(0, 1, 0);

/** A caught villain's web: a Verlet strand from a roof edge to the top of the cocoon. */
export class Dangle {
  static readonly N = 10;
  readonly v = new Verlet(Dangle.N, { gravity: 1750, damping: 0.012, iterations: 12 });
  readonly anchor = new Vector3();
  active = false;

  start(anchor: Vector3, top: Vector3, vel: Vector3, h: number): void {
    const n = Dangle.N;
    this.anchor.copy(anchor);
    const len = Math.max(60, anchor.distanceTo(top));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      _a.copy(anchor).lerp(top, t);
      this.v.place(i, _a.x, _a.y, _a.z);
      this.v.setVelocity(i, vel.x * t, vel.y * t, vel.z * t, h);
    }
    if (this.v.constraints === 0) for (let i = 0; i < n - 1; i++) this.v.link(i, i + 1, len / (n - 1));
    else for (let i = 0; i < n - 1; i++) this.v.setRest(i, len / (n - 1));
    this.v.pin(0);
    // The body is heavy: the strand moves around it more than it moves the body.
    this.v.invMass[n - 1] = 0.12;
    this.active = true;
  }

  step(h: number): void {
    this.v.moveTo(0, this.anchor.x, this.anchor.y, this.anchor.z);
    this.v.step(h);
  }

  /** The cocoon's top and the strand's direction there (from body toward the anchor). */
  top(alpha: number, out: Vector3): Vector3 {
    return this.v.sample(Dangle.N - 1, alpha, out);
  }

  up(alpha: number, out: Vector3): Vector3 {
    this.v.sample(Dangle.N - 2, alpha, out);
    return out.sub(this.v.sample(Dangle.N - 1, alpha, _c)).normalize();
  }
}

export abstract class ActorAnimator {
  readonly pose: Pose = newPose();
  readonly solved: Solved = newSolved();
  readonly targets: Vector3[] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  readonly dangle = new Dangle();
  /** Seconds in the current state. */
  stateT = 0;
  state = "idle";
  protected readonly clock = new FixedStepper();
  protected readonly vel = new Spring3(12, 1);
  protected readonly acc = new Spring3(8, 1);
  protected readonly turn: Turn;
  protected readonly orient = new Orient(9);
  protected readonly hands = [new Spring3(12, 0.6), new Spring3(12, 0.6)];
  protected readonly feet = [new Spring3(11, 0.62), new Spring3(11, 0.62)];
  protected readonly spineP = new Spring(9, 0.5);
  protected readonly spineR = new Spring(8, 0.35);
  protected readonly headP = new Spring(10, 0.5);
  protected readonly headY = new Spring(8, 0.8);
  /** Webbed fade-in, 0–1, for the cocoon shader. */
  readonly webbed = new Spring(6, 1);
  protected readonly P = new Vector3();
  protected readonly lastP = new Vector3();
  protected readonly V = new Vector3();
  protected readonly H = new Vector3();
  protected readonly Q = new Quaternion();
  protected time = 0;
  protected started = false;
  private dangleSpin = 0;
  private dangleSpinV = 0;
  protected secondary = true;
  /** The sim's bank this frame, when it sends one. */
  protected bankIn: number | undefined;
  /** Where a webbed villain's strand goes, set by the scene. */
  strandAnchor: ((p: Vector3, out: Vector3) => Vector3) | null = null;
  /** Motion capture, on an MPFB body once its clips have loaded. */
  protected clips: ClipLayer | null = null;
  /** Seconds since the state turned "webbed" (a fall plays first), else −1. */
  protected caughtT = -1;

  constructor(
    protected readonly rig: Rig,
    protected readonly group: Group,
    turnRate = 6,
  ) {
    this.turn = new Turn(turnRate, 0.12);
  }

  /** World hips from the drawn position (alpha: between sub-steps). */
  protected abstract hips(out: Vector3, alpha: number, ctx: AnimContext): Vector3;
  /** The body's target rotation. */
  protected abstract body(out: Quaternion, ctx: AnimContext): Quaternion;
  /** A hand or foot target in the body frame (x left, y up, z forward), relative to the hips. */
  protected abstract limb(i: number, hand: boolean, out: Vector3, ctx: AnimContext): Vector3;
  /** Spine pitch and roll targets. */
  protected spineTarget(): [number, number] {
    return [0, 0];
  }
  /** Last word on the pose (planted feet, extra bones), unless cocooned. */
  protected finish?(pose: Pose, alpha: number, ctx: AnimContext): void;
  /** Extra bones, posed every frame, cocooned or not. */
  protected extras?(pose: Pose): void;
  /** Per-frame bookkeeping before the sub-steps. */
  protected beforeSteps?(dt: number, ctx: AnimContext): void;
  /** Lay clips over the pose applyPose wrote (MPFB bodies with clips), then re-solve. */
  protected layerClips?(ctx: AnimContext, dt: number): void;
  /** Hips height above the soles for this body when standing (rest, minus a soft knee). */
  protected get standHips(): number {
    return this.rig.hipHeight - 1;
  }

  protected yawTarget(input: ActorInput, ctx: AnimContext): number {
    const f = input.facing;
    if (f && Math.abs(f.x) + Math.abs(f.z) > 0.1) return yawOf(f.x, f.z);
    const hs = Math.hypot(this.V.x, this.V.z);
    if (hs > 60) return yawOf(this.V.x, this.V.z);
    return yawOf(ctx.hero.x - this.P.x, ctx.hero.z - this.P.z);
  }

  update(input: ActorInput, dt: number, ctx: AnimContext): void {
    const P = this.P.set(input.pos.x, input.pos.y, input.pos.z);
    this.secondary = ctx.secondary;
    if (!this.started || P.distanceTo(this.lastP) > 260) this.reset(input, ctx);
    if (input.state !== this.state) {
      this.onState(input.state, ctx);
      this.state = input.state;
      this.stateT = 0;
    }
    this.stateT = input.stateTicks !== undefined ? input.stateTicks / 60 : this.stateT + dt;
    this.time += dt;
    if (input.vel) this.V.set(input.vel.x, input.vel.y, input.vel.z);
    else if (dt > 0) this.V.copy(P).sub(this.lastP).divideScalar(Math.max(dt, 1 / 240));
    this.lastP.copy(P);
    this.bankIn = input.bank;
    this.beforeSteps?.(dt, ctx);
    const yaw = this.yawTarget(input, ctx);
    const webbed = this.dangle.active || input.state === "webbed";
    this.clock.advance(dt, (h) => {
      this.vel.step(this.V.x, this.V.y, this.V.z, h);
      this.acc.step(this.vel.vx, this.vel.vy, this.vel.vz, h);
      this.turn.step(yaw, h);
      this.webbed.step(webbed ? 1 : 0, h);
      if (this.dangle.active) {
        this.dangle.step(h);
        this.dangleSpinV += (Math.sin(this.time * 0.7) * 0.6 - this.dangleSpin) * h * 2 - this.dangleSpinV * h * 0.8;
        this.dangleSpin += this.dangleSpinV * h;
      }
      this.orient.step(this.body(_q, ctx), h);
      const [sp, sr] = this.spineTarget();
      this.spineP.step(sp, h);
      this.spineR.step(sr, h);
      this.headP.step(0, h);
      this.headY.step(this.lookYaw(ctx), h);
      if (!this.secondary) return;
      const Q = this.orient.q;
      const g = _a.set(-this.acc.vx, -1750 - this.acc.vy, -this.acc.vz).multiplyScalar(0.4);
      if (g.length() > 2500) g.setLength(2500);
      for (let i = 0; i < 2; i++) {
        this.limb(i, true, _b, ctx).applyQuaternion(Q);
        this.hands[i].step(_b.x, _b.y, _b.z, h, g.x, g.y, g.z);
        this.limb(i, false, _b, ctx).applyQuaternion(Q);
        this.feet[i].step(_b.x, _b.y, _b.z, h, g.x * 0.7, g.y * 0.7, g.z * 0.7);
      }
    });
    this.compose(this.clock.alpha, ctx);
    applyPose(this.rig, this.group, this.pose, this.solved);
    if (this.clips) {
      this.clips.step(dt);
      if (this.caughtT >= 0) this.caughtT += dt;
      this.layerClips?.(ctx, dt);
    }
  }

  /** Drive this body with motion capture (an MPFB rig; `k` metres to units). */
  setClips(clips: HeroClips, k: number): void {
    this.clips = new ClipLayer(this.rig, clips, k, this.clipNames());
  }

  /** The clips this animator plays. */
  protected clipNames(): string[] {
    return ["idle", "hit-chest", "hit-head", "death"];
  }

  get hasClips(): boolean {
    return this.clips !== null;
  }

  /**
   * Caught: in the air, the fall's first moments flail over the cocoon and then it holds
   * still (returns true: nothing else to lay). On a roof the subclass plays the fall itself.
   */
  protected cocoonClips(): boolean {
    if (!this.dangle.active) return false;
    const fade = 1 - smoothstep(0.15, 0.85, this.caughtT);
    if (fade > 0.001) this.clips!.over(fade * 0.85, this.clips!.upper);
    return true;
  }

  /**
   * The head after the clips: lifted by `lift` (the UAL's idles look at the floor a little)
   * and turned toward the hero the way the procedural pose would.
   */
  protected lookAfterClips(lift: number, a = this.clock.alpha): void {
    const rig = this.rig;
    const yaw = this.headY.lerp(a);
    addBoneDelta(rig, rig.index.get("neck")!, _q2.setFromAxisAngle(_Y, yaw * 0.4).multiply(_q3.setFromAxisAngle(_X, -lift * 0.4)));
    addBoneDelta(rig, rig.index.get("head")!, _q2.setFromAxisAngle(_Y, yaw * 0.6).multiply(_q3.setFromAxisAngle(_X, -lift * 0.6)));
    rig.bones[0].updateMatrixWorld(true);
  }

  /** Took a hit: a flinch. */
  struck(): void {
    if (!this.clips || this.dangle.active || this.state === "webbed") return;
    this.clips.play(Math.random() < 0.5 ? "hit-chest" : "hit-head", { weight: 0.85, rate: 1.1 });
  }

  /** The feet back on the pose's targets (after a clip moved the hips), by `w`. */
  protected plantLegs(w = 1): void {
    if (w <= 1e-3) return;
    const rig = this.rig;
    rig.bones[0].updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      const leg = rig.legs[i];
      const ankle = worldPos(leg.end, _a);
      const target = _b.copy(ankle).lerp(this.pose.foot[i], w);
      const foot = worldQuat(leg.end, _q2).slerp(_q3.copy(this.pose.footRot[i]).multiply(rig.restWorld[rig.index.get(leg.end.name)!]), w);
      reachLimb(rig, leg, target, this.pose.knee[i], foot);
    }
  }

  /** Hands toward the pose's targets by `w` (per hand), after a clip moved the arms. */
  protected reachHands(w0: number, w1: number): void {
    const rig = this.rig;
    rig.bones[0].updateMatrixWorld(true);
    const ws = [w0, w1];
    for (let i = 0; i < 2; i++) {
      if (ws[i] <= 1e-3) continue;
      const arm = rig.arms[i];
      const wrist = worldPos(arm.end, _a);
      reachLimb(rig, arm, _b.copy(wrist).lerp(this.pose.hand[i], ws[i]), this.pose.elbow[i]);
    }
  }

  /** A state change: start the dangle when caught. */
  protected onState(next: string, ctx: AnimContext): void {
    this.caughtT = next === "webbed" ? 0 : -1;
    if (next === "webbed") this.clips?.play("death", { weight: 1, hold: true, full: true });
    else if (this.clips?.playing("death")) this.clips.stop();
    if (next === "webbed" && this.strandAnchor && (this.canDangle?.(ctx) ?? true)) {
      const top = _c.copy(this.P).add(_a.set(0, this.rig.height * 0.5, 0));
      const anchor = this.strandAnchor(this.P, new Vector3());
      this.dangle.start(anchor, top, this.V, this.clock.h);
    } else if (next !== "webbed") this.dangle.active = false;
  }

  /** Whether a caught villain hangs (flyers do; Sandwich Man on a roof lies down instead). */
  protected canDangle?(ctx: AnimContext): boolean;

  private lookYaw(ctx: AnimContext): number {
    const yaw = yawOf(ctx.hero.x - this.P.x, ctx.hero.z - this.P.z);
    return clamp(angleTo(this.turn.value, yaw), -1, 1) * 0.7;
  }

  protected reset(input: ActorInput, ctx: AnimContext): void {
    this.started = true;
    this.P.set(input.pos.x, input.pos.y, input.pos.z);
    this.lastP.copy(this.P);
    this.V.set(input.vel?.x ?? 0, input.vel?.y ?? 0, input.vel?.z ?? 0);
    this.vel.snap(this.V.x, this.V.y, this.V.z);
    this.acc.snap(0, 0, 0);
    this.turn.snap(this.yawTarget(input, ctx));
    this.orient.snap(this.body(_q, ctx));
    for (let i = 0; i < 2; i++) {
      this.limb(i, true, _b, ctx).applyQuaternion(this.orient.q);
      this.hands[i].snap(_b.x, _b.y, _b.z);
      this.limb(i, false, _b, ctx).applyQuaternion(this.orient.q);
      this.feet[i].snap(_b.x, _b.y, _b.z);
    }
    this.dangle.active = false;
    this.clock.reset();
  }

  private compose(a: number, ctx: AnimContext): void {
    const pose = this.pose;
    const rig = this.rig;
    const Q = this.orient.lerp(a, this.Q);
    let H = this.hips(this.H, a, ctx);
    const stun = this.state === "stunned" ? 1 : 0;
    if (this.dangle.active) {
      // Hang from the strand: the cocoon's top on its end, turned along it, spinning slowly.
      const top = this.dangle.top(a, _a);
      const up = this.dangle.up(a, _b);
      frameQuat(up, _c.set(Math.sin(this.dangleSpin), 0, Math.cos(this.dangleSpin)), Q);
      H = this.H.copy(top).addScaledVector(up, -(rig.height - rig.hipHeight) - 2);
    }
    if (stun && this.secondary) {
      // Dizzy: the whole body circles a little about the hips.
      Q.multiply(_q.setFromAxisAngle(X, Math.sin(this.time * 7.5) * 0.12));
      Q.multiply(_q.setFromAxisAngle(_c.set(0, 0, 1), Math.cos(this.time * 7.5) * 0.12));
    }
    pose.rot.copy(Q);
    pose.hips.set(0, this.standHips - rig.hipHeight, 0);
    pose.root.copy(H).sub(_c.set(0, this.standHips, 0).applyQuaternion(Q));
    pose.hipsRot.set(0, 0, 0);
    const wob = stun ? Math.sin(this.time * 9) * 0.15 : 0;
    pose.spine.set(this.spineP.lerp(a), 0, this.spineR.lerp(a) + wob);
    pose.chest.set(0, 0, 0);
    pose.neck.set(0, this.headY.lerp(a) * 0.4, 0);
    pose.head.set(this.headP.lerp(a) + (stun ? Math.sin(this.time * 5) * 0.2 : 0), this.headY.lerp(a) * 0.6, stun ? Math.cos(this.time * 5) * 0.25 : 0);
    pose.clav[0].set(0, 0, 0);
    pose.clav[1].set(0, 0, 0);
    // Hands with fingers rest half-curled, like a person's.
    pose.grip[0] = pose.grip[1] = 0.3;
    for (let i = 0; i < 2; i++) {
      if (this.secondary) {
        this.hands[i].lerp(a, pose.hand[i]).add(H);
        this.feet[i].lerp(a, pose.foot[i]).add(H);
      } else {
        this.limb(i, true, pose.hand[i], ctx).applyQuaternion(Q).add(H);
        this.limb(i, false, pose.foot[i], ctx).applyQuaternion(Q).add(H);
      }
      const s = i === 0 ? 1 : -1;
      pose.elbow[i].set(s * 0.5, -0.4, -1).applyQuaternion(Q);
      pose.knee[i].set(s * 0.15, 0, 1).applyQuaternion(Q);
      pose.handAim[i] = null;
      pose.handRot[i].set(0, 0, 0);
      pose.footRot[i].copy(Q);
    }
    if (this.dangle.active) {
      // Cocooned: arms pinned, legs together.
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        pose.hand[i].set(s * (rig.spec.hipWidth + 3), -2, 3).applyQuaternion(Q).add(H);
        pose.foot[i].set(s * 2.2, -rig.hipHeight + rig.spec.ankle + 1, 0).applyQuaternion(Q).add(H);
      }
      pose.spine.z += Math.sin(this.time * 3.1) * 0.06;
    } else {
      this.finish?.(pose, a, ctx);
    }
    this.extras?.(pose);
    this.targets[0].copy(pose.hand[0]);
    this.targets[1].copy(pose.hand[1]);
    this.targets[2].copy(pose.foot[0]);
    this.targets[3].copy(pose.foot[1]);
    this.targets[4].copy(H);
  }

  /** The strand's points for drawing (anchor to cocoon), or 0 when not dangling. */
  strandPoints(out: Float32Array, alpha = this.clock.alpha): number {
    if (!this.dangle.active) return 0;
    const v = this.dangle.v;
    for (let i = 0; i < Dangle.N; i++) {
      v.sample(i, alpha, _a);
      out[i * 3] = _a.x;
      out[i * 3 + 1] = _a.y;
      out[i * 3 + 2] = _a.z;
    }
    return Dangle.N;
  }

  get centre(): Vector3 {
    return this.H;
  }
}

