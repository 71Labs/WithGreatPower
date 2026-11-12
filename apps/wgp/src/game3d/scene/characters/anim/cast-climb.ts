/**
 * A cast member climbing a facade (Sandwich Man in Front-run's race, roam/frontrun.ts): the
 * hero's climb (roam-pose.ts) on any body, from the same wall frame, holds and gait
 * (wall-pose.ts). Hands and feet plant on holds on the face and never slide; they move in a
 * reach → pull → step cycle by the distance climbed (a scramble at his pace); the hips hug the
 * wall, the chest about a forearm off it, knees out, the head up at the next hold. At the top
 * the hands stop on the lip and press, so nothing paws the air over the roof.
 *
 * It writes over the pose the animator composed, by a weight, so the run into the wall and the
 * hop off its top blend in and out instead of snapping.
 */
import { Quaternion, Vector3 } from "three";

import type { Rig } from "../rig";
import { clamp, frameQuat, lerp, UP } from "./common";
import type { Pose } from "./pose";
import { CLIMB, ClimbGait, LH, RH, WallFrame, wallBody, type WallBody } from "./wall-pose";

/** The wrist on the lip at the top: this far under it. */
const LIP_DOWN = 2.5;
const TAU = Math.PI * 2;

const _on = new Vector3();
const _base = new Vector3();
const _h = new Vector3();
const _t = new Vector3();
const _f = new Vector3();
const _side = new Vector3();
const _rot = new Quaternion();
const _q = new Quaternion();
const _foot = new Quaternion();

export class CastClimb {
  private readonly wall = new WallFrame();
  private readonly body: WallBody;
  private readonly gait: ClimbGait;
  private readonly last = new Vector3();
  private readonly up = new Vector3();
  private readonly aim = [new Vector3(), new Vector3()];
  private fresh = true;
  private time = 0;

  constructor(private readonly rig: Rig) {
    this.body = wallBody(rig);
    this.gait = new ClimbGait(this.body);
  }

  /** Off the wall: the next climb places every hold fresh. */
  release(): void {
    this.fresh = true;
  }

  /** Which limbs (left hand, right hand, left foot, right foot) are on a hold (the headless checks). */
  planted(): [boolean, boolean, boolean, boolean] {
    return this.gait.planted();
  }

  /**
   * Blend `pose` toward the climb by `weight`. `P` is the body's centre; (`nx`, `nz`) the
   * face's outward normal; `face` how far the centre stands off it; `top` the face's top and
   * `floor` the ground at its foot.
   */
  apply(pose: Pose, P: Vector3, nx: number, nz: number, face: number, top: number, floor: number, dt: number, weight: number, reducedMotion: boolean): void {
    const b = this.body;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const w = this.wall.set(nx, nz, _on.copy(P).addScaledVector(_t.set(nx, 0, nz), -face), top);
    const base = _base.copy(P).addScaledVector(w.n, b.forearm * CLIMB.hipOff - face);
    const fresh = this.fresh;
    this.fresh = false;
    const du = fresh ? 0 : (P.x - this.last.x) * w.left.x + (P.z - this.last.z) * w.left.z;
    const dv = fresh ? 0 : P.y - this.last.y;
    this.last.copy(P);
    const g = this.gait;
    if (fresh) g.reset();
    g.step(w, base, du, dv, dt, floor);
    const holds = g.holds;

    // The body: hips in, leaning back just enough that the shoulders sit a forearm off; its
    // weight off the reaching hand, a surge with each pull, breathing at rest.
    const liftL = holds[LH].lift;
    const liftR = holds[RH].lift;
    const moving = clamp(g.speed / 50, 0, 1);
    const calm = reducedMotion ? 0 : 1;
    const surge = 1.6 * moving * Math.sin(g.phase * TAU * (g.mode === "fast" ? 2 : 4)) * calm;
    const breath = (1 - moving) * 0.5 * Math.sin(this.time * 2.4) * calm;
    const H = _h.copy(base).addScaledVector(w.left, 2.4 * (liftR - liftL));
    H.y += surge + breath;
    const lean = Math.atan2((CLIMB.shoulderOff - CLIMB.hipOff) * b.forearm, b.shoulderY);
    const up = this.up.copy(UP).multiplyScalar(Math.cos(lean)).addScaledVector(w.n, Math.sin(lean));
    frameQuat(up, w.fwd, _rot);
    _rot.premultiply(_q.setFromAxisAngle(w.fwd, -0.1 * (liftR - liftL)));

    pose.rot.slerp(_rot, weight);
    pose.root.lerp(_t.set(0, this.rig.hipHeight, 0).applyQuaternion(_rot).negate().add(H), weight);
    pose.hips.multiplyScalar(1 - weight);
    pose.hipsRot.multiplyScalar(1 - weight);
    pose.spine.lerp(_t.set(-0.04 + breath * 0.02, 0, 0), weight);
    pose.chest.lerp(_t.set(breath * 0.03, 0, 0), weight);
    // The head up toward the next hold, turned to the reaching hand.
    const headP = -0.5;
    const headY = 0.4 * (liftL - liftR);
    pose.neck.lerp(_t.set(headP * 0.35, headY * 0.3, 0), weight);
    pose.head.lerp(_t.set(headP * 0.65, headY * 0.7, 0), weight);
    const lip = top - LIP_DOWN;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      pose.clav[i].lerp(_t.set(0, 0, s * 0.25), weight);
      // A hand never goes over the top: it stops on the lip and presses as the body comes up past it.
      const hand = _t.copy(holds[i].pos);
      const onLip = hand.y > lip;
      if (onLip) hand.y = lip;
      pose.hand[i].lerp(hand, weight);
      pose.foot[i].lerp(holds[2 + i].pos, weight);
      // Elbows out and down (back when the hand is low); knees out to the sides, toward the wall.
      const hi = clamp((hand.y - (H.y + b.shoulderY)) / 16 + 0.5, 0, 1);
      pose.elbow[i].lerp(_t.set(s * lerp(0.75 * 0.7, 0.75, hi), lerp(-0.85, -0.5, hi), -0.45).normalize().applyQuaternion(_rot), weight);
      pose.knee[i].lerp(_t.set(s * 0.85, 0.05, 0.5).normalize().applyQuaternion(_rot), weight);
      if (weight > 0.5) {
        // Palm on the face, fingers over the hold (open as it reaches); toes on it, splayed.
        const lift = holds[i].lift;
        pose.handAim[i] = this.aim[i]
          .copy(UP)
          .multiplyScalar(0.85)
          .addScaledVector(w.fwd, 0.5 * (1 - lift))
          .addScaledVector(w.left, s * 0.12)
          .normalize();
        pose.grip[i] = onLip ? 0.3 : lerp(0.62, 0.12, lift);
      }
      const f = _f.copy(w.fwd).applyAxisAngle(UP, s * 0.3);
      frameQuat(UP, f, _foot);
      _side.crossVectors(UP, f).normalize();
      _foot.premultiply(_q.setFromAxisAngle(_side, 0.18 + 0.45 * holds[2 + i].lift));
      pose.footRot[i].slerp(_foot, weight);
    }
  }
}
