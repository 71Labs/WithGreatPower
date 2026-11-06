/**
 * The allies on their rooftops: each stands in character (Aunt Mainnet with her hands
 * clasped, Uncle Gen's behind his back, Mary JPEG's on her hips, Bearson's arms crossed,
 * Gwei crouched on her water tower), breathes and sways on springs, turns to face the hero
 * at a capped rate, re-planting its feet as it turns, and waves when the hero swings close.
 *
 * On an MPFB body the motion capture takes the upper body: the idle (breath, weight, small
 * looks) under the character's own arms while waiting; when the errand opens ("talk") a
 * reach toward the hero (the UAL's Interact) and then the talking idle, hands free. The
 * planted feet are re-solved under it. Gwei perches in the crouch idle.
 */
import { Quaternion, Vector3, type Group } from "three";

import { Spring } from "../physics/spring";
import { aimBone, worldQuat, type Rig } from "../rig";
import { ActorAnimator, type ActorInput } from "./actor";
import type { AnimContext as Ctx } from "./types";
import { Plant, UP, yawOf, yawQuat } from "./common";
import type { Pose } from "./pose";
import type { AnimContext } from "./types";

export type AllyStyle = "clasp" | "behind" | "hips" | "crossed" | "perch";

const _q = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const X = new Vector3(1, 0, 0);

export class AllyAnimator extends ActorAnimator {
  private readonly plants = [new Plant(), new Plant()];
  private phase = 0;
  private lastYaw = 0;
  private readonly wave = new Spring(8, 1);
  private readonly talk = new Spring(3, 1);
  private readonly styleW = new Spring(4, 1);
  /** Each ally's idle starts somewhere else in the loop. */
  private readonly seed = Math.random() * 10;

  constructor(
    rig: Rig,
    group: Group,
    private readonly kind: AllyStyle,
  ) {
    super(rig, group, 3.2);
  }

  protected get standHips(): number {
    return this.rig.hipHeight - (this.kind === "perch" ? 17 : this.clips ? 0.6 : 2);
  }

  protected yawTarget(input: ActorInput, ctx: AnimContext): number {
    const dx = ctx.hero.x - this.P.x;
    const dz = ctx.hero.z - this.P.z;
    if (dx * dx + dz * dz < 1600 * 1600 && dx * dx + dz * dz > 1) this.lastYaw = yawOf(dx, dz);
    return this.lastYaw;
  }

  protected beforeSteps(dt: number): void {
    // Turning re-plants the feet: a step whenever the stance has twisted far enough.
    const turning = Math.abs(this.turn.value - this.turn.prev) / Math.max(dt, 1e-3);
    if (turning > 0.2 || !this.plants[0].inStance || !this.plants[1].inStance) this.phase += dt * 2.4;
    // Without clips, an open errand waves too.
    this.wave.step(this.state === "wave" || (this.state === "talk" && !this.clips) ? 1 : 0, dt);
    this.talk.step(this.state === "talk" ? 1 : 0, dt);
    this.styleW.step(this.state === "idle" ? 1 : 0, dt);
  }

  protected onState(next: string, ctx: Ctx): void {
    super.onState(next, ctx);
    if (next === "talk") this.clips?.play("interact", { weight: 0.9, rate: 1.1 });
  }

  protected clipNames(): string[] {
    return this.kind === "perch" ? ["crouch-idle", "interact"] : ["idle", "idle-talk", "interact"];
  }

  protected layerClips(): void {
    const c = this.clips!;
    const t = this.time + this.seed;
    if (this.kind === "perch") {
      // Crouched on the tower's lid: the whole body in the crouch idle, its soles set down on
      // the lid (the clip's own hips would hold them a little above it), looking up at the hero.
      c.loops([["crouch-idle", t, 1]], 1, c.full, 1);
      this.soleTo(this.P.y);
      c.over(0.8, c.upper);
      this.lookAfterClips(0.9);
      this.reachHands(0, this.wave.value);
      return;
    }
    const talk = this.talk.value;
    c.loops(
      [
        ["idle", t, 1 - talk],
        ["idle-talk", t, talk],
      ],
      1,
      c.upper,
      0,
    );
    c.over(1);
    this.lookAfterClips(0.2);
    // The character's own arms while just waiting; the right hand up for a wave.
    const st = this.styleW.value * 0.85;
    const wave = this.wave.value;
    this.reachHands(st, Math.max(st, wave));
    if (wave > 0.3) {
      // The waving hand up, palm out.
      const arm = this.rig.arms[1];
      const up = _a.set(0, 1, 0).addScaledVector(_b.set(0, 0, 1).applyQuaternion(this.pose.rot), 0.25).normalize();
      aimBone(arm.end, arm.endAxis, worldQuat(arm.lower, _q2), up, _q3, this.rig.restQ[this.rig.index.get(arm.end.name)!]);
      arm.end.updateMatrixWorld(true);
    }
    this.plantLegs(1);
  }


  protected hips(out: Vector3): Vector3 {
    return out.set(this.P.x, this.P.y + this.standHips, this.P.z);
  }

  protected body(out: Quaternion): Quaternion {
    yawQuat(this.turn.value, out);
    const lean = this.kind === "perch" && !this.clips ? 0.35 : 0;
    return out.multiply(_q.setFromAxisAngle(X, lean + Math.sin(this.time * 1.1) * 0.025));
  }

  protected spineTarget(): [number, number] {
    return [Math.sin(this.time * 1.6) * 0.03, Math.sin(this.time * 0.8) * 0.03];
  }

  protected limb(i: number, hand: boolean, out: Vector3): Vector3 {
    const s = i === 0 ? 1 : -1;
    if (!hand) return out.set(s * 5.5, -this.standHips + this.rig.spec.ankle, 0);
    const w = this.wave.value;
    if (i === 1 && w > 0.01) {
      const base = this.rest(i, out);
      return base.lerp(_a.set(-17 + Math.sin(this.time * 9) * 6, 43, 3), w);
    }
    return this.rest(i, out);
  }

  private rest(i: number, out: Vector3): Vector3 {
    const s = i === 0 ? 1 : -1;
    const breathe = Math.sin(this.time * 1.6) * 0.5;
    switch (this.kind) {
      case "clasp":
        return out.set(s * 2.4, 8 + breathe, 9);
      case "behind":
        return out.set(s * 4.5, 4 + breathe, -7);
      case "hips":
        return out.set(s * 12, 4 + breathe, 1);
      case "crossed":
        return out.set(-s * 5, 14 + breathe, 9);
      case "perch":
        return out.set(s * 7, -6, 12);
    }
  }

  protected finish(pose: Pose, _alpha: number, ctx: AnimContext): void {
    const yawQ = yawQuat(this.turn.value, _q);
    const body = _b.set(this.P.x, this.P.y + this.rig.spec.ankle, this.P.z);
    const project = (p: Vector3) => {
      p.y = ctx.ground(p.x, p.z, this.P.y + 6) + this.rig.spec.ankle;
      if (p.y < this.P.y - 20) p.y = this.P.y + this.rig.spec.ankle;
      return p;
    };
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const off = _c.set(s * (this.kind === "perch" ? 7 : 5.5), 0, this.kind === "perch" ? 3 : 0).applyQuaternion(yawQ);
      const t = this.plants[i].update(this.phase + i * 0.5, 0.5, body, _a.set(0, 0, 0), 0, off, 3, UP, project);
      pose.foot[i].copy(t);
      pose.footRot[i].copy(yawQ);
      if (this.kind === "hips") pose.elbow[i].set(s, 0, -0.3).applyQuaternion(pose.rot);
      if (this.kind === "crossed") pose.elbow[i].set(s, -0.5, 0.2).applyQuaternion(pose.rot);
    }
  }
}
