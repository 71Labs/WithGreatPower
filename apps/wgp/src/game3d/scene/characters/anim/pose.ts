/**
 * A pose, and putting it on a rig. Animators fill a `Pose` (where the soles are and how the
 * body is turned, spine and head angles, and world-space targets for the hands and feet);
 * `applyPose` writes the bones: FK down the spine, then analytic two-bone IK for every limb
 * with its elbow or knee bending toward a pole, hands aimed or curled, feet turned flat, and
 * fingers (on a rig that has them) between open and a fist.
 *
 * Every write goes through the rig's rest rotations (rig.ts), so the same pose drives the
 * procedural cast and the hero's MPFB body.
 */
import { Euler, Quaternion, Vector3, type Group } from "three";

import { solveTwoBone } from "../physics/ik";
import { aimBone, aimHinge, setBoneDelta, setWorldQuat, worldPos, worldQuat, type Limb, type Rig } from "../rig";

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
  /** Hands with fingers: 0 open … 1 a fist. */
  grip: [number, number];
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
    grip: [0, 0],
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

const _w = new Quaternion();
const _n = new Vector3();
const _u = new Vector3();
const _id = new Quaternion();

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

function solveLimb(rig: Rig, limb: Limb, target: Vector3, pole: Vector3, outMid: Vector3, outEnd: Vector3, outQ: Quaternion) {
  worldPos(limb.upper, _s);
  solveTwoBone(_s, target, limb.l1, limb.l2, pole, outMid, outEnd);
  worldQuat(limb.parent, _qa);
  if (!limb.hinge) {
    aimBone(limb.upper, limb.axis1, _qa, _d.copy(outMid).sub(_s), _qb);
    aimBone(limb.lower, limb.axis2, _qb, _d.copy(outEnd).sub(outMid), outQ);
    return;
  }
  // The bend plane's normal: root → end crossed with the side the joint bends to (the pole
  // side, which the solver used), so a straight limb still knows which way it would bend.
  _d.copy(outEnd).sub(_s).normalize();
  _u.copy(outMid).sub(_s);
  _n.copy(_u).addScaledVector(_d, -_d.dot(_u));
  if (_n.lengthSq() < 1e-6) _n.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_n.lengthSq() < 1e-10) _n.set(_d.y, -_d.z, _d.x).cross(_d);
  _n.crossVectors(_d, _n.normalize());
  aimHinge(limb.upper, limb.hinge, _qa, _u, _n, _qb);
  aimBone(limb.lower, limb.axis2, _qb, _d.copy(outEnd).sub(outMid), outQ, rig.restQ[rig.index.get(limb.lower.name)!]);
}

const delta = (rig: Rig, i: number, a: Vector3) => setBoneDelta(rig, i, setRot(_w, a));

const _keep = new Quaternion();
const _mid = new Vector3();
const _end = new Vector3();

/**
 * Re-solve one limb (after something moved its root, like a mocap layer) to reach `target`
 * bending toward `pole`. The end bone keeps its world rotation, or takes `endWorld`.
 * World matrices must be current; the limb's are updated after.
 */
export function reachLimb(rig: Rig, limb: Limb, target: Vector3, pole: Vector3, endWorld?: Quaternion): void {
  worldQuat(limb.end, _keep);
  if (endWorld) _keep.copy(endWorld);
  solveLimb(rig, limb, target, pole, _mid, _end, _q);
  setWorldQuat(limb.end, _q, _keep);
  limb.upper.updateMatrixWorld(true);
}

/** Turn bone i by `d` on top of its current pose, about axes fixed in its parent's rest frame. */
export function addBoneDelta(rig: Rig, i: number, d: Quaternion): void {
  const bone = rig.bones[i];
  if (rig.identityRest) {
    bone.quaternion.premultiply(d);
    return;
  }
  const p0 = rig.parentRest[i];
  bone.quaternion.premultiply(_w.copy(p0).invert().multiply(d).multiply(p0));
}

/** Fingers from open (0) to a fist (1). */
function poseFingers(rig: Rig, grip: [number, number]): void {
  const hands = rig.fingers;
  if (!hands) return;
  for (let i = 0; i < 2; i++) {
    const g = grip[i] < 0 ? 0 : grip[i] > 1 ? 1 : grip[i];
    for (const j of hands[i]) j.bone.quaternion.slerpQuaternions(j.open, j.fist, g);
  }
}

export function applyPose(rig: Rig, group: Group, p: Pose, solved?: Solved): void {
  const b = rig.bones;
  const at = (n: string) => rig.index.get(n)!;
  group.position.copy(p.root);
  const root = b[0];
  root.position.copy(rig.rest[0]);
  setBoneDelta(rig, 0, p.rot);
  const hi = at("hips");
  const hips = b[hi];
  hips.position.copy(p.hips);
  if (!rig.identityRest) hips.position.applyQuaternion(_w.copy(rig.parentRest[hi]).invert());
  hips.position.add(rig.rest[hi]);
  delta(rig, hi, p.hipsRot);
  if (rig.spine.length === 1) delta(rig, rig.spine[0], p.spine);
  else {
    // Spread over the lower back's bones: equal shares that compose to the whole turn.
    setRot(_w, p.spine);
    _qa.copy(_id).slerp(_w, 1 / rig.spine.length);
    for (const i of rig.spine) setBoneDelta(rig, i, _qa);
  }
  delta(rig, at("chest"), p.chest);
  delta(rig, at("neck"), p.neck);
  delta(rig, at("head"), p.head);
  delta(rig, at("clavL"), p.clav[0]);
  delta(rig, at("clavR"), p.clav[1]);
  const get = (n: string) => rig.get(n);
  for (const [name, x] of p.extra) {
    const i = rig.index.get(name);
    if (i === undefined) continue;
    setBoneDelta(rig, i, x.rot);
    get(name).scale.setScalar(x.scale);
  }
  group.updateMatrixWorld(true);

  for (let i = 0; i < 2; i++) {
    const arm = rig.arms[i];
    const mid = solved ? solved.elbow[i] : _m;
    const end = solved ? solved.wrist[i] : _t;
    solveLimb(rig, arm, p.hand[i], p.elbow[i], mid, end, _q);
    const aim = p.handAim[i];
    const hand = at(arm.end.name);
    if (aim) aimBone(arm.end, arm.endAxis, _q, aim, _qa, rig.identityRest ? undefined : rig.restQ[hand]);
    else delta(rig, hand, p.handRot[i]);
  }
  poseFingers(rig, p.grip);
  for (let i = 0; i < 2; i++) {
    const leg = rig.legs[i];
    const mid = solved ? solved.knee[i] : _m;
    const end = solved ? solved.ankle[i] : _t;
    solveLimb(rig, leg, p.foot[i], p.knee[i], mid, end, _q);
    if (rig.identityRest) setWorldQuat(leg.end, _q, p.footRot[i]);
    else setWorldQuat(leg.end, _q, _w.copy(p.footRot[i]).multiply(rig.restWorld[at(leg.end.name)]));
  }
  for (const limb of [...rig.arms, ...rig.legs]) limb.upper.updateMatrixWorld(true);
}
