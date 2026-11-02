/**
 * The hero's animator: the body follows the sim's real motion, never a canned clip.
 *
 * - Swing: the body hangs along the rope with its centre of mass on the line; the web
 *   hand is IK-pinned to the line above the head (the web starts at that fist); the free
 *   limbs ride springs in the body's accelerating frame, so the arc's centripetal load
 *   stretches them out and the swing phase tucks the knees through the bottom and kicks
 *   them out on the rise.
 * - Air: the pose follows vertical velocity (a reach on the rise, an arched dive, a
 *   brace for landing), limbs on springs. A perfect release somersaults at a spin rate
 *   fitted to the release speed.
 * - Ground: a run cycle whose phase advances by distance travelled, so planted feet never
 *   slide; feet IK onto the roof; landing compression scaled by the impact; breathing.
 * - Climb: hands and feet planted on the wall in alternation, the web hand on the line.
 * - Dash, slam (a dive, then the impact crouch), held (struggling), hurt (a kick into the
 *   spine and head springs) and KO (a Verlet ragdoll).
 *
 * Everything stateful steps on the kit's fixed 120 Hz sub-step and is drawn interpolated,
 * so nothing shakes with the sim's 60 Hz ticks or the display's rate.
 */
import { Quaternion, Vector3, type Group } from "three";

import type { HeroAction, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import { Spring, Spring3 } from "../physics/spring";
import { FixedStepper } from "../physics/stepper";
import { worldPos, worldQuat, type Rig } from "../rig";
import { angleTo, bodyPoint, clamp, frameQuat, lerp, Orient, Plant, smoothstep, Turn, UP, yawOf, yawQuat } from "./common";
import { applyPose, newPose, newSolved, type Pose, type Solved } from "./pose";
import { Ragdoll } from "./ragdoll";
import type { AnimContext } from "./types";

type Base = "ground" | "swing" | "air" | "climb" | "dash" | "slam" | "ko";

const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);
const _q = new Quaternion();
const _q2 = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();

/** Where the web leaves the fist, past the wrist along the hand. */
const GRIP = 3.4;

export class HeroAnimator {
  readonly pose: Pose = newPose();
  readonly solved: Solved = newSolved();
  /** The fist on the web line (world), valid after update. */
  readonly grip = new Vector3();
  /** IK targets this frame, for the debug overlay. */
  readonly targets: Vector3[] = [];
  base: Base = "ground";
  action: HeroAction = "idle";

  private readonly clock = new FixedStepper();
  private readonly vel = new Spring3(30, 1);
  private readonly acc = new Spring3(14, 1);
  private readonly turn = new Turn(10, 0.07);
  private readonly orient = new Orient(14);
  private readonly lift = new Spring(16, 0.9);
  private readonly squash = new Spring(15, 0.42);
  private readonly lean = new Spring(9, 0.8);
  private readonly spineP = new Spring(11, 0.42);
  private readonly spineR = new Spring(11, 0.5);
  private readonly headP = new Spring(12, 0.38);
  private readonly headY = new Spring(10, 0.8);
  private readonly hands = [new Spring3(15, 0.62), new Spring3(15, 0.62)];
  private readonly feet = [new Spring3(13, 0.6), new Spring3(13, 0.6)];
  private readonly groundW = new Spring(16, 1);
  private readonly gripW = new Spring(34, 1);
  private readonly plants = [new Plant(), new Plant()];
  private readonly wall = [new Plant(), new Plant(), new Plant()];
  private readonly ragdoll: Ragdoll;
  private phase = 0;
  private climb = 0;
  private flipT = -1;
  private flipDur = 0.6;
  private impactT = 0;
  private hurtT = 0;
  private lastFlash = 0;
  private wasGrounded = true;
  private wasBase: Base = "ground";
  private lastVy = 0;
  private readonly lastPos = new Vector3();
  private started = false;
  private readonly P = new Vector3();
  private readonly H = new Vector3();
  private readonly Q = new Quaternion();
  private readonly anchor = new Vector3();
  private readonly wallN = new Vector3(0, 0, -1);
  private wallD = 30;
  private readonly fwd = new Vector3(0, 0, 1);
  private readonly look = new Vector3();
  private hasLook = false;
  private time = 0;

  private readonly aim = new Vector3();
  private readonly sa = new Vector3();
  private readonly sb = new Vector3();

  constructor(
    private readonly rig: Rig,
    private readonly group: Group,
    ctx: AnimContext,
  ) {
    this.ragdoll = new Ragdoll(ctx.ground);
    for (let i = 0; i < 8; i++) this.targets.push(new Vector3());
  }

  /** A perfect release: somersault at a rate fitted to the release speed. */
  flip(reducedMotion: boolean): void {
    if (reducedMotion || this.base === "ko") return;
    const speed = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    const rate = clamp(speed / 95, 8, 15);
    this.flipDur = (Math.PI * 2) / rate;
    this.flipT = 0;
  }

  /** Something to look at (the villain in a fight), or null. */
  lookAt(p: Vec3 | null): void {
    this.hasLook = p !== null;
    if (p) this.look.set(p.x, p.y, p.z);
  }

  /**
   * The frame's v1.2 body fields (action, facing), once they're seen being filled: a frame
   * built from defaults that nobody updates (an older loop, a lab script) would otherwise pin
   * the body to "idle" facing +x. Until then everything is derived from the motion.
   */
  private live = false;
  private act: HeroAction | undefined;
  private fac: Vec3 | undefined;

  private deriveBase(f: RenderFrame3D, speed: number, ctx: AnimContext): Base {
    const h = f.hero;
    const a = this.act;
    if (f.mode === "ko" || a === "ko") return "ko";
    if (a === "dash") return "dash";
    if (a === "slam") return "slam";
    if (a === "climb") return "climb";
    // Standing on a roof with the web still held (the sim takes up the slack): on its feet,
    // the web hand keeping the line.
    if (h.grounded && h.anchor) return "ground";
    if (h.anchor) {
      if (a === "swing") return "swing";
      // Without the sim's word: slow, against a wall, the web above — climbing.
      if (speed < 350 && h.anchor.y > h.pos.y + 20) {
        const dx = h.anchor.x - h.pos.x;
        const dz = h.anchor.z - h.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const hit = ctx.ray(h.pos, _a.set(dx / d, 0, dz / d), 48);
        if (hit !== null) return "climb";
      }
      return "swing";
    }
    if (h.grounded || (a !== undefined && (a === "idle" || a === "run"))) return "ground";
    if (h.vel.y < -1300) return "slam";
    return "air";
  }

  update(f: RenderFrame3D, dt: number, ctx: AnimContext): void {
    const h = f.hero;
    const P = this.P.set(h.pos.x, h.pos.y, h.pos.z);
    if (!this.started || P.distanceTo(this.lastPos) > 260) this.reset(f, ctx);
    this.time += dt;
    if (!this.live && ((h.actionTicks ?? 0) > 0 || (h.action !== undefined && h.action !== "idle"))) this.live = true;
    this.act = this.live ? h.action : undefined;
    this.fac = this.live ? h.facing : undefined;
    const speed = Math.hypot(h.vel.x, h.vel.y, h.vel.z);
    const base = this.deriveBase(f, speed, ctx);
    this.action = this.act ?? (base === "ground" ? (Math.hypot(h.vel.x, h.vel.z) > 40 ? "run" : "idle") : base === "ko" ? "ko" : (base as HeroAction));
    const grounded = base === "ground";
    if (h.anchor) this.anchor.set(h.anchor.x, h.anchor.y, h.anchor.z);

    // Events read off the motion: a landing, a hit, the end of a slam.
    if (grounded && !this.wasGrounded) {
      const impact = Math.max(-this.lastVy, 0) + Math.hypot(h.vel.x, h.vel.z) * 0.15;
      this.squash.impulse(-clamp(impact * 0.2, 40, 330));
      const ground = ctx.ground(P.x, P.z, P.y + 4);
      for (let i = 0; i < 2; i++) this.plants[i].plantAt(_a.set(P.x + (i === 0 ? 5 : -5), ground + this.rig.spec.ankle, P.z));
      if (this.wasBase === "slam") this.impactT = 0.55;
    }
    const flash = h.hurtFlash;
    if ((this.act === "hurt" && this.action !== this.lastAction) || flash > this.lastFlash + 0.3) this.hurt();
    this.lastAction = this.action;
    this.lastFlash = flash;
    if (base === "ko" && this.wasBase !== "ko") {
      this.ragdoll.start(this.rig, this.solved, _a.set(this.vel.x, this.vel.y, this.vel.z), this.clock.h, 2.5 + Math.random());
    }
    if (base === "climb") {
      const dx = this.anchor.x - P.x;
      const dz = this.anchor.z - P.z;
      const d = Math.hypot(dx, dz) || 1;
      // Buildings are axis-aligned: snap the wall's normal to the nearest axis.
      if (Math.abs(dx) > Math.abs(dz)) this.wallN.set(-Math.sign(dx), 0, 0);
      else this.wallN.set(0, 0, -Math.sign(dz));
      const hit = ctx.ray(h.pos, _a.copy(this.wallN).negate(), 80);
      this.wallD = hit ?? clamp(d, 20, 60);
    }

    // The yaw the body wants.
    let yaw = this.turn.value;
    const hs = Math.hypot(h.vel.x, h.vel.z);
    const fac = this.fac;
    if (fac && Math.abs(fac.x) + Math.abs(fac.z) > 0.1) yaw = yawOf(fac.x, fac.z);
    else if (base === "climb") yaw = yawOf(-this.wallN.x, -this.wallN.z);
    else if (hs > (grounded ? 30 : 70)) yaw = yawOf(h.vel.x, h.vel.z);
    if (base === "climb") yaw = yawOf(-this.wallN.x, -this.wallN.z);

    const ground = ctx.ground(P.x, P.z, P.y + 4);
    const rig = this.rig;
    const runW = grounded ? smoothstep(25, 140, hs) : 0;
    const L = 64 + hs * 0.1;

    // Gait and wall-climb phases advance by distance, measured from the drawn position.
    const moved = Math.hypot(P.x - this.lastPos.x, P.z - this.lastPos.z);
    if (grounded) {
      const settling = !this.plants[0].inStance || !this.plants[1].inStance || this.footOff(P, ground) > 7;
      this.phase += Math.max(moved / L, settling && runW < 0.2 ? dt * 2.2 : 0);
    }
    if (base === "climb") this.climb += Math.abs(P.y - this.lastPos.y) / 26;
    this.lastPos.copy(P);
    this.lastVy = h.vel.y;
    this.wasGrounded = grounded;
    this.wasBase = base;
    this.base = base;
    if (this.impactT > 0) this.impactT = Math.max(0, this.impactT - dt);
    if (this.hurtT > 0) this.hurtT = Math.max(0, this.hurtT - dt);

    const held = this.act === "held";
    this.clock.advance(dt, (step) => this.substep(step, f, base, yaw, ground, runW, held));
    if (this.flipT >= 0) {
      // Caught by the next web, a wall or the roof mid-somersault: finish the turn quickly.
      this.flipT += dt * (base === "air" || base === "dash" ? 1 : 3.5);
      if (this.flipT >= this.flipDur) this.flipT = -1;
    }
    this.compose(f, base, ground, runW, L, ctx);
    applyPose(rig, this.group, this.pose, this.solved);
    // The fist: past the wrist along the hand's axis.
    const hand = rig.arms[1].end;
    worldPos(hand, this.grip);
    _a.copy(rig.arms[1].axis2).applyQuaternion(worldQuat(hand, _q));
    this.grip.addScaledVector(_a, GRIP);
  }

  private lastAction: HeroAction = "idle";

  private hurt(): void {
    this.hurtT = 0.35;
    this.spineP.impulse(-7);
    this.spineR.impulse((Math.random() - 0.5) * 8);
    this.headP.impulse(-12);
    for (const s of this.hands) s.impulse((Math.random() - 0.5) * 500, 260, (Math.random() - 0.5) * 500);
  }

  private footOff(P: Vector3, ground: number): number {
    let worst = 0;
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? 5.2 : -5.2;
      bodyPoint(_d.set(P.x, ground + this.rig.spec.ankle, P.z), yawQuat(this.turn.value, _q2), sx, 0, 0, _c);
      worst = Math.max(worst, _c.distanceTo(this.plants[i].at));
    }
    return worst;
  }

  private reset(f: RenderFrame3D, ctx: AnimContext): void {
    const h = f.hero;
    this.started = true;
    this.lastPos.set(h.pos.x, h.pos.y, h.pos.z);
    this.vel.snap(h.vel.x, h.vel.y, h.vel.z);
    this.acc.snap(0, 0, 0);
    const yaw = Math.hypot(h.vel.x, h.vel.z) > 40 ? yawOf(h.vel.x, h.vel.z) : this.fac ? yawOf(this.fac.x, this.fac.z) : this.turn.value;
    this.turn.snap(yaw);
    this.orient.snap(yawQuat(yaw, _q));
    const ground = ctx.ground(h.pos.x, h.pos.z, h.pos.y + 4);
    this.lift.snap(h.grounded ? ground + this.rig.hipHeight - 1.2 - h.pos.y : 0);
    this.squash.snap(0);
    this.groundW.snap(h.grounded ? 1 : 0);
    for (let i = 0; i < 2; i++) {
      this.plants[i].plantAt(_a.set(h.pos.x + (i === 0 ? 5 : -5), ground + this.rig.spec.ankle, h.pos.z));
      this.hands[i].snap(0, -2, 0);
      this.feet[i].snap(0, -36, 0);
    }
    this.wasGrounded = h.grounded;
    this.clock.reset();
  }

  /** The body's target rotation for this base state. */
  private bodyTarget(base: Base, out: Quaternion): Quaternion {
    const v = _a.set(this.vel.x, this.vel.y, this.vel.z);
    const speed = v.length();
    yawQuat(this.turn.value, out);
    this.fwd.set(Math.sin(this.turn.value), 0, Math.cos(this.turn.value));
    switch (base) {
      case "swing": {
        const up = _b.copy(this.anchor).sub(this.P).normalize();
        // Facing along the arc: the velocity with its rope component removed.
        const t = _c.copy(v).addScaledVector(up, -v.dot(up));
        const fw = t.lengthSq() > 120 * 120 ? t : this.fwd;
        frameQuat(up, fw, out);
        // One-arm hang: the web shoulder rides up toward the line.
        return out.multiply(_q2.setFromAxisAngle(Z, -0.22));
      }
      case "air": {
        const vy = v.y;
        const hsp = Math.hypot(v.x, v.z);
        const up = _b.copy(UP);
        if (speed > 1) {
          const rise = smoothstep(150, 900, vy) * 0.45 * smoothstep(300, 900, speed);
          const dive = smoothstep(-250, -900, vy) * smoothstep(250, 700, hsp) * 0.8;
          up.lerp(_c.copy(v).divideScalar(speed), rise).normalize();
          up.lerp(_c.copy(v).divideScalar(speed), dive).normalize();
        }
        return frameQuat(up, this.fwd, out);
      }
      case "dash": {
        const dir = speed > 1 ? _c.copy(v).divideScalar(speed) : this.fwd;
        return frameQuat(_b.copy(dir).addScaledVector(UP, 0.45).normalize(), _d.set(0, -1, 0), out);
      }
      case "slam":
        return frameQuat(_b.copy(this.fwd).multiplyScalar(0.35).addScaledVector(UP, -1).normalize(), this.fwd, out);
      case "ground": {
        if (this.impactT > 0) return out.multiply(_q2.setFromAxisAngle(X, 0.12));
        return out.multiply(_q2.setFromAxisAngle(X, this.lean.value));
      }
      default:
        return out;
    }
  }

  private substep(step: number, f: RenderFrame3D, base: Base, yaw: number, ground: number, runW: number, held: boolean): void {
    const h = f.hero;
    this.vel.step(h.vel.x, h.vel.y, h.vel.z, step);
    this.acc.step(this.vel.vx, this.vel.vy, this.vel.vz, step);
    this.turn.step(yaw, step);
    const grounded = base === "ground";
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.lean.step(grounded ? clamp(hs / 390, 0, 1.3) * 0.2 + clamp(this.accFwd() * 0.00005, -0.12, 0.15) : 0, step);
    const k = base === "swing" ? 11 : base === "air" ? 6.5 : base === "dash" || base === "slam" ? 16 : base === "climb" ? 12 : 15;
    this.orient.step(this.bodyTarget(base, _q), step, k);
    const hipH = this.rig.hipHeight;
    this.lift.step(grounded || base === "climb" ? (grounded ? ground + hipH - 1.2 - h.pos.y : 0) : 0, step);
    this.squash.step(0, step);
    this.groundW.step(grounded ? 1 : 0, step);
    this.gripW.step(base === "swing" || base === "climb" || (base === "ground" && h.anchor) ? 1 : 0, step);
    // Spine and head settle back to straight; hits kick them.
    const breathe = grounded ? Math.sin(this.time * 1.7) * 0.025 : 0;
    this.spineP.step((grounded ? -this.squash.value * 0.02 : 0) + breathe + (held ? Math.sin(this.time * 31) * 0.08 : 0), step);
    this.spineR.step(held ? Math.sin(this.time * 23) * 0.12 : 0, step);
    this.headP.step(0, step);
    this.headY.step(this.lookYaw(), step);

    // Limb springs ride the body: targets in the body frame, offsets kept relative to the
    // hips, pulled by gravity and pushed by the body's own acceleration (the arc's load).
    const Q = this.flipQuat(this.orient.q, _q);
    const g = _b.set(-this.acc.vx, -1750 - this.acc.vy, -this.acc.vz).multiplyScalar(0.5);
    const gl = g.length();
    if (gl > 3200) g.multiplyScalar(3200 / gl);
    for (let i = 0; i < 2; i++) {
      this.limbTarget(i, true, base, runW, held, _c);
      _c.applyQuaternion(Q);
      this.hands[i].step(_c.x, _c.y, _c.z, step, g.x, g.y, g.z);
      this.limbTarget(i, false, base, runW, held, _c);
      _c.applyQuaternion(Q);
      this.feet[i].step(_c.x, _c.y, _c.z, step, g.x * 0.8, g.y * 0.8, g.z * 0.8);
    }
    if (base === "ko") this.ragdoll.step(step, this.P);
  }

  private accFwd(): number {
    return this.acc.vx * Math.sin(this.turn.value) + this.acc.vz * Math.cos(this.turn.value);
  }

  private lookYaw(): number {
    if (!this.hasLook) return 0;
    const yaw = yawOf(this.look.x - this.P.x, this.look.z - this.P.z);
    return clamp(angleTo(this.turn.value, yaw), -1.1, 1.1) * 0.8;
  }

  /** The somersault on top of the body rotation, about the body's left axis. */
  private flipQuat(q: Quaternion, out: Quaternion): Quaternion {
    out.copy(q);
    if (this.flipT < 0) return out;
    const u = clamp(this.flipT / this.flipDur, 0, 1);
    const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
    const axis = _d.copy(X).applyQuaternion(q);
    return out.premultiply(_q2.setFromAxisAngle(axis, e * Math.PI * 2));
  }

  private tuck(): number {
    if (this.flipT < 0) return 0;
    return Math.sin(Math.PI * clamp(this.flipT / this.flipDur, 0, 1));
  }

  /** A hand (or foot) target in the body frame, relative to the hips. */
  private limbTarget(i: number, hand: boolean, base: Base, runW: number, held: boolean, out: Vector3): Vector3 {
    const s = i === 0 ? 1 : -1;
    const vy = this.vel.y;
    const t = this.time;
    const tuck = this.tuck();
    if (hand) {
      if (tuck > 0.05) return out.set(s * 7, lerp(4, -6, tuck), lerp(6, 11, tuck));
      if (held) return out.set(s * 10.5, 1, 2.5);
      switch (base) {
        case "ground": {
          if (this.impactT > 0 && i === 0) return out.set(16, 14, -14);
          const sw = Math.sin(this.phase * Math.PI * 2) * s;
          const idle = out.set(s * 12, -3 + Math.sin(t * 1.7 + i) * 0.5, 2.5);
          return idle.lerp(_d.set(s * 10.5, 6 + Math.abs(sw) * 4, sw * 13), runW);
        }
        case "swing": {
          const [rise, bottom] = this.swingPhase();
          if (i === 1) return out.set(-4, 40, 2);
          out.set(15, -4, -6);
          out.lerp(_d.set(15, 6, 14), bottom);
          return out.lerp(_d.set(11, 28, 16), rise);
        }
        case "climb":
          return out.set(s * 9, 26, 6);
        case "dash":
          return i === 1 ? out.set(-5, 42, 3) : out.set(12, -3, -4);
        case "slam":
          return out.set(s * 7, 41, 5);
        default: {
          const rise = smoothstep(80, 600, vy);
          const fall = 1 - rise;
          out.set(s * 20, 15, 2).multiplyScalar(fall);
          if (i === 1) out.add(_d.set(-6, 35, 13).multiplyScalar(rise));
          else out.add(_d.set(13, 1, -9).multiplyScalar(rise));
          return out;
        }
      }
    }
    if (tuck > 0.05) return out.set(s * 5, lerp(-30, -17, tuck), lerp(4, 9, tuck));
    switch (base) {
      case "swing": {
        const [rise, bottom] = this.swingPhase();
        out.set(s * 4.5, -34, -8);
        out.lerp(_d.set(s * 4.5, -17, 12), bottom);
        return out.lerp(_d.set(s * 4.5, -35, 11), rise);
      }
      case "dash":
        return out.set(s * 5, -38, -3);
      case "slam":
        return out.set(s * 5, -36, -5);
      case "climb":
        return out.set(s * 5, -28, 5);
      default: {
        const rise = smoothstep(80, 600, vy);
        const dive = smoothstep(-250, -900, vy) * smoothstep(250, 700, Math.hypot(this.vel.x, this.vel.z));
        out.set(s * 5.5, -28, 9);
        out.lerp(i === 0 ? _d.set(5, -35, -6) : _d.set(-5, -25, 8), rise);
        return out.lerp(_d.set(s * 8, -33, -10), dive);
      }
    }
  }

  /** [rising past the bottom, near the bottom] for the swing pose, from the rope angle. */
  private swingPhase(): [number, number] {
    const up = this.sa.copy(this.anchor).sub(this.P);
    const len = up.length() || 1;
    up.divideScalar(len);
    const fromVertical = Math.acos(clamp(up.y, -1, 1));
    const v = this.sb.set(this.vel.x, this.vel.y, this.vel.z);
    const rising = v.y > 60 ? smoothstep(0.25, 0.8, fromVertical) : 0;
    const speed = v.length();
    const bottom = (1 - smoothstep(0.15, 0.7, fromVertical)) * smoothstep(250, 700, speed);
    return [rising, bottom];
  }

  private compose(f: RenderFrame3D, base: Base, ground: number, runW: number, L: number, ctx: AnimContext): void {
    const h = f.hero;
    const pose = this.pose;
    const a = this.clock.alpha;
    const rig = this.rig;
    const spec = rig.spec;
    if (base === "ko") {
      this.ragdoll.toPose(rig, pose, a);
      this.H.copy(pose.root).add(_a.set(0, rig.hipHeight, 0).applyQuaternion(pose.rot));
      this.collectTargets();
      return;
    }
    const Q = this.flipQuat(this.orient.lerp(a, this.Q), _q);
    this.Q.copy(Q);
    // The hips (centre of mass): the sim's point, lifted onto the legs when standing.
    const H = this.H.set(h.pos.x, h.pos.y + this.lift.lerp(a) + this.squash.lerp(a), h.pos.z);
    const bob = runW * 2.2 * (0.5 + 0.5 * Math.cos(this.phase * Math.PI * 4));
    H.y -= bob;
    if (this.impactT > 0) H.y -= 15 * smoothstep(0, 0.12, 0.55 - this.impactT) * smoothstep(0, 0.25, this.impactT);
    pose.rot.copy(Q);
    pose.root.copy(H).sub(_a.set(0, rig.hipHeight, 0).applyQuaternion(Q));
    pose.hips.set(0, 0, 0);
    const sw = Math.sin(this.phase * Math.PI * 2);
    pose.hipsRot.set(0, -sw * 0.14 * runW, 0);
    pose.spine.set(this.spineP.lerp(a) + runW * 0.06, sw * 0.12 * runW, this.spineR.lerp(a));
    pose.chest.set(base === "ground" ? -this.squash.lerp(a) * 0.012 : 0, sw * 0.16 * runW, 0);
    pose.neck.set(-pose.spine.x * 0.5, this.headY.lerp(a) * 0.4, 0);
    pose.head.set(this.headP.lerp(a) - runW * 0.08 + (base === "slam" ? -0.5 : 0) + (base === "dash" ? -0.6 : 0), this.headY.lerp(a) * 0.6, base === "swing" ? 0.18 : 0);
    pose.clav[0].set(0, 0, 0);
    pose.clav[1].set(0, 0, base === "swing" ? -0.25 : 0);

    // Hands: spring-driven, the web hand pinned to the rope.
    for (let i = 0; i < 2; i++) this.hands[i].lerp(a, pose.hand[i]).add(H);
    pose.handAim[0] = null;
    pose.handAim[1] = null;
    const gw = this.gripW.lerp(a);
    if (gw > 0.001 && h.anchor) {
      const dir = _b.copy(this.anchor).sub(H);
      const len = dir.length();
      dir.divideScalar(len || 1);
      // The fist sits on the H → anchor line; the wrist just below it.
      const reach = base === "climb" ? 30 + 5 * Math.sin(this.climb * Math.PI * 2) : 42;
      const fist = _c.copy(H).addScaledVector(dir, Math.min(reach, len - 2));
      fist.addScaledVector(dir, -GRIP);
      pose.hand[1].lerp(fist, gw);
      if (gw > 0.5) pose.handAim[1] = this.aim.copy(dir);
    }
    // Feet: springs in the air, planted on the roof when standing.
    for (let i = 0; i < 2; i++) this.feet[i].lerp(a, pose.foot[i]).add(H);
    const gwt = this.groundW.lerp(a);
    const yawQ = yawQuat(this.turn.lerp(a), _q2);
    const fwd = _a.set(0, 0, 1).applyQuaternion(yawQ);
    const project = (p: Vector3) => {
      const top = ctx.ground(p.x, p.z, H.y);
      p.y = Math.max(top, H.y - rig.hipHeight - 26) + spec.ankle;
      return p;
    };
    if (gwt > 0.001) {
      const body = _c.set(h.pos.x, ground + spec.ankle, h.pos.z);
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        const off = _b.set(s * 5.2, 0, 0).applyQuaternion(yawQ);
        const stance = 0.5 - runW * 0.08;
        const target = this.plants[i].update(this.phase + i * 0.5, stance, body, fwd, L * Math.max(0.15, runW), off, 4 + 5 * runW, UP, project);
        if (this.impactT > 0) {
          // The superhero landing: left foot forward, right knee down.
          bodyPoint(body, yawQ, i === 0 ? 5 : -5, 0, i === 0 ? 9 : -11, target);
          project(target);
        }
        pose.foot[i].lerp(target, gwt);
      }
      if (this.impactT > 0) {
        // Right fist on the roof.
        const fist = bodyPoint(body, yawQ, -9, 0, 12, _d);
        fist.y = ground + 2;
        pose.hand[1].copy(fist);
      }
    }
    // Climbing: left hand and both feet planted on the wall, alternating.
    if (base === "climb") {
      const wallX = h.pos.x - this.wallN.x * (this.wallD - 3);
      const wallZ = h.pos.z - this.wallN.z * (this.wallD - 3);
      const onWall = (p: Vector3) => {
        if (this.wallN.x !== 0) p.x = wallX + this.wallN.x * 3;
        else p.z = wallZ + this.wallN.z * 3;
        return p;
      };
      const left = _b.set(1, 0, 0).applyQuaternion(yawQ);
      const limbs: [number, number, number][] = [
        [5, 21, 0],
        [-5.5, -30, 0.5],
        [5.5, -30, 0],
      ];
      for (let k = 0; k < 3; k++) {
        const [x, y, ph] = limbs[k];
        const off = _c.copy(left).multiplyScalar(x).addScaledVector(UP, y);
        const target = this.wall[k].update(this.climb + ph, 0.55, H, UP, 26, off, 3, _d.copy(this.wallN), onWall);
        if (k === 0) pose.hand[0].copy(target);
        else pose.foot[k - 1].copy(target);
      }
    }

    // Poles: elbows back and down (out to the side on the web arm), knees forward.
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      pose.elbow[i].set(s * 0.45, -0.5, -1).applyQuaternion(Q);
      if (i === 1 && gw > 0.5) pose.elbow[i].set(-1, -0.2, 0.2).applyQuaternion(Q);
      pose.knee[i].set(s * 0.15, 0, 1).applyQuaternion(Q);
      pose.handRot[i].set(0, 0, 0);
      if (gwt > 0.5) pose.footRot[i].copy(yawQ);
      else pose.footRot[i].copy(Q).multiply(_q2.setFromAxisAngle(X, 0.55));
      if (gwt > 0.5 && this.plants[i].lift > 0) pose.footRot[i].multiply(_q2.setFromAxisAngle(X, this.plants[i].lift * 0.5));
    }
    this.collectTargets();
  }

  private collectTargets(): void {
    const p = this.pose;
    this.targets[0].copy(p.hand[0]);
    this.targets[1].copy(p.hand[1]);
    this.targets[2].copy(p.foot[0]);
    this.targets[3].copy(p.foot[1]);
    this.targets[4].copy(this.H);
    this.targets[5].copy(this.grip);
  }

  /** Ragdoll particles while knocked out (debug), else null. */
  ragdollPoints(): Float32Array | null {
    return this.base === "ko" ? this.ragdoll.points() : null;
  }

  /** The body's current rotation and centre of mass, for the shadow and the camera. */
  get centre(): Vector3 {
    return this.H;
  }
}
