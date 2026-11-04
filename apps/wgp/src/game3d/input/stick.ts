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

/**
 * The camera's ground heading from a chase pose (position → target), or null when it looks
 * straight down. While the pose holds a steering heading (the stick held on a roof, the
 * camera easing behind the run) the stick goes by that instead, so the camera turning never
 * turns the steering under the thumb.
 */
export function viewFromPose(pose: { position: Vec3; target: Vec3; steer?: View | null } | null | undefined): View | null {
  if (!pose) return null;
  if (pose.steer) return pose.steer;
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
 * A touch stick from a drag: the offset from where the thumb landed (CSS px, y down), with
 * screen-down as back (y flips).
 *
 * - Inside `dead` px it's centred, so a thumb landing and rolling doesn't steer (or turn
 *   the camera's auto-follow off).
 * - Past it the length starts at `floor` and reaches 1 at `radius`: game-core's
 *   quantizeStick reads anything under 0.15 as centred, so a floor of 0.15 makes the edge
 *   of the dead zone the first walking step instead of a second, invisible dead zone.
 */
export function dragStick(dx: number, dy: number, radius: number, dead = 0, floor = 0): Stick {
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6 || radius <= 0 || d <= dead) return { x: 0, y: 0 };
  const t = radius > dead ? Math.min(1, (d - dead) / (radius - dead)) : 1;
  const k = (floor + (1 - floor) * t) / d;
  return { x: dx * k, y: -dy * k };
}

/** Where the stick's knob is drawn for a drag: the thumb's offset, held inside the ring (CSS px). */
export function stickKnob(dx: number, dy: number, radius: number): { x: number; y: number } {
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= radius || d < 1e-6) return { x: dx, y: dy };
  const k = radius / d;
  return { x: dx * k, y: dy * k };
}
