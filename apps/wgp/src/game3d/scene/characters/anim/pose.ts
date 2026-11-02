/**
 * A pose, and putting it on a rig. Animators fill a `Pose` (where the soles are and how the
 * body is turned, spine and head angles, and world-space targets for the hands and feet);
 * `applyPose` writes the bones: FK down the spine, then analytic two-bone IK for every limb
 * with its elbow or knee bending toward a pole, hands aimed or curled, feet turned flat.
 */
import { Euler, Quaternion, Vector3, type Group } from "three";

import { solveTwoBone } from "../physics/ik";
import { aimBone, setWorldQuat, worldPos, worldQuat, type Limb, type Rig } from "../rig";

export interface Pose {
  /** Soles (the rig's origin) in world space, and the body's rotation about them. */
  root: Vector3;
  rot: Quaternion;
  /** Hips moved from rest, in the root's frame (a crouch is negative y). */
  hips: Vector3;
  /** Local rotations (x pitch forward, y yaw left, z roll), radians. */
  hipsRot: Vector3;
  spine: Vector3;
  chest: Vector3;
  neck: Vector3;
  head: Vector3;
  /** Clavicle shrug per side (z raises the shoulder). */
  clav: [Vector3, Vector3];
  /** World targets: wrists and ankles. */
  hand: [Vector3, Vector3];
  foot: [Vector3, Vector3];
  /** World directions elbows and knees bend toward. */
  elbow: [Vector3, Vector3];
  knee: [Vector3, Vector3];
  /** Aim a hand along a world direction (a fist on the web line), or null to curl it. */
  handAim: [Vector3 | null, Vector3 | null];
  /** Hand curl when not aimed (local Euler). */
  handRot: [Vector3, Vector3];
  /** Feet: world rotation (turned with the body, toes down in a jump). */
  footRot: [Quaternion, Quaternion];
  /** Extra bones (a glider): local rotation and scale. */
  extra: Map<string, { rot: Quaternion; scale: number }>;
}

const v = () => new Vector3();
export function newPose(): Pose {
  return {
    root: v(),
    rot: new Quaternion(),
    hips: v(),
    hipsRot: v(),
    spine: v(),
    chest: v(),
    neck: v(),
    head: v(),
    clav: [v(), v()],
    hand: [v(), v()],
    foot: [v(), v()],
    elbow: [new Vector3(0, -0.3, -1), new Vector3(0, -0.3, -1)],
    knee: [new Vector3(0, 0, 1), new Vector3(0, 0, 1)],
    handAim: [null, null],
    handRot: [v(), v()],
    footRot: [new Quaternion(), new Quaternion()],
    extra: new Map(),
  };
}

const _e = new Euler(0, 0, 0, "YXZ");
const _q = new Quaternion();
const _qa = new Quaternion();
const _qb = new Quaternion();
const _s = new Vector3();
const _m = new Vector3();
const _t = new Vector3();
const _d = new Vector3();

const setRot = (q: Quaternion, a: Vector3) => q.setFromEuler(_e.set(a.x, a.y, a.z, "YXZ"));

/** Solved limb joints, written by applyPose (world space), for the debug overlay and the web hand. */
export interface Solved {
  elbow: [Vector3, Vector3];
  wrist: [Vector3, Vector3];
  knee: [Vector3, Vector3];
  ankle: [Vector3, Vector3];
}

export function newSolved(): Solved {
  return { elbow: [v(), v()], wrist: [v(), v()], knee: [v(), v()], ankle: [v(), v()] };
}

function solveLimb(limb: Limb, target: Vector3, pole: Vector3, outMid: Vector3, outEnd: Vector3, outQ: Quaternion) {
  worldPos(limb.upper, _s);
  solveTwoBone(_s, target, limb.l1, limb.l2, pole, outMid, outEnd);
  worldQuat(limb.parent, _qa);
  aimBone(limb.upper, limb.axis1, _qa, _d.copy(outMid).sub(_s), _qb);
  aimBone(limb.lower, limb.axis2, _qb, _d.copy(outEnd).sub(outMid), outQ);
}

export function applyPose(rig: Rig, group: Group, p: Pose, solved?: Solved): void {
  const b = rig.bones;
  const get = (n: string) => rig.get(n);
  group.position.copy(p.root);
  const root = b[0];
  root.position.set(0, 0, 0);
  root.quaternion.copy(p.rot);
  const hips = get("hips");
  hips.position.copy(rig.rest[rig.index.get("hips")!]).add(p.hips);
  setRot(hips.quaternion, p.hipsRot);
  setRot(get("spine").quaternion, p.spine);
  setRot(get("chest").quaternion, p.chest);
  setRot(get("neck").quaternion, p.neck);
  setRot(get("head").quaternion, p.head);
  setRot(get("clavL").quaternion, p.clav[0]);
  setRot(get("clavR").quaternion, p.clav[1]);
  for (const [name, x] of p.extra) {
    const bone = get(name);
    bone.quaternion.copy(x.rot);
    bone.scale.setScalar(x.scale);
  }
  group.updateMatrixWorld(true);

  for (let i = 0; i < 2; i++) {
    const arm = rig.arms[i];
    const mid = solved ? solved.elbow[i] : _m;
    const end = solved ? solved.wrist[i] : _t;
    solveLimb(arm, p.hand[i], p.elbow[i], mid, end, _q);
    const aim = p.handAim[i];
    if (aim) aimBone(arm.end, arm.axis2, _q, aim, _qa);
    else setRot(arm.end.quaternion, p.handRot[i]);
  }
  for (let i = 0; i < 2; i++) {
    const leg = rig.legs[i];
    const mid = solved ? solved.knee[i] : _m;
    const end = solved ? solved.ankle[i] : _t;
    solveLimb(leg, p.foot[i], p.knee[i], mid, end, _q);
    setWorldQuat(leg.end, _q, p.footRot[i]);
  }
  for (const limb of [...rig.arms, ...rig.legs]) limb.upper.updateMatrixWorld(true);
}
