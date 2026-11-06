/**
 * Free roam's wall and parkour poses for the hero, from the frame's v1.7 `roam` (the UAL has no
 * climb, vault, wall-run or mantle clips, so these are procedural, on the same two-bone IK as
 * every pose):
 *
 * - climb: hands and feet planted on holds on the facade, the body hugging it (hips in, the
 *   chest about a forearm off it, knees bent out), the head up toward the next hold. A real
 *   reach → pull → step cycle driven by the distance climbed (wall-pose.ts ClimbGait), so a
 *   planted limb never slides; a scramble when climbing fast, the lead side first sideways,
 *   the feet first climbing down; all four holding at rest, breathing. The body surges a little
 *   with each pull and shifts its weight off the reaching hand. A leap up the wall is a dyno:
 *   both hands reaching up, the legs trailing, then every limb catches a hold again.
 * - hang: both hands on the lip, arms long, legs relaxed under him, a small pendulum sway (from
 *   the catch, and a shimmy), hand over hand along the ledge.
 * - mantle: a pull-up on the lip, then the elbows up and the chest over it, hands pressing on
 *   the roof, the right knee onto it, and up onto both feet.
 * - vault: the left hand planted on the obstacle's top, the legs swung through to the right.
 * - wallrun: the body leaned in at the wall, the feet striking its face flat, arms pumping.
 * - roll: a tucked forward roll over the hard landing.
 * - splash: treading water in the river, head and shoulders up, legs below.
 * - zip: pulled along the web, the web hand out ahead on the line, the other arm back, the legs
 *   trailing together, knees a little bent, then tucked as he comes in to land.
 * - knocked (roam-2): hit by a car: flung back, down on his back, getting up (knock-pose.ts).
 *
 * The wall moves place every limb exactly (no lag, so a planted hand stays on its hold) after
 * blending in from the pose the body had; the others ease every target on a stiff spring. The
 * feet are kept each on its own side of the body's midline, so the legs never cross.
 */
import { Quaternion, Vector3 } from "three";

import type { RenderFrame3D, RoamMoveName } from "@wgp/game-core/sim3d/contract";

import { Spring3 } from "../physics/spring";
import type { Rig } from "../rig";
import { clamp, frameQuat, lerp, Plant, smoothstep, UP } from "./common";
import { knockPose } from "./knock-pose";
import type { Pose } from "./pose";
import type { AnimContext } from "./types";
import { CLIMB, ClimbGait, Hold, LH, RH, WallFrame, wallBody, type WallBody } from "./wall-pose";

/** The moves this poser draws (the rest are the hero animator's own). */
export const ROAM_POSED: ReadonlySet<RoamMoveName> = new Set<RoamMoveName>(["climb", "hang", "mantle", "vault", "wallrun", "roll", "zip", "splash", "knocked"]);

/** The sim's body radius: its centre stands this far off a wall it's on. */
const R = 26;
/** Seconds to blend in from the pose the body had (a wall move, and the others). */
const BLEND_WALL = 0.2;
const BLEND = 0.14;
/** A planted foot keeps at least this far on its own side of the midline (units). */
const MIDLINE = 2.5;
const ROLL_SPIN = 0.42;
const TAU = Math.PI * 2;
/** A leap up the wall (the sim's CLIMB_LEAP is 560 up) reads as a dyno from about here. */
const DYNO_FROM = 400;
const DYNO_FULL = 520;
/** The hang's sway: a pendulum from the hands (rad/s), lightly damped. */
const SWAY_W = 3.3;
const SWAY_ZETA = 0.14;
/** Hand over hand along a ledge: travel per cycle, and each hand's share of it on the lip. */
const SHIMMY_L = 20;
const SHIMMY_STANCE = 0.6;
/** The wrist on a ledge: this far under its top, this far off the face. */
const LIP_DOWN = 2.5;
const LIP_GAP = 1.5;

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _n = new Vector3();
const _t = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _p = new Vector3();
const _base = new Vector3();
const _on = new Vector3();
const _dir = new Vector3();

const ease = (u: number) => u * u * (3 - 2 * u);

/**
 * Free roam frames only (the hero animator's own poses, after a roam move hands back): keep each
 * drawn foot on its own side of the body's midline, as the roam poses do.
 */
export function keepFeetApart(pose: Pose, hips: Vector3, rot: Quaternion): void {
  const left = _c.set(1, 0, 0).applyQuaternion(rot);
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const t = pose.foot[i];
    const side = (t.x - hips.x) * left.x + (t.y - hips.y) * left.y + (t.z - hips.z) * left.z;
    if (side * s < MIDLINE) t.addScaledVector(left, s * MIDLINE - side);
  }
}

/** Piecewise smooth keyframes: the value at u, eased between knots (ks ascending). */
function keys(ks: readonly number[], vs: readonly number[], u: number): number {
  if (u <= ks[0]) return vs[0];
  for (let i = 1; i < ks.length; i++) {
    if (u <= ks[i]) return lerp(vs[i - 1], vs[i], ease((u - ks[i - 1]) / (ks[i] - ks[i - 1])));
  }
  return vs[vs.length - 1];
}

export class RoamPoser {
  private move: RoamMoveName | null = null;
  private since = 0;
  private time = 0;
  /** The wall run's gait phase, and the distance along the wall last frame. */
  private phase = 0;
  private lastAlong = 0;
  /** The drawn position last frame (the body's travel along a wall is measured from it). */
  private readonly last = new Vector3();
  private readonly hands = [new Spring3(30, 1), new Spring3(30, 1)];
  private readonly feet = [new Spring3(30, 1), new Spring3(30, 1)];
  private readonly hips = new Spring3(26, 1);
  private readonly rot = new Quaternion();
  private readonly from = new Quaternion();
  private readonly fromHands = [new Vector3(), new Vector3()];
  private readonly fromFeet = [new Vector3(), new Vector3()];
  private readonly fromHips = new Vector3();
  private plants = [new Plant(), new Plant(), new Plant(), new Plant()];
  private readonly targets = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private readonly up = new Vector3();
  private readonly left = new Vector3();
  private readonly dir = new Vector3();
  private readonly off = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly hipsAt = new Vector3();
  private readonly aimDir = new Vector3();
  /** This frame's hand aims (null: curled), feet's world rotations, elbow and knee poles, grips. */
  private readonly aim: [Vector3 | null, Vector3 | null] = [null, null];
  private readonly aimV = [new Vector3(), new Vector3()];
  private readonly footQ = [new Quaternion(), new Quaternion()];
  private footSet = false;
  private readonly poles = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private polesSet = false;
  private readonly grips: [number, number] = [0.3, 0.3];
  private spine = 0;
  private chest = 0;
  private headP = 0;
  private headY = 0;
  /** Wall moves place their limbs exactly (blended in from the pose before, then no lag). */
  private exact = false;

  /** The wall: its face this frame, the climb's holds and gait, a leap's dyno weight. */
  private readonly wall = new WallFrame();
  private readonly body: WallBody;
  private readonly gait: ClimbGait;
  private dyno = 0;
  /** The hang: the hands' holds on the lip (hand over hand), its phase, the pendulum. */
  private readonly lip = [new Hold(), new Hold()];
  private lipPhase = 0;
  private lipLead = LH;
  private lipMoving = false;
  private readonly sway = { x: 0, vx: 0, z: 0, vz: 0 };
  private ledgeTop = 0;
  /** The mantle: the face it went over, and where the hips and hands started. */
  private readonly mantleFace = new Vector3();
  private readonly mantleN = new Vector3(0, 0, 1);
  private readonly mantleHips = new Vector3();
  private readonly mantleEnd = new Vector3();
  private readonly ledge = [new Vector3(), new Vector3()];
  private readonly vaultHand = new Vector3();
  private readonly legK: number;
  private readonly reach: number;
  private readonly shoulderY: number;

  constructor(private readonly rig: Rig) {
    this.legK = (rig.legs[0].l1 + rig.legs[0].l2) / 39.5;
    this.reach = rig.arms[0].l1 + rig.arms[0].l2;
    this.shoulderY = rig.joints.get("armL")!.y - rig.joints.get("hips")!.y;
    this.body = wallBody(rig);
    this.gait = new ClimbGait(this.body);
  }

  /** Whether this frame's move is one this poser draws. */
  static wants(f: RenderFrame3D): boolean {
    const m = f.roam?.move;
    return !!m && ROAM_POSED.has(m);
  }

  /** Let go: the next roam move starts fresh. */
  release(): void {
    this.move = null;
  }

  /** Which limbs (left hand, right hand, left foot, right foot) hold the wall or a ledge now (the headless checks). */
  planted(): [boolean, boolean, boolean, boolean] {
    // Blending in from the pose before, the limbs are still on their way to their holds.
    if (this.since < BLEND_WALL) return [false, false, false, false];
    switch (this.move) {
      case "climb":
        return this.dyno > 0.05 ? [false, false, false, false] : this.gait.planted();
      case "hang":
        return [!this.lip[0].moving, !this.lip[1].moving, false, false];
      case "wallrun":
        return [false, false, this.plants[2].inStance, this.plants[3].inStance];
      default:
        return [false, false, false, false];
    }
  }

  /**
   * Fill `pose` for this frame's roam move. `prev` is the pose the body had last frame (blended
   * from on entry). Returns the yaw the body faces (for the animator to carry on from).
   */
  update(f: RenderFrame3D, dt: number, ctx: AnimContext, pose: Pose, prev: Pose): number {
    const r = f.roam!;
    const h = f.hero;
    const move = r.move;
    const rig = this.rig;
    const P = _a.set(h.pos.x, h.pos.y, h.pos.z);
    const fresh = move !== this.move;
    if (fresh) {
      this.since = 0;
      this.from.copy(prev.rot);
      this.fromHips.copy(prev.root).add(_b.set(0, rig.hipHeight, 0).applyQuaternion(prev.rot));
      for (let i = 0; i < 2; i++) {
        this.fromHands[i].copy(prev.hand[i]);
        this.fromFeet[i].copy(prev.foot[i]);
      }
      this.enter(f, ctx, P);
    }
    this.move = move;
    dt = Math.min(dt, 0.05);
    this.since += dt;
    this.time += dt;

    const wall = r.wall;
    const n = _n.set(wall ? wall.nx : 0, 0, wall ? wall.nz : 0);
    if (n.lengthSq() < 0.5) {
      // No wall (a roll, a vault): the facing stands in, as the way he's going.
      const fac = h.facing ?? { x: 0, y: 0, z: 1 };
      n.set(-fac.x, 0, -fac.z).normalize();
    }
    const fwd = _t.set(-n.x, 0, -n.z);
    const hipH = rig.hipHeight;
    const H = _b;
    const targets = this.targets;
    let grip = 0.3;
    // Defaults the moves below override.
    this.exact = false;
    this.footSet = false;
    this.polesSet = false;
    this.aim[0] = this.aim[1] = null;
    this.spine = 0.1;
    this.chest = 0;
    this.headP = 0;
    this.headY = 0;
    // The body frame: forward, up, left (x).
    const up = this.up.copy(UP);

    switch (move) {
      case "climb":
        this.climb(f, ctx, P, n, fresh, dt, H);
        break;
      case "hang":
        this.hang(f, ctx, P, n, fresh, dt, H);
        break;
      case "mantle":
        this.mantle(f, ctx, P, H);
        break;
      case "wallrun":
        this.wallrun(f, P, n, H);
        break;
      case "vault": {
        const u = r.path ? r.path.u : 0.5;
        const dir = r.path ? this.dir.set(r.path.to.x - r.path.from.x, 0, r.path.to.z - r.path.from.z) : this.dir.copy(fwd);
        if (dir.lengthSq() < 1e-6) dir.copy(fwd);
        dir.normalize();
        H.copy(P);
        const tilt = Math.sin(Math.PI * u);
        // Rolled onto the planted left hand, pitched a little over it.
        const left0 = this.left.set(dir.z, 0, -dir.x);
        up.addScaledVector(left0, 0.55 * tilt).addScaledVector(dir, 0.2 * tilt).normalize();
        frameQuat(up, dir, this.rot);
        const left = this.left.set(1, 0, 0).applyQuaternion(this.rot);
        const plant = smoothstep(0.08, 0.2, u) * (1 - smoothstep(0.62, 0.78, u));
        const reachOut = this.tmp.copy(H).addScaledVector(left, 10).addScaledVector(UP, -8).addScaledVector(dir, 10);
        targets[0].copy(reachOut).lerp(this.vaultHand, plant);
        targets[1].copy(H).addScaledVector(left, -20).addScaledVector(UP, 10);
        // Legs swing through to the right side, tucked, then come down under him.
        const tuck = Math.sin(Math.PI * clamp((u - 0.1) / 0.8, 0, 1));
        for (let i = 0; i < 2; i++) {
          const s = i === 0 ? 1 : -1;
          targets[2 + i].copy(H).addScaledVector(left, s * 5.5 - 13 * tuck).addScaledVector(UP, (-36 + 18 * tuck) * this.legK).addScaledVector(dir, 4 * tuck + (i === 0 ? 3 : -3) * tuck);
        }
        grip = 0.5;
        break;
      }
      case "splash": {
        // Treading water: upright, the hips under the surface, arms sculling, legs below.
        const fac = h.facing ?? { x: 0, y: 0, z: 1 };
        this.dir.set(fac.x, 0, fac.z);
        if (this.dir.lengthSq() < 1e-6) this.dir.set(0, 0, 1);
        this.dir.normalize();
        frameQuat(UP, this.dir, this.rot);
        const left = this.left.set(1, 0, 0).applyQuaternion(this.rot);
        const bob = ctx.reducedMotion ? 0 : Math.sin(r.moveT * 6) * 2;
        H.copy(P);
        H.y = -this.shoulderY + 6 + bob;
        const scull = ctx.reducedMotion ? 0 : Math.sin(r.moveT * 7);
        for (let i = 0; i < 2; i++) {
          const s = i === 0 ? 1 : -1;
          targets[i].copy(H).addScaledVector(left, s * (22 + 4 * scull)).addScaledVector(UP, this.shoulderY - 6).addScaledVector(this.dir, 8);
          targets[2 + i].copy(H).addScaledVector(left, s * 7).addScaledVector(UP, -34 * this.legK).addScaledVector(this.dir, (i === 0 ? 1 : -1) * 6 * scull);
        }
        grip = 0.1;
        break;
      }
      case "zip": {
        const path = r.path;
        const dir = path ? this.dir.set(path.to.x - path.from.x, path.to.y - path.from.y, path.to.z - path.from.z) : this.dir.set(-n.x, 0, -n.z);
        if (dir.lengthSq() < 1e-6) dir.set(-n.x, 0, -n.z);
        dir.normalize();
        const u = path ? path.u : 0.5;
        const flat = this.tmp2.set(dir.x, 0, dir.z);
        if (flat.lengthSq() < 1e-6) flat.copy(fwd);
        flat.normalize();
        // Leaning into the pull, more in its middle; upright again as he comes in.
        const lean = 0.85 * Math.sin(Math.PI * clamp(u * 1.15, 0, 1));
        up.lerp(dir, lean * 0.6).normalize();
        frameQuat(up, flat, this.rot);
        const left = this.left.set(1, 0, 0).applyQuaternion(this.rot);
        H.copy(P);
        const tuck = smoothstep(0.7, 1, u);
        // The web hand out along the line, the other back by the hip.
        targets[1].copy(H).addScaledVector(dir, this.reach * 0.95).addScaledVector(UP, this.shoulderY * 0.9).addScaledVector(left, -6);
        targets[0].copy(H).addScaledVector(left, 13).addScaledVector(flat, -10).addScaledVector(UP, -2);
        for (let i = 0; i < 2; i++) {
          const s = i === 0 ? 1 : -1;
          // Trailing, apart, knees a little bent; tucked under him for the landing.
          targets[2 + i]
            .copy(H)
            .addScaledVector(left, s * 6)
            .addScaledVector(UP, lerp(-36, -28, tuck) * this.legK)
            .addScaledVector(flat, lerp(-10, 6, tuck) + (i === 0 ? 2 : -2));
        }
        if (path) this.aim[1] = this.aimDir.copy(dir);
        grip = 1;
        break;
      }
      case "knocked": {
        // Hit by a car (roam-2): flung, down, getting up (knock-pose.ts).
        grip = knockPose(f, P, ctx.ground(P.x, P.z, P.y + 4), { hipH, legK: this.legK, shoulderY: this.shoulderY, reach: this.reach }, ctx.reducedMotion, H, this.rot, targets);
        // He faces back at the car the whole time (the animator carries on from it once he's up).
        this.dir.set(h.facing?.x ?? 0, 0, h.facing?.z ?? 1);
        break;
      }
      case "roll":
      default: {
        // A tucked forward roll: hands to the shins, knees up, turning once about the left axis.
        const dir = this.dir.set(h.vel.x, 0, h.vel.z);
        if (dir.lengthSq() < 1) dir.copy(fwd);
        dir.normalize();
        const k = clamp(r.moveT / ROLL_SPIN, 0, 1);
        const spin = (k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k)) * Math.PI * 2;
        frameQuat(UP, dir, this.rot);
        const left = this.left.set(1, 0, 0).applyQuaternion(this.rot);
        this.rot.premultiply(_q.setFromAxisAngle(left, spin));
        const tuck = Math.sin(Math.PI * k);
        const ground = ctx.ground(P.x, P.z, P.y + 4);
        H.copy(P);
        H.y = lerp(ground + hipH - 2, ground + 20, tuck);
        for (let i = 0; i < 2; i++) {
          const s = i === 0 ? 1 : -1;
          targets[i].set(s * 7, lerp(-4, -8, tuck), lerp(8, 17, tuck)).applyQuaternion(this.rot).add(H);
          targets[2 + i].set(s * 5, lerp(-36, -16, tuck) * this.legK, lerp(2, 10, tuck)).applyQuaternion(this.rot).add(H);
          if (k >= 1) {
            targets[2 + i].copy(H).addScaledVector(left, s * 5.2);
            targets[2 + i].y = ground + rig.spec.ankle;
          }
        }
        this.spine = 0.5;
        this.chest = 0.4;
        this.headP = 0.4;
        grip = 0.9;
        break;
      }
    }

    // Blend in from where the body was: a wall move then places every limb exactly; the others
    // ease every target on a stiff spring (snapped, on entry, to where the limbs were).
    const blend = this.exact ? BLEND_WALL : BLEND;
    const e = ease(clamp(this.since / blend, 0, 1));
    for (let i = 0; i < 2; i++) {
      if (this.exact) {
        pose.hand[i].copy(this.fromHands[i]).lerp(targets[i], e);
        pose.foot[i].copy(this.fromFeet[i]).lerp(targets[2 + i], e);
        // The springs ride along, so a spring move after this one starts from here.
        this.hands[i].snap(pose.hand[i].x, pose.hand[i].y, pose.hand[i].z);
        this.feet[i].snap(pose.foot[i].x, pose.foot[i].y, pose.foot[i].z);
        continue;
      }
      const hs = this.hands[i];
      const fs = this.feet[i];
      if (fresh) {
        hs.snap(this.fromHands[i].x, this.fromHands[i].y, this.fromHands[i].z);
        fs.snap(this.fromFeet[i].x, this.fromFeet[i].y, this.fromFeet[i].z);
      }
      hs.step(targets[i].x, targets[i].y, targets[i].z, dt);
      fs.step(targets[2 + i].x, targets[2 + i].y, targets[2 + i].z, dt);
      pose.hand[i].set(hs.x, hs.y, hs.z);
      pose.foot[i].set(fs.x, fs.y, fs.z);
    }
    const hips = this.hipsAt;
    if (this.exact) {
      hips.copy(this.fromHips).lerp(H, e);
      this.hips.snap(hips.x, hips.y, hips.z);
    } else {
      if (fresh) this.hips.snap(H.x, H.y, H.z);
      this.hips.step(H.x, H.y, H.z, dt);
      hips.set(this.hips.x, this.hips.y, this.hips.z);
    }

    // The body: its rotation blended in from where it was; the soles below the hips.
    pose.rot.copy(this.from).slerp(this.rot, e);
    // No crossing: each foot (and hand) as drawn stays on its own side of the body's midline,
    // the body as it's turned this frame (mid-blend too). A wall move's limbs are on holds the
    // gait keeps to their sides (a clamp would drag a planted one off its hold, or off the face).
    const leftNow = _c.set(1, 0, 0).applyQuaternion(pose.rot);
    for (let i = 0; i < 2 && !this.exact; i++) {
      const s = i === 0 ? 1 : -1;
      for (const t of [pose.hand[i], pose.foot[i]]) {
        const side = (t.x - hips.x) * leftNow.x + (t.y - hips.y) * leftNow.y + (t.z - hips.z) * leftNow.z;
        if (side * s < MIDLINE) t.addScaledVector(leftNow, s * MIDLINE - side);
      }
    }
    pose.root.copy(hips).sub(_c.set(0, hipH, 0).applyQuaternion(pose.rot));
    pose.hips.set(0, 0, 0);
    pose.hipsRot.set(0, 0, 0);
    pose.spine.set(this.spine, 0, 0);
    pose.chest.set(this.chest, 0, 0);
    pose.neck.set(this.headP * 0.35, this.headY * 0.3, 0);
    pose.head.set(this.headP * 0.65, this.headY * 0.7, 0);
    const wallMove = move === "climb" || move === "hang" || move === "mantle";
    pose.clav[0].set(0, 0, wallMove ? 0.25 : 0);
    pose.clav[1].set(0, 0, wallMove ? -0.25 : 0);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      if (this.polesSet) {
        pose.elbow[i].copy(this.poles[i]);
        pose.knee[i].copy(this.poles[2 + i]);
      } else {
        // Elbows out and down; knees forward and a little out.
        pose.elbow[i].set(s * 0.7, -0.6, -0.6).applyQuaternion(pose.rot);
        pose.knee[i].set(s * 0.2, move === "vault" ? 0.3 : 0, 1).applyQuaternion(pose.rot);
      }
      const a = this.aim[i];
      pose.handAim[i] = a ? this.aimV[i].copy(a) : null;
      pose.handRot[i].set(0, 0, 0);
      if (this.footSet) pose.footRot[i].copy(this.from).slerp(this.footQ[i], e);
      else pose.footRot[i].copy(pose.rot);
      pose.grip[i] = this.exact ? this.grips[i] : grip;
    }
    this.last.copy(P);
    // The way the body faces, for the animator to carry on from: the wall on a wall, else the
    // way he's going (a wall run's, a zip's, a vault's, a roll's direction).
    const look = wallMove ? fwd : this.dir;
    return Math.abs(look.x) + Math.abs(look.z) > 1e-6 ? Math.atan2(look.x, look.z) : Math.atan2(fwd.x, fwd.z);
  }

  /** How far the sim's body stands off the face it's on (its radius, unless a ray says a little else). */
  private faceDist(ctx: AnimContext, P: Vector3, n: Vector3): number {
    const d = ctx.ray(P, _dir.set(-n.x, 0, -n.z), R + 30);
    return d !== null && d > R - 8 && d < R + 14 ? d : R;
  }

  /** Elbow and knee poles in the body frame (x left, y up, z into the wall), to world by `rot`. */
  private setPoles(rot: Quaternion, elbow: [number, number, number], knee: [number, number, number], hi = [0, 0]): void {
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      // A hand up over the shoulder points its elbow out and down; a low one, down and back.
      const k = clamp(hi[i], 0, 1);
      this.poles[i].set(s * lerp(elbow[0] * 0.7, elbow[0], k), lerp(-0.85, elbow[1], k), elbow[2]).normalize().applyQuaternion(rot);
      this.poles[2 + i].set(s * knee[0], knee[1], knee[2]).normalize().applyQuaternion(rot);
    }
    this.polesSet = true;
  }

  /**
   * A foot's world rotation on a wall: toes into the face (`fwd`), turned out by `out` (a frog's
   * splay) and pitched down by `toe`.
   */
  private footOnWall(i: number, fwd: Vector3, out: number, toe: number): void {
    const s = i === 0 ? 1 : -1;
    const f = this.tmp.copy(fwd).applyAxisAngle(UP, s * out);
    const q = frameQuat(UP, f, this.footQ[i]);
    const side = this.tmp2.crossVectors(UP, f).normalize();
    q.premultiply(_q2.setFromAxisAngle(side, toe));
    this.footSet = true;
  }

  /* ------------------------------------------------------------------ the climb */

  private climb(f: RenderFrame3D, ctx: AnimContext, P: Vector3, n: Vector3, fresh: boolean, dt: number, H: Vector3): void {
    const b = this.body;
    const face = this.faceDist(ctx, P, n);
    const w = this.wall.set(n.x, n.z, _on.copy(P).addScaledVector(n, -face), f.roam!.wall?.top ?? this.ledgeTop);
    const base = _base.copy(P).addScaledVector(n, b.forearm * CLIMB.hipOff - face);
    // The body's travel along the wall since last frame (none on the frame it starts).
    const du = fresh ? 0 : (P.x - this.last.x) * w.left.x + (P.z - this.last.z) * w.left.z;
    const dv = fresh ? 0 : P.y - this.last.y;
    if (fresh) this.gait.reset();
    this.gait.step(w, base, du, dv, dt, ctx.ground(P.x, P.z, P.y));
    const holds = this.gait.holds;
    const g = this.gait;
    // A leap up the wall: a dyno (both hands reaching up, the legs trailing) until he slows.
    const dynoWant = smoothstep(DYNO_FROM, DYNO_FULL, f.hero.vel.y);
    this.dyno += (dynoWant - this.dyno) * (1 - Math.exp(-dt / (dynoWant > this.dyno ? 0.04 : 0.09)));
    if (fresh) this.dyno = dynoWant;
    const dyno = this.dyno;

    // The body: hips in, leaning back just enough that the shoulders sit a forearm off; its weight
    // off the reaching hand, a surge with each pull, breathing at rest.
    const liftL = holds[LH].lift * (1 - dyno);
    const liftR = holds[RH].lift * (1 - dyno);
    const moving = clamp(g.speed / 50, 0, 1);
    const calm = ctx.reducedMotion ? 0 : 1;
    const beats = g.mode === "fast" ? 2 : 4;
    const surge = 1.6 * moving * Math.sin(g.phase * TAU * beats) * calm;
    const breath = (1 - moving) * 0.5 * Math.sin(this.time * 2.4) * calm;
    H.copy(base).addScaledVector(w.left, 2.4 * (liftR - liftL));
    H.y += surge + breath - dyno * 4;
    const lean = Math.atan2((CLIMB.shoulderOff - CLIMB.hipOff) * b.forearm, b.shoulderY) - dyno * 0.08;
    const up = this.up.copy(UP).multiplyScalar(Math.cos(lean)).addScaledVector(n, Math.sin(lean));
    frameQuat(up, w.fwd, this.rot);
    this.rot.premultiply(_q.setFromAxisAngle(w.fwd, -0.1 * (liftR - liftL)));

    for (let k = 0; k < 4; k++) this.targets[k].copy(holds[k].pos);
    if (dyno > 0) {
      // Reaching up the wall, both hands; the legs long below, toes off the face.
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        w.point(base, s * (b.shoulderX + 1), b.shoulderY + b.reach * 0.9, CLIMB.handGap + 3, this.tmp);
        this.targets[i].lerp(this.tmp, dyno);
        w.point(base, s * 6, -b.leg * 0.95, b.foot + 6, this.tmp);
        this.targets[2 + i].lerp(this.tmp, dyno);
      }
    }
    // Hands: palm on the face, fingers over the hold (open as it reaches); feet splayed, toes on it.
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const lift = Math.max(holds[i].lift, dyno);
      this.aimV[i]
        .copy(UP)
        .multiplyScalar(0.85)
        .addScaledVector(w.fwd, 0.5 * (1 - lift))
        .addScaledVector(w.left, s * 0.12)
        .normalize();
      this.aim[i] = this.aimV[i];
      this.grips[i] = lerp(0.62, 0.12, lift);
      this.footOnWall(i, w.fwd, 0.3, 0.18 + 0.45 * Math.max(holds[2 + i].lift, dyno));
    }
    // Elbows out and down (back when the hand is low); knees out to the sides, toward the wall.
    const hi = [0, 1].map((i) => clamp((this.targets[i].y - (H.y + b.shoulderY)) / 16 + 0.5, 0, 1));
    this.setPoles(this.rot, [0.75, -0.5, -0.45], [0.85, 0.05, 0.5], hi);
    // The head up toward the next hold (down when climbing down), turned to the reaching hand.
    const downward = g.dir.v < -0.3 && moving > 0.2;
    this.headP = downward ? 0.35 : -0.5 - dyno * 0.15;
    this.headY = 0.4 * (liftL - liftR) + (downward ? 0.3 * (holds[2].lift - holds[3].lift) : 0);
    this.spine = -0.04 + breath * 0.02;
    this.chest = breath * 0.03;
    this.exact = true;
  }

  /* ------------------------------------------------------------------ the hang */

  private hang(f: RenderFrame3D, ctx: AnimContext, P: Vector3, n: Vector3, fresh: boolean, dt: number, H: Vector3): void {
    const b = this.body;
    const face = this.faceDist(ctx, P, n);
    const top = this.ledgeTop;
    const w = this.wall.set(n.x, n.z, _on.copy(P).addScaledVector(n, -face), top);
    const lipY = top - LIP_DOWN;
    // Shoulders a little off the face under the hands, arms long; hips under them.
    const shoulderOff = 9;
    const hipOff = 8;
    const shoulderY = lipY - Math.sqrt(Math.max(1, (b.reach * 0.9) ** 2 - (shoulderOff - LIP_GAP) ** 2));
    const hipsY = shoulderY - b.shoulderY;

    // Hand over hand along the lip: the lead hand first, by the distance shimmied.
    const du = fresh ? 0 : (P.x - this.last.x) * w.left.x + (P.z - this.last.z) * w.left.z;
    if (fresh) {
      this.lipPhase = 0;
      for (let i = 0; i < 2; i++) {
        const hd = this.lip[i];
        w.point(P, (i === 0 ? 1 : -1) * (b.shoulderX + 1.5), lipY - P.y, LIP_GAP, hd.at);
        hd.pos.copy(hd.at);
        hd.moving = false;
        hd.lift = 0;
        hd.cycle = 0;
      }
      this.lipLead = LH;
      this.lipMoving = false;
    }
    const shimmying = Math.abs(du) > 0.01;
    if (shimmying) {
      const lead = du > 0 ? LH : RH;
      if (lead !== this.lipLead || !this.lipMoving) {
        // Setting off (or turning back): the lead hand reaches first, the other half a cycle on.
        this.lipLead = lead;
        for (let i = 0; i < 2; i++) this.lip[i].cycle = i === lead ? Math.floor(this.lipPhase) - 1 : Math.floor(this.lipPhase - 0.5);
      }
    }
    this.lipMoving = shimmying;
    const dPhase = Math.abs(du) / SHIMMY_L;
    this.lipPhase += dPhase;
    const sgn = du > 0 ? 1 : du < 0 ? -1 : 0;
    for (let i = 0; i < 2; i++) {
      const hd = this.lip[i];
      const s = i === 0 ? 1 : -1;
      const c = Math.floor(this.lipPhase - (i === this.lipLead ? 0 : 0.5));
      if (c > hd.cycle) {
        hd.cycle = c;
        hd.from.copy(hd.moving ? hd.pos : hd.at);
        hd.moving = true;
        hd.u = 0;
      }
      if (hd.moving) {
        hd.u += Math.min(dt / CLIMB.moveMin, Math.max(dPhase / (1 - SHIMMY_STANCE), dt / CLIMB.moveMax));
        w.point(P, s * (b.shoulderX + 1.5) + sgn * SHIMMY_STANCE * SHIMMY_L * 0.5, lipY - P.y, LIP_GAP, hd.to);
        if (hd.u >= 1) {
          hd.at.copy(hd.to);
          hd.moving = false;
        } else {
          hd.lift = Math.sin(Math.PI * hd.u);
          hd.pos.copy(hd.from).lerp(hd.to, ease(hd.u)).addScaledVector(UP, 4 * hd.lift).addScaledVector(w.n, 2 * hd.lift);
        }
      }
      if (!hd.moving) {
        hd.lift = 0;
        // Held on the lip (its height kept as the ledge's, should the frame's top move a hair).
        hd.at.y = lipY;
        w.onto(hd.at, LIP_GAP);
        hd.pos.copy(hd.at);
      }
      this.targets[i].copy(hd.pos);
    }

    // The pendulum: a swing from the catch, pushed sideways by a shimmy; never into the wall.
    const sw = this.sway;
    if (fresh) {
      sw.x = 0;
      sw.z = 0;
      sw.vx = ctx.reducedMotion ? 0 : 0.45;
      sw.vz = ctx.reducedMotion ? 0 : Math.sin(P.x * 0.37 + P.z * 0.11) > 0 ? 0.18 : -0.18;
    }
    const zWant = ctx.reducedMotion ? 0 : clamp((-du / Math.max(dt, 1e-3)) * 0.0005, -0.06, 0.06);
    const W2 = SWAY_W * SWAY_W;
    const D = 2 * SWAY_ZETA * SWAY_W;
    sw.vx += (-W2 * sw.x - D * sw.vx) * dt;
    sw.x += sw.vx * dt;
    sw.vz += (-W2 * (sw.z - zWant) - D * sw.vz) * dt;
    sw.z += sw.vz * dt;
    if (sw.x < -0.02) {
      sw.x = -0.02;
      sw.vx = Math.abs(sw.vx) * 0.3;
    }

    // The body, unswung: hips under the shoulders, legs relaxed under him (one a little bent).
    w.point(P, 0, hipsY - P.y, hipOff, H);
    const lean = Math.atan2(shoulderOff - hipOff, b.shoulderY);
    const up = this.up.copy(UP).multiplyScalar(Math.cos(lean)).addScaledVector(n, Math.sin(lean));
    frameQuat(up, w.fwd, this.rot);
    w.point(H, 5, -b.leg * 0.95, b.foot + 2, this.targets[2]);
    w.point(H, -6, -b.leg * 0.86, b.foot + 6, this.targets[3]);
    // The swing turns all of it about the hands.
    const pivot = this.tmp2.copy(this.targets[0]).add(this.targets[1]).multiplyScalar(0.5);
    _q.setFromAxisAngle(w.left, sw.x).premultiply(_q2.setFromAxisAngle(w.fwd, sw.z));
    for (const q of [H, this.targets[2], this.targets[3]]) q.sub(pivot).applyQuaternion(_q).add(pivot);
    this.rot.premultiply(_q);

    for (let i = 0; i < 2; i++) {
      // Fingers over the lip into the roof.
      this.aimV[i].copy(w.fwd).multiplyScalar(0.9).addScaledVector(UP, 0.45 - 0.6 * this.lip[i].lift).normalize();
      this.aim[i] = this.aimV[i];
      this.grips[i] = lerp(0.8, 0.2, this.lip[i].lift);
      this.footOnWall(i, w.fwd, 0.15, 0.55);
    }
    this.setPoles(this.rot, [0.7, -0.4, -0.5], [0.3, 0, 1], [1, 1]);
    this.headP = -0.3;
    this.headY = 0.25 * (this.lip[0].lift - this.lip[1].lift);
    this.spine = 0;
    this.exact = true;
  }

  /* ------------------------------------------------------------------ the mantle */

  private mantle(f: RenderFrame3D, ctx: AnimContext, P: Vector3, H: Vector3): void {
    const r = f.roam!;
    const b = this.body;
    const u = r.path ? r.path.u : clamp(r.moveT / 0.42, 0, 1);
    const top = this.ledgeTop;
    const n = this.mantleN;
    const w = this.wall.set(n.x, n.z, this.mantleFace, top);
    const fwd = w.fwd;
    const left = w.left;
    const ground = Math.max(top, ctx.ground(P.x, P.z, P.y + 4));
    // Where the hips go: up under the lip (the pull), over it with the chest (the press), onto a
    // knee on the roof, and up to standing where the sim sets him down.
    const K = [0, 0.3, 0.55, 0.78, 1];
    const start = this.mantleHips;
    const out0 = w.off(start);
    const offs = [out0, Math.min(out0, 6), -4, -15, 0];
    const ys = [start.y - top, -18, 2, 22, 0];
    const end = this.mantleEnd.copy(P);
    end.y = ground + b.hipH - 2;
    const endOff = w.off(end);
    offs[4] = endOff;
    ys[4] = end.y - top;
    const off = keys(K, offs, u);
    const y = keys(K, ys, u);
    // Along the ledge: from where he started to where he ends.
    const along0 = (start.x - w.at.x) * left.x + (start.z - w.at.z) * left.z;
    const along1 = (end.x - w.at.x) * left.x + (end.z - w.at.z) * left.z;
    const along = lerp(along0, along1, smoothstep(0.5, 1, u));
    H.copy(w.at).addScaledVector(left, along).addScaledVector(n, off);
    H.y = top + y;
    // The chest over the lip as the hips come up; upright again to stand.
    const lean = keys(K, [0.05, 0.3, 0.9, 0.4, 0], u);
    const up = this.up.copy(UP).multiplyScalar(Math.cos(lean)).addScaledVector(fwd, Math.sin(lean));
    frameQuat(up, fwd, this.rot);

    // Hands: on the lip for the pull, then over onto the roof to press (left, then right), then
    // back to his sides as he stands.
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const lip = this.tmp2.copy(this.ledge[i]);
      const onTop = w.point(H, s * (b.shoulderX + 0.5), 0, -5, this.off);
      onTop.y = top + 2.6;
      const over = smoothstep(i === 0 ? 0.3 : 0.38, i === 0 ? 0.45 : 0.53, u);
      const t = this.targets[i].copy(lip).lerp(onTop, over);
      t.y += 4 * Math.sin(Math.PI * over);
      const side = _p.copy(H).addScaledVector(left, s * 13).addScaledVector(fwd, 3);
      side.y = H.y - 4;
      t.lerp(side, smoothstep(0.84, 1, u));
      const pressing = smoothstep(0.3, 0.5, u);
      this.aimV[i].copy(fwd).multiplyScalar(0.9).addScaledVector(UP, lerp(0.45, -0.1, pressing)).normalize();
      this.aim[i] = smoothstep(0.84, 1, u) > 0.6 ? null : this.aimV[i];
      this.grips[i] = lerp(lerp(0.8, 0.25, pressing), 0.3, smoothstep(0.84, 1, u));
    }
    // Feet: toes on the face below, walking up it; the right knee onto the roof, then both feet under him.
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const climbY = Math.min(H.y - b.leg * lerp(0.82, 0.5, smoothstep(0.35, 0.6, u)), top - 6);
      const onFace = w.point(H, s * 7, climbY - H.y, b.foot + CLIMB.footGap, this.off);
      const t = this.targets[2 + i].copy(onFace);
      if (i === 1) {
        // The right knee onto the roof: the shin along it, the foot just in from the lip.
        const knee = _p.copy(H).addScaledVector(left, s * 6);
        w.onto(knee, 3);
        knee.y = top + b.ankle + 1;
        t.lerp(knee, smoothstep(0.55, 0.74, u));
      }
      const stand = _p.copy(end).addScaledVector(left, s * 5.2);
      stand.y = ground + b.ankle;
      t.lerp(stand, smoothstep(i === 1 ? 0.8 : 0.74, i === 1 ? 1 : 0.94, u));
      this.footOnWall(i, fwd, 0.2, lerp(0.25, 0, smoothstep(0.75, 1, u)));
    }
    // Elbows down for the pull, up and back for the press ("elbow up"), then down again.
    const press = smoothstep(0.3, 0.45, u) * (1 - smoothstep(0.8, 0.95, u));
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      this.poles[i].set(s * 0.6, lerp(-0.7, 0.75, press), lerp(-0.4, -0.6, press)).normalize().applyQuaternion(this.rot);
      // The kneeling leg's knee points down onto the roof; the other out and forward.
      const kneel = i === 1 ? smoothstep(0.55, 0.74, u) * (1 - smoothstep(0.82, 1, u)) : 0;
      this.poles[2 + i].set(s * 0.5, lerp(0, -0.8, kneel), 1).normalize().applyQuaternion(this.rot);
    }
    this.polesSet = true;
    this.headP = lerp(-0.35, 0.1, smoothstep(0.3, 0.7, u));
    this.spine = lerp(0, 0.25, press);
    this.exact = true;
  }

  /* ------------------------------------------------------------------ the wall run */

  private wallrun(f: RenderFrame3D, P: Vector3, n: Vector3, H: Vector3): void {
    const h = f.hero;
    // Along the wall the way he runs, leaned in at it so his feet strike its face; arms pumping.
    const fac = h.facing ?? { x: -n.z, y: 0, z: n.x };
    const along = this.dir.set(fac.x, 0, fac.z);
    if (along.lengthSq() < 1e-6) along.set(-n.z, 0, n.x);
    along.normalize();
    H.copy(P).addScaledVector(n, -9);
    const up = this.up.copy(UP).addScaledVector(n, 0.5).normalize();
    frameQuat(up, along, this.rot);
    // The chest turned a little toward the wall.
    this.rot.premultiply(_q.setFromAxisAngle(up, (n.x * along.z - n.z * along.x > 0 ? -1 : 1) * 0.22));
    const left = this.left.set(1, 0, 0).applyQuaternion(this.rot);
    const a = P.x * along.x + P.z * along.z;
    if (this.since <= 1e-6) this.lastAlong = a;
    this.phase += Math.min(0.3, Math.abs(a - this.lastAlong) / 80);
    this.lastAlong = a;
    // Feet flat on the face: the sole on it, the ankle its height off it.
    const gap = this.body.ankle + 0.6;
    const face = this.wall.set(n.x, n.z, _on.copy(P).addScaledVector(n, -R), 0);
    const plane = (q: Vector3) => face.onto(q, gap);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const off = this.off.copy(left).multiplyScalar(s * 6).addScaledVector(UP, -26 * this.legK);
      this.plants[2 + i].update(this.phase + i * 0.5, 0.46, H, along, 80, off, 10, n, plane);
      this.targets[2 + i].copy(this.plants[2 + i].target);
      const sw = Math.sin((this.phase + i * 0.5) * TAU);
      this.targets[i].copy(H).addScaledVector(left, s * 13).addScaledVector(UP, this.shoulderY - 14 + 10 * Math.max(sw, 0)).addScaledVector(along, 14 * sw);
      // The sole on the wall: the foot's up is the wall's normal, its toes along the run.
      frameQuat(n, along, this.footQ[i]);
    }
    this.footSet = true;
    this.setPoles(this.rot, [0.7, -0.6, -0.6], [0.2, 0, 1], [0.5, 0.5]);
    this.grips[0] = this.grips[1] = 0.6;
    this.headP = 0;
    this.spine = 0.12;
    this.exact = true;
  }

  /** On entering a move: where the hands will hold (the ledge, the obstacle). */
  private enter(f: RenderFrame3D, ctx: AnimContext, P: Vector3): void {
    const r = f.roam!;
    const w = r.wall;
    this.last.copy(P);
    if (w) this.ledgeTop = w.top;
    // Fresh plants: each limb lands where the gait wants it first.
    if (r.move === "wallrun") this.plants = [new Plant(), new Plant(), new Plant(), new Plant()];
    if (r.move === "vault" && r.path) {
      const mx = (r.path.from.x + r.path.to.x) / 2;
      const mz = (r.path.from.z + r.path.to.z) / 2;
      const top = ctx.ground(mx, mz, Math.max(r.path.from.y, r.path.to.y) + 150);
      this.vaultHand.set(mx, top + 1.5, mz);
    }
    if (r.move === "mantle" && w) {
      // The face he goes over (where he is now, before the sim carries him in), the hips he
      // starts from, and the hands on the lip: a hang's own, else where they reach it now.
      this.mantleN.set(w.nx, 0, w.nz).normalize();
      const face = this.faceDist(ctx, P, this.mantleN);
      this.mantleFace.copy(P).addScaledVector(this.mantleN, -face);
      this.mantleHips.copy(this.fromHips);
      const wf = this.wall.set(w.nx, w.nz, this.mantleFace, w.top);
      for (let i = 0; i < 2; i++) {
        if (this.move === "hang") this.ledge[i].copy(this.lip[i].at);
        else wf.point(P, (i === 0 ? 1 : -1) * (this.body.shoulderX + 1.5), w.top - LIP_DOWN - P.y, LIP_GAP, this.ledge[i]);
      }
    }
  }
}
