/**
 * The villains' animators, each driven by the motion the sim gives it:
 *
 * - Gas Goblin surfs his glider: it banks into turns (the sim's bank, else his sideways
 *   acceleration) and pitches with his climb or dive, over a hover bob; he crouches on it
 *   with his feet IK-planted on the deck, winds up a throw, dives, guards, and goes limp
 *   when stunned.
 * - Sandwich Man runs the roofs on a distance-driven gait, jumps ballistically (tucked on
 *   the way up, reaching down on the way down), crouches to wind up and dives to tackle.
 * - Doc Octochain hovers, legs dangling on springs, swaying; he winds up with his arms
 *   raised, leans into an attack and slumps, panting, when his chains retract (his chain
 *   arms themselves are chains.ts).
 * - The Sybil floats on a gooey tail, undulating, and points to shoot.
 */
import { Quaternion, Vector3, type Group } from "three";

import { Spring } from "../physics/spring";
import type { Rig } from "../rig";
import { ActorAnimator } from "./actor";
import { bodyPoint, clamp, frameQuat, Plant, smoothstep, UP, yawQuat } from "./common";
import type { Pose } from "./pose";
import type { AnimContext } from "./types";

const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);
const _q = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

/* ------------------------------------------------------------------ Gas Goblin */

export class GoblinAnimator extends ActorAnimator {
  private readonly bank = new Spring(7, 0.7);
  private readonly pitch = new Spring(6, 0.75);
  private readonly gliderRot = new Quaternion();

  protected get standHips(): number {
    return this.rig.hipHeight - 9;
  }

  protected beforeSteps(dt: number): void {
    // Bank from sideways acceleration, pitch from climb or dive.
    const left = _a.set(Math.cos(this.turn.value), 0, -Math.sin(this.turn.value));
    const lateral = this.acc.vx * left.x + this.acc.vz * left.z;
    const fast = this.state === "attack" ? 0.45 : 0;
    // The sim's own bank when it sends one (v1.2); else from the sideways acceleration.
    this.bank.step(this.bankIn ?? clamp(-lateral / 1100, -0.55, 0.55), dt);
    this.pitch.step(clamp(-this.vel.y / 850, -0.35, 0.5) + fast, dt);
  }

  protected hips(out: Vector3): Vector3 {
    const bob = Math.sin(this.time * 2.3) * 3;
    return out.set(this.P.x, this.P.y - 6 + bob, this.P.z);
  }

  protected body(out: Quaternion): Quaternion {
    yawQuat(this.turn.value, out);
    out.multiply(_q.setFromAxisAngle(Z, this.bank.value));
    out.multiply(_q.setFromAxisAngle(X, this.pitch.value));
    if (this.state === "stunned") out.multiply(_q.setFromAxisAngle(Z, Math.sin(this.time * 8) * 0.3));
    return out;
  }

  protected spineTarget(): [number, number] {
    // He leans back to throw, into the dive, and holds his head up through a bank.
    const p = this.state === "windup" ? -0.3 : this.state === "attack" ? 0.35 : 0.1;
    return [p, -this.bank.value * 0.5];
  }

  protected limb(i: number, hand: boolean, out: Vector3): Vector3 {
    const s = i === 0 ? 1 : -1;
    if (!hand) return out.set(s * 5.5, -this.standHips + this.rig.spec.ankle, s * 3);
    const wob = Math.sin(this.time * 3 + i * 2) * 2;
    switch (this.state) {
      case "windup":
        return i === 1 ? out.set(-9, 30, -6) : out.set(16, 8, 6);
      case "attack":
        return out.set(s * 11, 3, -13);
      case "guard":
        return out.set(-s * 4, 13, 9);
      case "stunned":
        return out.set(s * 12, -6 + wob, 2);
      default:
        return out.set(s * 18, 6 + wob, 3);
    }
  }

  protected finish(pose: Pose): void {
    // Feet stand on the deck (the glider is part of the root's frame).
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      bodyPoint(pose.root, pose.rot, s * 5.5, this.rig.spec.ankle, s * 3, pose.foot[i]);
      pose.footRot[i].copy(pose.rot);
    }
  }

  protected extras(pose: Pose): void {
    // The glider wobbles on its own when he's stunned, and falls away once he's caught.
    this.gliderRot.identity();
    if (this.state === "stunned") this.gliderRot.setFromAxisAngle(Z, Math.sin(this.time * 11) * 0.12);
    const x = pose.extra.get("glider") ?? { rot: new Quaternion(), scale: 1 };
    x.rot.copy(this.gliderRot);
    x.scale = this.dangle.active ? 0.0001 : 1;
    pose.extra.set("glider", x);
  }
}

/* ------------------------------------------------------------------ Sandwich Man */

export class SandwichAnimator extends ActorAnimator {
  private readonly plants = [new Plant(), new Plant()];
  private phase = 0;
  private grounded = true;
  private wasGrounded = true;
  private ground = 0;
  private readonly lift = new Spring(15, 0.9);
  private readonly squash = new Spring(14, 0.45);
  private readonly gw = new Spring(14, 1);
  private lying = false;

  constructor(rig: Rig, group: Group) {
    super(rig, group, 7);
  }

  protected beforeSteps(dt: number, ctx: AnimContext): void {
    const P = this.P;
    this.ground = ctx.ground(P.x, P.z, P.y + 2);
    this.grounded = Math.abs(this.vel.y) < 90 && P.y - this.ground < 50 && this.state !== "attack";
    if (this.grounded && !this.wasGrounded) {
      this.squash.impulse(-clamp(Math.abs(this.V.y) * 0.18, 30, 220));
      for (let i = 0; i < 2; i++) this.plants[i].plantAt(_a.set(P.x + (i === 0 ? 6 : -6), this.ground + this.rig.spec.ankle, P.z));
    }
    this.wasGrounded = this.grounded;
    const hs = Math.hypot(this.V.x, this.V.z);
    if (this.grounded) this.phase += (hs * dt) / (70 + hs * 0.1);
    const crouch = this.state === "windup" ? 10 : 0;
    this.lift.step(this.grounded ? this.ground + this.standHips - crouch - P.y : 0, dt);
    this.squash.step(0, dt);
    this.gw.step(this.grounded ? 1 : 0, dt);
  }

  protected canDangle(): boolean {
    this.lying = this.grounded;
    return !this.grounded;
  }

  protected hips(out: Vector3, alpha: number): Vector3 {
    if (this.lying && this.state === "webbed") return out.set(this.P.x, this.ground + 8, this.P.z);
    const hs = Math.hypot(this.V.x, this.V.z);
    const runW = this.grounded ? smoothstep(25, 160, hs) : 0;
    const bob = runW * 2.6 * (0.5 + 0.5 * Math.cos(this.phase * Math.PI * 4));
    return out.set(this.P.x, this.P.y + this.lift.lerp(alpha) + this.squash.lerp(alpha) - bob, this.P.z);
  }

  protected body(out: Quaternion): Quaternion {
    if (this.lying && this.state === "webbed") {
      // Toppled on the roof, wriggling.
      yawQuat(this.turn.value, out);
      return out.multiply(_q.setFromAxisAngle(X, -1.45 + Math.sin(this.time * 4) * 0.05));
    }
    if (this.state === "attack") {
      const v = _a.set(this.vel.x, this.vel.y, this.vel.z);
      const len = v.length();
      if (len > 1) return frameQuat(_b.copy(v).divideScalar(len).addScaledVector(UP, 0.4).normalize(), _c.set(0, -1, 0), out);
    }
    yawQuat(this.turn.value, out);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const lean = this.grounded ? clamp(hs / 300, 0, 1) * 0.22 + (this.state === "windup" ? 0.35 : 0) : clamp(-this.vel.y / 1400, -0.25, 0.35);
    return out.multiply(_q.setFromAxisAngle(X, lean));
  }

  protected spineTarget(): [number, number] {
    return [this.state === "windup" ? 0.2 : 0, 0];
  }

  protected limb(i: number, hand: boolean, out: Vector3): Vector3 {
    const s = i === 0 ? 1 : -1;
    const vy = this.vel.y;
    if (hand) {
      switch (this.state) {
        case "attack":
          return out.set(s * 7, 40, 5);
        case "windup":
          return out.set(s * 12, 2, -13);
        case "guard":
          return out.set(s * 7, 26, 10);
        default:
          if (!this.grounded) return vy > 0 ? out.set(s * 14, 22, 4) : out.set(s * 21, 10, 0);
          {
            const sw = Math.sin(this.phase * Math.PI * 2) * s;
            const hs = Math.hypot(this.V.x, this.V.z);
            const runW = smoothstep(25, 160, hs);
            out.set(s * 14, -1, 3);
            return out.lerp(_b.set(s * 11, 7 + Math.abs(sw) * 4, sw * 14), runW);
          }
      }
    }
    if (this.state === "attack") return out.set(s * 5, -40, -4);
    return vy > 0 ? out.set(s * 5.5, -22, 9) : out.set(s * 6.5, -36, 4);
  }

  protected finish(pose: Pose, alpha: number, ctx: AnimContext): void {
    if (this.lying && this.state === "webbed") return;
    const w = this.gw.lerp(alpha);
    if (w < 0.001) return;
    const hs = Math.hypot(this.V.x, this.V.z);
    const runW = smoothstep(25, 160, hs);
    const yawQ = yawQuat(this.turn.value, _q);
    const fwd = _a.set(0, 0, 1).applyQuaternion(yawQ);
    const body = _b.set(this.P.x, this.ground + this.rig.spec.ankle, this.P.z);
    const H = this.H;
    const project = (p: Vector3) => {
      p.y = Math.max(ctx.ground(p.x, p.z, H.y), H.y - this.rig.hipHeight - 26) + this.rig.spec.ankle;
      return p;
    };
    for (let i = 0; i < 2; i++) {
      const off = _c.set(i === 0 ? 6 : -6, 0, 0).applyQuaternion(yawQ);
      const L = 70 + hs * 0.1;
      const t = this.plants[i].update(this.phase + i * 0.5, 0.45, body, fwd, L * Math.max(0.15, runW), off, 4 + 6 * runW, UP, project);
      pose.foot[i].lerp(t, w);
      if (w > 0.5) pose.footRot[i].copy(yawQ);
    }
  }
}

/* ------------------------------------------------------------------ Doc Octochain */

export class DocAnimator extends ActorAnimator {
  protected hips(out: Vector3): Vector3 {
    return out.set(this.P.x, this.P.y - 4, this.P.z);
  }

  protected body(out: Quaternion): Quaternion {
    yawQuat(this.turn.value, out);
    const sway = Math.sin(this.time * 0.9) * 0.06;
    const lean = this.state === "windup" ? -0.28 : this.state === "attack" ? 0.22 : this.state === "open" ? 0.32 : 0;
    out.multiply(_q.setFromAxisAngle(X, lean + sway));
    return out.multiply(_q.setFromAxisAngle(Z, Math.sin(this.time * 0.7) * 0.05));
  }

  protected spineTarget(): [number, number] {
    // Out of breath with his chains in: the chest heaves.
    const pant = this.state === "open" ? 0.12 + Math.sin(this.time * 6) * 0.07 : 0;
    return [pant, 0];
  }

  protected limb(i: number, hand: boolean, out: Vector3): Vector3 {
    const s = i === 0 ? 1 : -1;
    if (!hand) {
      const swing = Math.sin(this.time * 1.3 + i * 1.7) * 3;
      return out.set(s * 6.5, -36, 3 + swing);
    }
    switch (this.state) {
      case "windup":
        return out.set(s * 15, 36, 0);
      case "attack":
        return i === 1 ? out.set(-6, 24, 22) : out.set(16, 10, 4);
      case "open":
        return out.set(s * 9, -3, 9);
      case "guard":
        return out.set(-s * 4, 14, 10);
      default: {
        // Rubbing his hands.
        const rub = Math.sin(this.time * 4) * 1.5 * s;
        return out.set(s * 3.5 + rub, 13, 11);
      }
    }
  }
}

/* ------------------------------------------------------------------ The Sybil */

export class SybilAnimator extends ActorAnimator {
  protected hips(out: Vector3): Vector3 {
    return out.set(this.P.x, this.P.y - 6 + Math.sin(this.time * 1.8) * 4, this.P.z);
  }

  protected body(out: Quaternion): Quaternion {
    yawQuat(this.turn.value, out);
    out.multiply(_q.setFromAxisAngle(X, 0.1 + Math.sin(this.time * 1.3) * 0.08));
    return out.multiply(_q.setFromAxisAngle(Z, Math.sin(this.time * 1.1) * 0.1));
  }

  protected spineTarget(): [number, number] {
    return [Math.sin(this.time * 2.1) * 0.12, Math.sin(this.time * 1.7) * 0.1];
  }

  protected limb(i: number, hand: boolean, out: Vector3): Vector3 {
    const s = i === 0 ? 1 : -1;
    // The tail hangs from the leg bones: near straight, swaying on the foot springs.
    if (!hand) return out.set(s * 1.5, -40, -2 + Math.sin(this.time * 1.4) * 3);
    const sway = Math.sin(this.time * 2.2 + i * 1.9);
    switch (this.state) {
      case "windup":
      case "attack":
        return i === 1 ? out.set(-6, 22, 22) : out.set(17, 6 + sway * 3, 4);
      case "guard":
        return out.set(-s * 5, 14, 10);
      default:
        return out.set(s * (17 + sway * 2), 3 + sway * 5, 6 + Math.cos(this.time * 1.6 + i) * 3);
    }
  }
}
