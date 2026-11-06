/**
 * Knocked down by a car (free roam, roam-2: the move "knocked", RenderFrame3D.roam.knock), a
 * procedural pose on the roam poser's two-bone IK:
 *
 * - flung: thrown backwards along the car's way, the body tipping back past level as he flies,
 *   arms flung out and up, legs splayed and bent.
 * - down: on his back where he slid to a stop, head the way he was thrown, arms out on the
 *   ground, knees up a little.
 * - up: sits up onto his hands, gets his feet under him and stands (the animator takes over
 *   from "ground" when the sim says he's up).
 *
 * Reduced motion: the same beats, no flail.
 */
import { Quaternion, Vector3 } from "three";

import type { RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import { clamp, frameQuat, lerp, smoothstep, UP } from "./common";

/** The sim's getting-up time (game-core roam/constants KNOCK_GETUP). */
const GETUP = 0.55;

const _up = new Vector3();
const _fwd = new Vector3();
const _left = new Vector3();
const _dir = new Vector3();
const _side = new Vector3();

export interface KnockBody {
  /** The rig's hip height, leg scale (its legs over the MPFB hero's), shoulder height over the hips and arm's reach. */
  hipH: number;
  legK: number;
  shoulderY: number;
  reach: number;
}

/**
 * Fill the knocked pose: the hips target `H`, the body's rotation `rot`, and the hand and foot
 * targets (left hand, right hand, left foot, right foot). `P` is the sim's body centre, `ground`
 * the surface under it. Returns the hands' grip.
 */
export function knockPose(f: RenderFrame3D, P: Vector3, ground: number, body: KnockBody, reduced: boolean, H: Vector3, rot: Quaternion, targets: Vector3[]): number {
  const k = f.roam!.knock;
  // The way he was thrown (the car's way); he faces back at the car.
  const dir = _dir.set(k ? k.dir.x : -(f.hero.facing?.x ?? 0), 0, k ? k.dir.z : -(f.hero.facing?.z ?? 1));
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  const phase = k?.phase ?? "flung";
  const t = k?.t ?? 0;
  const { hipH, legK, shoulderY, reach } = body;
  // Lying back: 0 upright … 1 flat on his back (head along `dir`, chest to the sky).
  let lie: number;
  let hipY: number;
  if (phase === "flung") {
    lie = clamp(t / 0.45, 0, 1) * 0.85;
    hipY = P.y - 6;
  } else if (phase === "down") {
    lie = 1;
    hipY = ground + 10;
  } else {
    const u = clamp(t / GETUP, 0, 1);
    lie = 1 - smoothstep(0.05, 0.7, u);
    hipY = lerp(ground + 10, ground + hipH - 2, smoothstep(0.3, 1, u));
  }
  // Body up: from world up, tipping back toward the throw; chest (forward): from facing the car to the sky.
  const a = (lie * Math.PI) / 2;
  _up.copy(UP).multiplyScalar(Math.cos(a)).addScaledVector(dir, Math.sin(a));
  _fwd.set(-dir.x, 0, -dir.z).multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a));
  frameQuat(_up, _fwd, rot);
  const left = _left.set(1, 0, 0).applyQuaternion(rot);
  H.set(P.x, hipY, P.z);
  const flail = reduced || phase !== "flung" ? 0 : Math.sin(t * 22);
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    if (phase === "flung") {
      // Arms flung out and up (over his head as he tips back), legs splayed.
      targets[i].copy(H).addScaledVector(left, s * (reach * 0.75)).addScaledVector(_up, shoulderY + reach * 0.35 + 4 * flail * s).addScaledVector(_fwd, -6);
      targets[2 + i].copy(H).addScaledVector(left, s * 12).addScaledVector(_up, -30 * legK).addScaledVector(_fwd, (i === 0 ? 8 : -4) + 5 * flail);
    } else if (phase === "down") {
      // Flat out: arms on the ground beside his head, knees up a little.
      targets[i].copy(H).addScaledVector(left, s * (reach * 0.55)).addScaledVector(_up, shoulderY * 0.7);
      targets[i].y = Math.max(ground + 3, targets[i].y);
      targets[2 + i].copy(H).addScaledVector(left, s * 9).addScaledVector(_up, -30 * legK).addScaledVector(_fwd, 8);
      targets[2 + i].y = Math.max(ground + 4, targets[2 + i].y);
    } else {
      // Getting up: hands pushing on the ground behind him, then back to his sides; feet planted under him.
      const u = clamp(t / GETUP, 0, 1);
      const push = 1 - smoothstep(0.45, 0.85, u);
      const behind = targets[i].copy(H).addScaledVector(dir, 14).addScaledVector(left, s * 16);
      behind.y = ground + 3;
      const side = _side.copy(H).addScaledVector(left, s * 13).addScaledVector(UP, -6);
      targets[i].lerp(side, 1 - push);
      targets[2 + i].copy(H).addScaledVector(left, s * 6).addScaledVector(dir, -8 * push);
      targets[2 + i].y = ground + 3;
    }
  }
  return phase === "flung" ? 0.2 : 0.6;
}
