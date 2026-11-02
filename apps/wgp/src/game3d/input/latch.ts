/**
 * The input latch between the controls and the fixed-step sim: the controls report
 * whenever they like (key events, pointer moves); the loop takes exactly one InputFrame per
 * sim tick.
 *
 * - The stick and the web button are held state: every tick uses the latest value. The
 *   web is held while any source holds it (Space, the mouse, a thumb), so letting go of one
 *   doesn't drop a web another still holds.
 * - An ability or Gwei press is one-shot: it stays latched until a tick takes it, so a tap
 *   shorter than a tick still counts, exactly once. Later ticks in the same animation
 *   frame see only the held state. The latest press wins.
 *
 * Pure, no DOM; the camera heading comes in at take() time.
 */
import type { InputFrame } from "@wgp/game-core/sim3d/contract";

import { stickInput, type Stick, type View } from "./stick";

export type Shot = InputFrame["shot"];

const finite = (n: number) => (Number.isFinite(n) ? n : 0);

/**
 * The stick the player holds right now (camera-relative), for the chase camera: steering
 * anything but forward pauses its auto-follow, so the camera never turns the steering under
 * the player's thumb. Only a latch writes it, and the autopilot never feeds one, so it stays
 * centred then. One play surface at a time, so one shared value.
 */
export const heldStick: Stick = { x: 0, y: 0 };

export class InputLatch {
  private stick: Stick = { x: 0, y: 0 };
  private readonly webs = new Set<string>();
  private shot: Shot = 0;

  /** The camera-relative stick, clamped to length 1 (NaN reads as centred). */
  setStick(stick: Stick): void {
    const x = finite(stick.x);
    const y = finite(stick.y);
    const d = Math.sqrt(x * x + y * y);
    this.stick = d > 1 ? { x: x / d, y: y / d } : { x, y };
    heldStick.x = this.stick.x;
    heldStick.y = this.stick.y;
  }

  /** One source (a key, the mouse, a thumb) holding or letting go of the web. */
  setWeb(source: string, held: boolean): void {
    if (held) this.webs.add(source);
    else this.webs.delete(source);
  }

  get web(): boolean {
    return this.webs.size > 0;
  }

  /** Latch an ability (1–4) or Gwei (5) for the next tick. */
  pushShot(shot: Shot): void {
    if (shot >= 1 && shot <= 5) this.shot = shot;
  }

  /** The frame for the next tick, which clears the latched shot. Always a fresh object. */
  take(view: View | null): InputFrame {
    const frame = this.peek(view);
    this.shot = 0;
    return frame;
  }

  /** What take() would give, without clearing anything. */
  peek(view: View | null): InputFrame {
    const { dir, mag } = stickInput(this.stick, view);
    return { dir: mag ? dir : 0, mag, web: this.webs.size > 0, shot: this.shot };
  }

  /** Let go of everything (pause, an errand sheet, a lost focus). */
  clear(): void {
    this.stick = { x: 0, y: 0 };
    heldStick.x = 0;
    heldStick.y = 0;
    this.webs.clear();
    this.shot = 0;
  }
}
