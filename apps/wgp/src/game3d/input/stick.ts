/**
 * Sticks, from the player's point of view to the sim's. A stick is (right, forward) in
 * −1..1 with screen-up as forward; the camera's ground heading turns it into a world xz
 * direction, and game-core's quantizeStick makes that one of 64 headings and 4 magnitudes.
 * Camera maths ends here: the sim only ever sees `dir` and `mag`. Pure, no DOM.
 */
import { quantizeStick } from "@wgp/game-core/sim3d";
import type { Vec3 } from "@wgp/game-core/sim3d/contract";

export interface Stick {
  /** −1 (left) .. 1 (right). */
  x: number;
  /** −1 (back) .. 1 (forward, screen up). */
  y: number;
}

/** The camera's heading on the ground, a unit xz vector. */
export interface View {
  fx: number;
  fz: number;
}

/** With no camera yet, forward is −z (three.js's default camera looks that way). */
export const DEFAULT_VIEW: View = { fx: 0, fz: -1 };

/** The camera's ground heading from a chase pose (position → target), or null when it looks straight down. */
export function viewFromPose(pose: { position: Vec3; target: Vec3 } | null | undefined): View | null {
  if (!pose) return null;
  const dx = pose.target.x - pose.position.x;
  const dz = pose.target.z - pose.position.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  return d > 1e-6 ? { fx: dx / d, fz: dz / d } : null;
}

/**
 * A camera-relative stick as a world xz vector of the same length. Right is forward turned
 * a quarter to the right about +y: (−fz, fx).
 */
export function worldStick(stick: Stick, view: View | null): { x: number; z: number } {
  const { fx, fz } = view ?? DEFAULT_VIEW;
  return { x: -fz * stick.x + fx * stick.y, z: fx * stick.x + fz * stick.y };
}

/** A camera-relative stick as an InputFrame's dir and mag (dir is 0 whenever mag is 0). */
export function stickInput(stick: Stick, view: View | null): { dir: number; mag: number } {
  const w = worldStick(stick, view);
  return quantizeStick(w.x, w.z);
}

/** Held direction keys as a stick: opposite keys cancel, diagonals are length 1. */
export function keysStick(held: { forward: boolean; back: boolean; left: boolean; right: boolean }): Stick {
  const x = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  const y = (held.forward ? 1 : 0) - (held.back ? 1 : 0);
  if (x !== 0 && y !== 0) return { x: x * Math.SQRT1_2, y: y * Math.SQRT1_2 };
  return { x, y };
}

/**
 * A touch stick from a drag: the offset from where the thumb landed (CSS px, y down) over
 * the stick's radius, clamped to length 1. Screen-down is back, so y flips.
 */
export function dragStick(dx: number, dy: number, radius: number): Stick {
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6 || radius <= 0) return { x: 0, y: 0 };
  const k = Math.min(1, d / radius) / d;
  return { x: dx * k, y: -dy * k };
}
