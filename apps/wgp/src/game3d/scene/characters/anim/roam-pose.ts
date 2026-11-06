/**
 * Free roam's wall and parkour poses for the hero, from the frame's v1.6 `roam` (the UAL has no
 * climb, vault, wall-run or mantle clips, so these are procedural, on the same two-bone IK as
 * every pose):
 *
 * - climb: chest to the wall, four limbs on it in a diagonal gait (left hand with right foot,
 *   then the other pair) whose phase advances by the distance climbed, so planted hands and
 *   feet never slide; looking up.
 * - hang: both hands on the ledge, arms long, feet braced on the wall below.
 * - mantle: the hands stay on the ledge while the hips come up and over it, the right knee
 *   comes up onto the top, then both feet under him.
 * - vault: the left hand planted on the obstacle's top, the legs swung through to the right.
 * - wallrun: leaning out from the wall, feet striding along it, arms pumping.
 * - roll: a tucked forward roll over the hard landing.
 * - splash: treading water in the river, head and shoulders up, legs below.
 * - zip: pulled along the web, the web hand out ahead on the line, the other arm back, the legs
 *   trailing together, knees a little bent, then tucked as he comes in to land.
 * - knocked (roam-2): hit by a car: flung back, down on his back, getting up (knock-pose.ts).
 *
 * Every target is eased by a stiff spring (no pops when a limb steps), the pose blends in from
 * the one the body had, and the feet are kept each on its own side of the body's midline, so
 * the legs never cross.
 */
import { Quaternion, Vector3 } from "three";

import type { RenderFrame3D, RoamMoveName } from "@wgp/game-core/sim3d/contract";

import { Spring3 } from "../physics/spring";
import type { Rig } from "../rig";
import { clamp, frameQuat, lerp, Plant, smoothstep, UP } from "./common";
import { knockPose } from "./knock-pose";
import type { Pose } from "./pose";
import type { AnimContext } from "./types";

/** The moves this poser draws (the rest are the hero animator's own). */
export const ROAM_POSED: ReadonlySet<RoamMoveName> = new Set<RoamMoveName>(["climb", "hang", "mantle", "vault", "wallrun", "roll", "zip", "splash", "knocked"]);

/** The sim's body radius: its centre stands this far off a wall it's on. */
const R = 26;
/** Seconds to blend in from the pose the body had. */
const BLEND = 0.14;
/** A planted foot keeps at least this far on its own side of the midline (units). */
const MIDLINE = 2.5;
const ROLL_SPIN = 0.42;

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _n = new Vector3();
const _t = new Vector3();
const _q = new Quaternion();
const _p = new Vector3();
const DOWN = new Vector3(0, -1, 0);

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

export class RoamPoser {
  private move: RoamMoveName | null = null;
  private since = 0;
  private phase = 0;
  private lastY = 0;
  private lastAlong = 0;
  private readonly hands = [new Spring3(30, 1), new Spring3(30, 1)];
  private readonly feet = [new Spring3(30, 1), new Spring3(30, 1)];
  private readonly hips = new Spring3(26, 1);
  private readonly rot = new Quaternion();
  private readonly from = new Quaternion();
  private readonly fromHands = [new Vector3(), new Vector3()];
  private readonly fromFeet = [new Vector3(), new Vector3()];
  private readonly fromRoot = new Vector3();
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
  /** Where the hands hold a ledge (hang, mantle), and the obstacle's top under a vault. */
  private readonly ledge = [new Vector3(), new Vector3()];
  private ledgeTop = 0;
  private readonly vaultHand = new Vector3();
  private readonly legK: number;
  private readonly reach: number;
  private readonly shoulderY: number;

  constructor(private readonly rig: Rig) {
    this.legK = (rig.legs[0].l1 + rig.legs[0].l2) / 39.5;
    this.reach = rig.arms[0].l1 + rig.arms[0].l2;
    this.shoulderY = rig.joints.get("armL")!.y - rig.joints.get("hips")!.y;
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
      this.fromRoot.copy(prev.root);
      for (let i = 0; i < 2; i++) {
        this.fromHands[i].copy(prev.hand[i]);
        this.fromFeet[i].copy(prev.foot[i]);
      }
      this.enter(f, ctx, P);
    }
    this.move = move;
    dt = Math.min(dt, 0.05);
    this.since += dt;

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
    // The body frame: forward, up, left (x).
    const up = this.up.copy(UP);
    /** Onto the wall's face (`gap` out from it), along its normal. */
    const onWall = (gap: number) => (q: Vector3) => q.addScaledVector(n, -(_p.copy(q).sub(P).dot(n) + R - gap));

    switch (move) {
      case "climb": {
        // Chest to the wall, a touch of lean in; limbs on the wall in a diagonal gait.
        H.copy(P).addScaledVector(n, -(R - 13));
        up.addScaledVector(n, -0.12).normalize();
        frameQuat(up, fwd, this.rot);
        const dy = P.y - this.lastY;
        this.phase += Math.min(0.25, Math.abs(dy) / 52);
        const plane = onWall(2);
        const left = this.left.set(1, 0, 0).applyQuaternion(this.rot);
        const climbUp = dy >= 0 ? UP : DOWN;
        const specs: [number, number, number][] = [
          // [lateral (+left), height from hips, phase offset]
          [10, this.shoulderY + this.reach * 0.55, 0],
          [-10, this.shoulderY + this.reach * 0.55, 0.5],
          [5.5, -34 * this.legK, 0.5],
          [-5.5, -34 * this.legK, 0],
        ];
        for (let k = 0; k < 4; k++) {
          const [x, y, ph] = specs[k];
          const off = this.off.copy(left).multiplyScalar(x).addScaledVector(UP, y);
          this.plants[k].update(this.phase + ph, 0.55, H, climbUp, 30, off, 3, n, plane);
          targets[k].copy(this.plants[k].target);
        }
        grip = 0.75;
        break;
      }
      case "hang": {
        // Hands on the ledge, arms long, feet braced on the wall below.
        H.copy(P).addScaledVector(n, -(R - 12));
        H.y = Math.min(P.y, this.ledgeTop - this.shoulderY - this.reach * 0.92);
        frameQuat(up, fwd, this.rot);
        const left = this.left.set(1, 0, 0).applyQuaternion(this.rot);
        // The ledge under the hands follows a shuffle along it.
        for (let i = 0; i < 2; i++) {
          const s = i === 0 ? 1 : -1;
          targets[i].copy(P).addScaledVector(n, -(R + 3)).addScaledVector(left, s * 11);
          targets[i].y = this.ledgeTop + 1.5;
          this.ledge[i].copy(targets[i]);
          targets[2 + i].copy(H).addScaledVector(left, s * 6).addScaledVector(UP, -36 * this.legK).addScaledVector(n, -(13 - 4));
        }
        grip = 1;
        break;
      }
      case "mantle": {
        const u = r.path ? r.path.u : clamp(r.moveT / 0.42, 0, 1);
        const over = smoothstep(0.45, 1, u);
        const ground = ctx.ground(P.x, P.z, P.y + 4);
        H.copy(P).addScaledVector(n, -(R - 12) * (1 - over));
        H.y = lerp(Math.min(P.y, this.ledgeTop - this.shoulderY - this.reach * 0.6), Math.max(P.y, ground + hipH - 2), smoothstep(0.35, 1, u));
        // Leaning over the ledge as the hips come up past it.
        const lean = 0.65 * Math.sin(Math.PI * clamp(u * 1.1, 0, 1));
        up.addScaledVector(n, -lean).normalize();
        frameQuat(up, fwd, this.rot);
        const left = this.left.set(1, 0, 0).applyQuaternion(this.rot);
        const release = smoothstep(0.72, 0.95, u);
        for (let i = 0; i < 2; i++) {
          const s = i === 0 ? 1 : -1;
          // Hands push down on the ledge, then come back to the sides.
          const side = this.tmp.copy(H).addScaledVector(left, s * 13).addScaledVector(UP, -4).addScaledVector(fwd, 4);
          targets[i].copy(this.ledge[i]).lerp(side, release);
          // Feet: on the wall, then the right knee comes up onto the top, then both under him.
          const wallFoot = this.tmp.copy(H).addScaledVector(left, s * 6).addScaledVector(UP, -34 * this.legK).addScaledVector(n, 6);
          const topFoot = this.tmp2.copy(H).addScaledVector(left, s * 5.2);
          topFoot.y = ground + rig.spec.ankle;
          const step = smoothstep(i === 1 ? 0.45 : 0.62, i === 1 ? 0.78 : 0.95, u);
          targets[2 + i].copy(wallFoot).lerp(topFoot, step);
          if (step > 0 && step < 1) targets[2 + i].y += Math.sin(Math.PI * step) * 10;
          targets[2 + i].y = Math.max(targets[2 + i].y, ctx.ground(targets[2 + i].x, targets[2 + i].z, H.y) + rig.spec.ankle);
        }
        grip = 1 - release * 0.7;
        break;
      }
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
      case "wallrun": {
        // Leaning out from the wall, striding along it, arms pumping.
        const fac = h.facing ?? { x: -n.z, y: 0, z: n.x };
        const along = this.dir.set(fac.x, 0, fac.z);
        if (along.lengthSq() < 1e-6) along.set(-n.z, 0, n.x);
        along.normalize();
        H.copy(P).addScaledVector(n, -4);
        up.addScaledVector(n, 0.62).normalize();
        frameQuat(up, along, this.rot);
        const left = this.left.set(1, 0, 0).applyQuaternion(this.rot);
        const a = P.x * along.x + P.z * along.z;
        this.phase += Math.min(0.3, Math.abs(a - this.lastAlong) / 92);
        this.lastAlong = a;
        const plane = onWall(3);
        for (let i = 0; i < 2; i++) {
          const s = i === 0 ? 1 : -1;
          // The foot nearer the wall plants on it; the far one too (the lean puts both feet on the face).
          const off = this.off.copy(left).multiplyScalar(s * 6).addScaledVector(UP, -24 * this.legK);
          this.plants[2 + i].update(this.phase + i * 0.5, 0.48, H, along, 92, off, 9, n, plane);
          targets[2 + i].copy(this.plants[2 + i].target);
          const sw = Math.sin((this.phase + i * 0.5) * Math.PI * 2);
          targets[i].copy(H).addScaledVector(left, s * 13).addScaledVector(UP, this.shoulderY - 14 + 10 * Math.max(sw, 0)).addScaledVector(along, 14 * sw);
        }
        grip = 0.6;
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
        grip = 0.9;
        break;
      }
    }

    // Ease every target (snap them on entry, from where the body's limbs were).
    const k = clamp(this.since / BLEND, 0, 1);
    const e = k * k * (3 - 2 * k);
    for (let i = 0; i < 2; i++) {
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
    if (fresh) this.hips.snap(H.x, H.y, H.z);
    this.hips.step(H.x, H.y, H.z, dt);
    const hips = this.hipsAt.set(this.hips.x, this.hips.y, this.hips.z);

    // The body: its rotation blended in from where it was; the soles below the hips.
    pose.rot.copy(this.from).slerp(this.rot, e);
    // No crossing: each foot (and hand) as drawn stays on its own side of the body's midline,
    // the body as it's turned this frame (mid-blend too).
    const leftNow = _c.set(1, 0, 0).applyQuaternion(pose.rot);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      for (const t of [pose.hand[i], pose.foot[i]]) {
        const side = (t.x - hips.x) * leftNow.x + (t.y - hips.y) * leftNow.y + (t.z - hips.z) * leftNow.z;
        if (side * s < MIDLINE) t.addScaledVector(leftNow, s * MIDLINE - side);
      }
    }
    pose.root.copy(hips).sub(_a.set(0, hipH, 0).applyQuaternion(pose.rot));
    pose.hips.set(0, 0, 0);
    pose.hipsRot.set(0, 0, 0);
    const climbing = move === "climb" || move === "hang" || move === "mantle";
    pose.spine.set(climbing ? -0.08 : move === "roll" ? 0.5 : 0.1, 0, 0);
    pose.chest.set(move === "roll" ? 0.4 : 0, 0, 0);
    pose.neck.set(0, 0, 0);
    pose.head.set(move === "climb" || move === "hang" ? -0.35 : move === "roll" ? 0.4 : 0, 0, 0);
    pose.clav[0].set(0, 0, climbing ? 0.25 : 0);
    pose.clav[1].set(0, 0, climbing ? -0.25 : 0);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      // Elbows out and down; knees forward (into the wall when on one) and a little out.
      pose.elbow[i].set(s * 0.7, -0.6, climbing ? 0.2 : -0.6).applyQuaternion(pose.rot);
      pose.knee[i].set(s * 0.2, move === "vault" ? 0.3 : 0, 1).applyQuaternion(pose.rot);
      pose.handAim[i] = move === "zip" && i === 1 && r.path ? this.aimDir.copy(this.dir) : null;
      pose.handRot[i].set(0, 0, 0);
      pose.footRot[i].copy(pose.rot);
      pose.grip[i] = grip;
    }
    this.lastY = P.y;
    // The way the body faces, for the animator to carry on from: the wall on a wall, else the
    // way he's going (a wall run's, a zip's, a vault's, a roll's direction).
    const look = move === "climb" || move === "hang" || move === "mantle" ? fwd : this.dir;
    return Math.abs(look.x) + Math.abs(look.z) > 1e-6 ? Math.atan2(look.x, look.z) : Math.atan2(fwd.x, fwd.z);
  }

  /** On entering a move: where the hands will hold (the ledge, the obstacle). */
  private enter(f: RenderFrame3D, ctx: AnimContext, P: Vector3): void {
    const r = f.roam!;
    const w = r.wall;
    this.lastY = P.y;
    if (w) this.ledgeTop = w.top;
    // Fresh plants: each limb lands where the gait wants it first.
    if (r.move === "climb" || r.move === "wallrun") this.plants = [new Plant(), new Plant(), new Plant(), new Plant()];
    if (r.move === "vault" && r.path) {
      const mx = (r.path.from.x + r.path.to.x) / 2;
      const mz = (r.path.from.z + r.path.to.z) / 2;
      const top = ctx.ground(mx, mz, Math.max(r.path.from.y, r.path.to.y) + 150);
      this.vaultHand.set(mx, top + 1.5, mz);
    }
    if (r.move === "mantle" && w && this.move !== "hang") {
      // Straight from a climb: the hands find the ledge now.
      const left = this.left.set(-w.nz, 0, w.nx);
      for (let i = 0; i < 2; i++) {
        this.ledge[i].set(P.x - w.nx * (R + 3), w.top + 1.5, P.z - w.nz * (R + 3)).addScaledVector(left, (i === 0 ? 1 : -1) * 11);
      }
    }
  }
}
