/**
 * A light Verlet ragdoll for knockouts: fifteen particles (head, neck, pelvis, shoulders,
 * elbows, wrists, hip joints, knees, ankles) held by bone-length links, a braced torso box
 * and soft limb straighteners, falling onto the roof under gravity. It starts from the
 * pose the body was in and the speed it had, and drives the rig back through the usual
 * pose (body frame from the torso, IK limbs toward the particles).
 */
import { Quaternion, Vector3 } from "three";

import { Verlet } from "../physics/verlet";
import { worldPos, type Rig } from "../rig";
import { frameQuat } from "./common";
import type { Pose, Solved } from "./pose";

export const RAG = {
  head: 0,
  neck: 1,
  pelvis: 2,
  shoulderL: 3,
  elbowL: 4,
  wristL: 5,
  shoulderR: 6,
  elbowR: 7,
  wristR: 8,
  hipL: 9,
  kneeL: 10,
  ankleL: 11,
  hipR: 12,
  kneeR: 13,
  ankleR: 14,
} as const;

const LINKS: [number, number, number][] = [
  // [a, b, stiffness]
  [RAG.head, RAG.neck, 1],
  [RAG.neck, RAG.shoulderL, 1],
  [RAG.neck, RAG.shoulderR, 1],
  [RAG.shoulderL, RAG.shoulderR, 1],
  [RAG.neck, RAG.pelvis, 1],
  [RAG.shoulderL, RAG.hipL, 1],
  [RAG.shoulderR, RAG.hipR, 1],
  [RAG.shoulderL, RAG.hipR, 1],
  [RAG.shoulderR, RAG.hipL, 1],
  [RAG.pelvis, RAG.hipL, 1],
  [RAG.pelvis, RAG.hipR, 1],
  [RAG.hipL, RAG.hipR, 1],
  [RAG.head, RAG.shoulderL, 0.5],
  [RAG.head, RAG.shoulderR, 0.5],
  [RAG.shoulderL, RAG.elbowL, 1],
  [RAG.elbowL, RAG.wristL, 1],
  [RAG.shoulderR, RAG.elbowR, 1],
  [RAG.elbowR, RAG.wristR, 1],
  [RAG.hipL, RAG.kneeL, 1],
  [RAG.kneeL, RAG.ankleL, 1],
  [RAG.hipR, RAG.kneeR, 1],
  [RAG.kneeR, RAG.ankleR, 1],
];

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _q = new Quaternion();

export class Ragdoll {
  readonly v = new Verlet(15, { gravity: 1750, damping: 0.015, iterations: 8 });
  private readonly p = new Vector3();

  constructor(ground: (x: number, z: number, y: number) => number) {
    this.v.floor = ground;
    this.v.radius = 2.5;
    this.v.friction = 0.35;
  }

  /** Start from the rig's current pose, moving at `vel` with a tumble. */
  start(rig: Rig, solved: Solved, vel: Vector3, h: number, spin: number): void {
    const v = this.v;
    const put = (i: number, p: Vector3) => v.place(i, p.x, p.y, p.z);
    put(RAG.head, worldPos(rig.get("head"), _a).add(_b.set(0, 6, 0)));
    put(RAG.neck, worldPos(rig.get("neck"), _a));
    put(RAG.pelvis, worldPos(rig.get("hips"), _a));
    put(RAG.shoulderL, worldPos(rig.get("armL"), _a));
    put(RAG.shoulderR, worldPos(rig.get("armR"), _a));
    put(RAG.elbowL, solved.elbow[0]);
    put(RAG.elbowR, solved.elbow[1]);
    put(RAG.wristL, solved.wrist[0]);
    put(RAG.wristR, solved.wrist[1]);
    put(RAG.hipL, worldPos(rig.get("thighL"), _a));
    put(RAG.hipR, worldPos(rig.get("thighR"), _a));
    put(RAG.kneeL, solved.knee[0]);
    put(RAG.kneeR, solved.knee[1]);
    put(RAG.ankleL, solved.ankle[0]);
    put(RAG.ankleR, solved.ankle[1]);
    if (v.constraints === 0) {
      for (const [a, b, k] of LINKS) v.link(a, b, undefined, k);
      // Soft straighteners keep elbows and knees from folding flat.
      const leg = rig.legs[0].l1 + rig.legs[0].l2;
      const arm = rig.arms[0].l1 + rig.arms[0].l2;
      v.link(RAG.hipL, RAG.ankleL, leg * 0.9, 0.06);
      v.link(RAG.hipR, RAG.ankleR, leg * 0.9, 0.06);
      v.link(RAG.shoulderL, RAG.wristL, arm * 0.8, 0.04);
      v.link(RAG.shoulderR, RAG.wristR, arm * 0.8, 0.04);
    }
    // Moving with the body, plus a tumble: the head goes one way, the feet the other.
    const pelvisY = v.pos[RAG.pelvis * 3 + 1];
    for (let i = 0; i < v.n; i++) {
      const up = v.pos[i * 3 + 1] - pelvisY;
      v.setVelocity(i, vel.x + up * spin * 0.6, vel.y, vel.z - up * spin * 0.4, h);
    }
  }

  step(h: number, pull: Vector3 | null): void {
    const v = this.v;
    v.integrate(h);
    if (pull) {
      // A weak tether to where the sim says the body is, so the two never drift apart.
      const k = RAG.pelvis * 3;
      v.pos[k] += (pull.x - v.pos[k]) * 0.01;
      v.pos[k + 2] += (pull.z - v.pos[k + 2]) * 0.01;
    }
    v.solve();
  }

  /** Write the ragdoll into a pose (drawn `alpha` of the way through the last sub-step). */
  toPose(rig: Rig, pose: Pose, alpha: number): void {
    const v = this.v;
    const pelvis = v.sample(RAG.pelvis, alpha, this.p);
    const neck = v.sample(RAG.neck, alpha, _a);
    const sl = v.sample(RAG.shoulderL, alpha, _b);
    const sr = v.sample(RAG.shoulderR, alpha, _c);
    const up = neck.sub(pelvis).normalize();
    const left = sl.sub(sr).normalize();
    const fwd = left.cross(up);
    frameQuat(up, fwd, pose.rot);
    pose.root.copy(pelvis).sub(_a.set(0, rig.hipHeight, 0).applyQuaternion(pose.rot));
    pose.hips.set(0, 0, 0);
    pose.hipsRot.set(0, 0, 0);
    pose.spine.set(0, 0, 0);
    pose.chest.set(0, 0, 0);
    pose.neck.set(0.15, 0, 0);
    pose.head.set(0.25, 0, 0.2);
    v.sample(RAG.wristL, alpha, pose.hand[0]);
    v.sample(RAG.wristR, alpha, pose.hand[1]);
    v.sample(RAG.ankleL, alpha, pose.foot[0]);
    v.sample(RAG.ankleR, alpha, pose.foot[1]);
    const pole = (mid: number, a: number, b: number, out: Vector3) => {
      const m = v.sample(mid, alpha, out);
      v.sample(a, alpha, _b);
      v.sample(b, alpha, _c);
      return m.sub(_b.add(_c).multiplyScalar(0.5)).normalize();
    };
    pole(RAG.elbowL, RAG.shoulderL, RAG.wristL, pose.elbow[0]);
    pole(RAG.elbowR, RAG.shoulderR, RAG.wristR, pose.elbow[1]);
    pole(RAG.kneeL, RAG.hipL, RAG.ankleL, pose.knee[0]);
    pole(RAG.kneeR, RAG.hipR, RAG.ankleR, pose.knee[1]);
    pose.handAim[0] = null;
    pose.handAim[1] = null;
    pose.footRot[0].copy(pose.rot).multiply(_q.setFromAxisAngle(_a.set(1, 0, 0), 0.6));
    pose.footRot[1].copy(pose.footRot[0]);
  }

  /** Particle positions for the debug overlay. */
  points(): Float32Array {
    return this.v.pos;
  }
}
