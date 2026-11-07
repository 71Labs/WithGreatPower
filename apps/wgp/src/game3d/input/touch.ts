/**
 * Touch, one thumb or several, as plain pointer bookkeeping (no DOM, no timers, so it's
 * testable; the controls pass the time in and poll):
 *
 * - The stick: the first thumb on the left 40% starts a floating stick where it lands;
 *   dragging it steers relative to the camera, past a small dead zone.
 * - The web side (the right 60%): a thumb there holds the web. Where it has to be quick (a
 *   night, free roam in the air, or another thumb already holding the web: a re-grip), it holds
 *   it the moment it lands. Elsewhere (free roam on a roof or a wall) it waits WEB_HOLD_MS: a
 *   thumb that drags first is a look and never fires a web; one that stays holds the web; one
 *   that lifts first did nothing.
 * - Looking: any finger that isn't the stick turns the camera once it has dragged LOOK_SLOP
 *   from where it landed, a web thumb included (look round mid-swing without letting go). Two
 *   fingers turning share the turn (their midpoint moves). The stick never turns the camera,
 *   so a stick and a look go together: one thumb each.
 * - A second finger on the stick's side waits: it looks if it drags, and takes the stick over
 *   (centred where it is) if the first thumb lifts, so re-gripping never drops the stick.
 *
 * The camera turn is mouse-like: drag right to look right, drag up to look up.
 */
import { dragStick } from "./stick";
import { LOOK_SLOP, STICK_DEAD_ZONE, STICK_FLOOR, STICK_RADIUS, STICK_ZONE, TOUCH_LOOK_PITCH_PER_PX, TOUCH_LOOK_YAW_PER_PX, WEB_HOLD_MS } from "./bindings";
import type { InputLatch } from "./latch";

/** Where the floating stick is drawn: its origin and the thumb, CSS px. */
export interface StickVisual {
  active: boolean;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

export interface TouchSink {
  latch: InputLatch;
  /** Radians to turn this event (yaw, pitch; before the look speed), and whether a finger holds the camera. */
  orbit(dYaw: number, dPitch: number, holding: boolean): void;
  stick?(visual: StickVisual): void;
  /**
   * Whether a thumb on the web side holds the web the moment it lands (true), or waits to see
   * if it drags (a look). Default: always at once (a night, where the web is the game).
   */
  webAtOnce?(): boolean;
}

/** "wait": a finger whose job isn't decided yet (a web-side thumb on a roof, a spare thumb by the stick). */
export type TouchRole = "stick" | "web" | "wait" | "look";
type Side = "left" | "right";

interface Finger {
  role: TouchRole;
  side: Side;
  /** Where it was last (CSS px). */
  x: number;
  y: number;
  /** Where it landed (a stick: its origin). */
  ox: number;
  oy: number;
  /** When it landed (ms, the caller's clock). */
  t0: number;
  /** Past the slop: its drags turn the camera. */
  turning: boolean;
}

const webSource = (id: number) => `touch:${id}`;

/**
 * The camera turn for a finger's drag (CSS px, y down), when `share` fingers are turning it
 * together: mouse-like, so dragging right turns right (yaw down, as the chase camera counts it)
 * and dragging up looks up.
 */
export function lookDelta(dx: number, dy: number, share = 1): { yaw: number; pitch: number } {
  const k = 1 / Math.max(1, share);
  return { yaw: -dx * k * TOUCH_LOOK_YAW_PER_PX, pitch: dy * k * TOUCH_LOOK_PITCH_PER_PX };
}

/** Whether a finger has dragged far enough from where it landed to be a look. */
export const pastSlop = (dx: number, dy: number, slop = LOOK_SLOP) => dx * dx + dy * dy > slop * slop;

export class TouchRouter {
  private readonly fingers = new Map<number, Finger>();

  constructor(private readonly sink: TouchSink) {}

  /** The share of the width (from the left) that is the stick zone. */
  static sideOf(x: number, width: number): Side {
    return x < width * STICK_ZONE ? "left" : "right";
  }

  /** Fingers down right now (a primary touch with any of these left over means they were lost). */
  get size(): number {
    return this.fingers.size;
  }

  /** Whether any finger is waiting on the web side (the controls poll until it decides). */
  get waiting(): boolean {
    for (const f of this.fingers.values()) if (f.role === "wait" && f.side === "right") return true;
    return false;
  }

  down(id: number, x: number, y: number, width: number, now = 0): void {
    if (this.fingers.has(id)) return;
    const side = TouchRouter.sideOf(x, width);
    const f: Finger = { role: "wait", side, x, y, ox: x, oy: y, t0: now, turning: false };
    const all = [...this.fingers.values()];
    if (side === "left") {
      this.fingers.set(id, f);
      if (!all.some((g) => g.role === "stick")) this.startStick(id, f);
      return;
    }
    this.fingers.set(id, f);
    const quick = this.sink.webAtOnce?.() ?? true;
    if (quick || all.some((g) => g.role === "web")) this.startWeb(id, f);
  }

  move(id: number, x: number, y: number, now?: number): void {
    const f = this.fingers.get(id);
    if (!f) return;
    if (f.role === "stick") {
      this.sink.latch.setStick(dragStick(x - f.ox, y - f.oy, STICK_RADIUS, STICK_DEAD_ZONE, STICK_FLOOR));
      this.sink.stick?.({ active: true, ox: f.ox, oy: f.oy, x, y });
      f.x = x;
      f.y = y;
      return;
    }
    // A web-side thumb that stayed put long enough holds the web before this drag counts.
    if (f.role === "wait" && f.side === "right" && now !== undefined && now - f.t0 >= WEB_HOLD_MS) this.startWeb(id, f);
    if (!f.turning) {
      if (pastSlop(x - f.ox, y - f.oy)) {
        // The turn starts from here, so crossing the slop doesn't jump the camera.
        if (f.role === "wait") f.role = "look";
        f.turning = true;
        this.sink.orbit(0, 0, true);
      }
      f.x = x;
      f.y = y;
      return;
    }
    const d = lookDelta(x - f.x, y - f.y, this.turningCount());
    this.sink.orbit(d.yaw, d.pitch, true);
    f.x = x;
    f.y = y;
  }

  /** Decide the web-side thumbs that have waited long enough without dragging: they hold the web. */
  poll(now: number): void {
    for (const [id, f] of this.fingers) if (f.role === "wait" && f.side === "right" && now - f.t0 >= WEB_HOLD_MS) this.startWeb(id, f);
  }

  up(id: number): void {
    const f = this.fingers.get(id);
    if (!f) return;
    this.fingers.delete(id);
    this.release(id, f);
    if (f.turning && this.turningCount() === 0) this.sink.orbit(0, 0, false);
    if (f.role !== "stick") return;
    // A spare thumb by the stick (still, not looking) takes it over.
    for (const [hid, h] of this.fingers) {
      if (h.side === "left" && h.role === "wait") {
        this.startStick(hid, h);
        break;
      }
    }
  }

  /** Drop every finger (pause, a sheet, a lost focus). */
  reset(): void {
    const turning = this.turningCount() > 0;
    for (const [id, f] of this.fingers) this.release(id, f);
    this.fingers.clear();
    if (turning) this.sink.orbit(0, 0, false);
  }

  /** The role a finger has, for tests. */
  roleOf(id: number): TouchRole | null {
    return this.fingers.get(id)?.role ?? null;
  }

  /** Whether a finger's drags turn the camera, for tests. */
  turns(id: number): boolean {
    return this.fingers.get(id)?.turning ?? false;
  }

  private turningCount(): number {
    let n = 0;
    for (const f of this.fingers.values()) if (f.turning) n++;
    return n;
  }

  /** A finger becomes the stick, its origin where it is now. */
  private startStick(id: number, f: Finger) {
    f.role = "stick";
    f.turning = false;
    f.ox = f.x;
    f.oy = f.y;
    this.fingers.set(id, f);
    this.sink.stick?.({ active: true, ox: f.x, oy: f.y, x: f.x, y: f.y });
  }

  private startWeb(id: number, f: Finger) {
    f.role = "web";
    this.sink.latch.setWeb(webSource(id), true);
  }

  private release(id: number, f: Finger) {
    if (f.role === "web") this.sink.latch.setWeb(webSource(id), false);
    if (f.role === "stick") {
      this.sink.latch.setStick({ x: 0, y: 0 });
      this.sink.stick?.({ active: false, ox: f.ox, oy: f.oy, x: f.x, y: f.y });
    }
  }
}
