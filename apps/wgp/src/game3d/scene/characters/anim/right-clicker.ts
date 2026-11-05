/**
 * The Right-Clicker (Case file 001), on the bridge deck, driven by his villain phases:
 *
 * - idle: the giant cursor rested on his shoulder like a bat, sizing the hero up; he walks
 *   (the hero's walk clip, phase-locked to the ground he covers) when the sim moves him;
 * - aim: SCREENSHOT. Both hands out, pointing the cursor down the cone (`aimDir`, the frame's
 *   aim), squared up and leaning in a touch;
 * - flash: the click's recoil up the arms;
 * - recover: reloading, the cursor fiddled back into shape, hunched and open to a hit;
 * - copy: Ctrl+C, the cursor swept across, the free hand tapping;
 * - drag: the lasso hauled back to the chest, leaning away;
 * - stunned: reeling, head lolling (and the base's dizzy circle);
 * - webbed (or defeat): the fall, held, lying on the deck.
 *
 * Hits flinch with the hero's hit clips (the base's `struck`). On his MPFB body the clips are
 * right-clicker-anims.glb (launch/brand/hero/rc_anims.py) over the cast's; until it arrives
 * the procedural body holds the same poses from its limb targets.
 */
import { Quaternion, Vector3, type Group } from "three";

import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import { Spring } from "../physics/spring";
import type { Rig } from "../rig";
import { ActorAnimator, type ActorInput } from "./actor";
import { clamp, smoothstep, yawOf, yawQuat } from "./common";
import type { Pose } from "./pose";
import type { AnimContext } from "./types";

const X = new Vector3(1, 0, 0);
const _q = new Quaternion();

/** States that end the fight: the fall, held. */
const DOWN = new Set(["webbed", "defeat", "down", "ko"]);

export class RightClickerAnimator extends ActorAnimator {
  /** The SCREENSHOT's direction (the frame villain's `aim.dir`), while he has one. */
  aimDir: Vec3 | null = null;
  private ground = 0;
  private readonly hy = new Spring(16, 0.95);
  private hyStarted = false;
  /** The walk cycle's phase (0–1) and how much he's walking. */
  private walkPhase = 0;
  private walkW = 0;

  constructor(rig: Rig, group: Group) {
    super(rig, group, 8);
  }

  protected get standHips(): number {
    return this.rig.hipHeight - 1.5;
  }

  /** Square to the cone while aiming and clicking; else the base's (facing, moving, the hero). */
  protected yawTarget(input: ActorInput, ctx: AnimContext): number {
    const a = this.aimDir;
    if (a && Math.abs(a.x) + Math.abs(a.z) > 1e-3 && (input.state === "aim" || input.state === "flash")) return yawOf(a.x, a.z);
    return super.yawTarget(input, ctx);
  }

  protected beforeSteps(dt: number, ctx: AnimContext): void {
    const P = this.P;
    this.ground = ctx.ground(P.x, P.z, P.y + 2);
    const crouch = this.state === "recover" ? 2.5 : this.state === "stunned" ? 1.5 : 0;
    const target = this.ground + this.standHips - crouch;
    if (!this.hyStarted) {
      this.hy.snap(target);
      this.hyStarted = true;
    }
    this.hy.step(target, dt);
    const hs = Math.hypot(this.V.x, this.V.z);
    const walking = this.state === "idle" || this.state === "recover" || this.state === "copy";
    this.walkW = walking ? smoothstep(18, 80, hs) : 0;
    const c = this.clips;
    const stride = c?.stride("walk")?.stride ?? 95;
    this.walkPhase = (this.walkPhase + (hs * dt) / Math.max(20, stride)) % 1;
  }

  protected hips(out: Vector3, alpha: number): Vector3 {
    const bob = this.clips ? 0 : this.walkW * 1.6 * (0.5 + 0.5 * Math.cos(this.walkPhase * Math.PI * 4));
    return out.set(this.P.x, this.hy.lerp(alpha) - bob, this.P.z);
  }

  protected body(out: Quaternion): Quaternion {
    yawQuat(this.turn.value, out);
    const st = this.state;
    const t = this.stateT;
    let lean = 0;
    if (st === "aim") lean = 0.06;
    else if (st === "flash") lean = 0.06 - 0.14 * Math.exp(-t * 9);
    else if (st === "recover") lean = 0.16;
    else if (st === "drag") lean = -0.18 * smoothstep(0.1, 0.5, t);
    else if (st === "idle") lean = clamp(Math.hypot(this.vel.x, this.vel.z) / 600, 0, 0.12);
    return out.multiply(_q.setFromAxisAngle(X, lean));
  }

  protected spineTarget(): [number, number] {
    // Reloading, he hunches over the cursor; reeling, he sways.
    if (this.state === "recover") return [0.18, 0];
    if (this.state === "stunned") return [0.1 + Math.sin(this.time * 5) * 0.08, Math.sin(this.time * 3.7) * 0.12];
    return [0, 0];
  }

  protected limb(i: number, hand: boolean, out: Vector3): Vector3 {
    const s = i === 0 ? 1 : -1;
    if (!hand) {
      // Feet at hip width, the right a little back (his stance); a stride when walking.
      const sw = Math.sin((this.walkPhase + i * 0.5) * Math.PI * 2) * 11 * this.walkW;
      const lift = Math.max(0, Math.cos((this.walkPhase + i * 0.5) * Math.PI * 2)) * 4 * this.walkW;
      return out.set(s * 5.8, -this.standHips + this.rig.spec.ankle + lift, (i === 1 ? -3 : 2) + sw);
    }
    const t = this.stateT;
    switch (this.state) {
      case "aim":
        return i === 1 ? out.set(-3, 27, 30) : out.set(-1, 25, 25);
      case "flash": {
        const kick = Math.exp(-t * 10) * 6;
        return i === 1 ? out.set(-3, 27 + kick, 30 - kick) : out.set(-1, 25 + kick, 25 - kick);
      }
      case "recover":
        return i === 1 ? out.set(-4, 16, 14) : out.set(2, 17, 15);
      case "copy": {
        const sweep = Math.sin(clamp(t / 1.2, 0, 1) * Math.PI * 2) * 14;
        return i === 1 ? out.set(-3 + sweep, 26, 28) : out.set(4, 19, 16);
      }
      case "drag": {
        const pull = smoothstep(0.15, 0.7, t / 1.0);
        return i === 1 ? out.set(-4 - pull * 3, 26 - pull * 6, 30 - pull * 22) : out.set(6, 6, 6);
      }
      case "stunned": {
        const wob = Math.sin(this.time * 3 + i * 2) * 2;
        return out.set(s * 13, -4 + wob, 3);
      }
      default:
        // The cursor on his right shoulder; the left hand loose.
        return i === 1 ? out.set(-9, 27, 3) : out.set(9, -4, 3);
    }
  }

  protected finish(pose: Pose): void {
    // His right fist round the cursor's stem; the left open unless it's on the cursor too.
    pose.grip[1] = 1;
    pose.grip[0] = this.state === "aim" || this.state === "flash" ? 0.8 : 0.3;
    if (DOWN.has(this.state)) return;
    // Feet on the deck.
    for (let i = 0; i < 2; i++) pose.foot[i].y = Math.max(pose.foot[i].y, this.ground + this.rig.spec.ankle);
  }

  protected canDangle(): boolean {
    // He's beaten on the deck: he falls and lies there, he doesn't hang.
    return false;
  }

  protected onState(next: string, ctx: AnimContext): void {
    super.onState(next, ctx);
    const c = this.clips;
    if (!c) return;
    if (DOWN.has(next) && next !== "webbed") c.play("death", { weight: 1, hold: true, full: true });
    else if (next === "flash") c.play("rc-click", { weight: 1, rate: 1.1 });
    else if (next === "recover") c.play("rc-reload", { weight: 0.9, rate: 1.4 });
    else if (next === "copy") c.play("rc-copy", { weight: 1 });
    else if (next === "drag") c.play("rc-drag", { weight: 1 });
  }

  protected clipNames(): string[] {
    return ["rc-idle", "rc-aim", "rc-click", "rc-reload", "rc-copy", "rc-drag", "rc-stagger", "walk", "hit-chest", "hit-head", "death"];
  }

  protected layerClips(): void {
    const c = this.clips!;
    const st = this.state;
    if (DOWN.has(st)) {
      c.over(1);
      return;
    }
    const t = this.time;
    if (st === "stunned") {
      c.loops([["rc-stagger", t, 1]], 1, c.upper, 0);
      c.over(1);
      this.lookAfterClips(0.05);
      this.plantLegs(1);
      return;
    }
    const aimed = st === "aim" || st === "flash" || st === "copy" || st === "drag";
    const has = (n: string) => c.has(n);
    if (aimed && has("rc-aim")) c.loops([["rc-aim", t, 1]], 1, c.upper, 0);
    else if (has("rc-idle")) c.loops([["rc-idle", t, 1]], st === "recover" ? 0.5 : 0.95, c.upper, 0);
    const w = this.walkW;
    if (w > 0.001 && has("walk")) {
      const sd = c.stride("walk");
      const phase = sd ? (this.walkPhase + sd.strike) % 1 : this.walkPhase;
      c.loops([["walk", phase * c.duration("walk"), 1]], w, c.legs, 1);
      this.group.position.y -= c.floor * w;
      this.group.updateMatrixWorld(true);
    }
    c.over(1);
    this.lookAfterClips(aimed ? 0 : 0.12);
    this.plantLegs(1 - w);
  }
}
