/**
 * Touch, one thumb or two, as plain pointer bookkeeping (no DOM, so it's testable):
 *
 * - A thumb landing on the left 40% starts a floating stick where it lands; dragging it
 *   steers relative to the camera. With no stick the hero heads for the next stop, so
 *   one-thumb play is just holding the web.
 * - A thumb on the right 60% holds the web until it lifts.
 * - A second finger landing on the same side as one already down turns both into a
 *   two-finger drag that orbits the camera (a stick thumb plus a web thumb is play, not
 *   an orbit). Lifting either ends it; the other finger then does nothing until it lifts.
 */
import { dragStick } from "./stick";
import { ORBIT_PITCH_PER_PX, ORBIT_YAW_PER_PX, STICK_RADIUS, STICK_ZONE } from "./bindings";
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
  orbit(dYaw: number, dPitch: number, holding: boolean): void;
  stick?(visual: StickVisual): void;
}

type Role = "stick" | "web" | "orbit" | "inert";
type Side = "left" | "right";

interface Finger {
  role: Role;
  side: Side;
  x: number;
  y: number;
  /** Where a stick started. */
  ox: number;
  oy: number;
}

const webSource = (id: number) => `touch:${id}`;

export class TouchRouter {
  private readonly fingers = new Map<number, Finger>();

  constructor(private readonly sink: TouchSink) {}

  /** The share of the width (from the left) that is the stick zone. */
  static sideOf(x: number, width: number): Side {
    return x < width * STICK_ZONE ? "left" : "right";
  }

  down(id: number, x: number, y: number, width: number): void {
    if (this.fingers.has(id)) return;
    const side = TouchRouter.sideOf(x, width);
    const orbiting = [...this.fingers.values()].some((f) => f.role === "orbit");
    const partner = orbiting ? undefined : [...this.fingers.entries()].find(([, f]) => f.side === side && (f.role === "stick" || f.role === "web"));
    if (partner) {
      const [pid, other] = partner;
      this.release(pid, other);
      other.role = "orbit";
      this.fingers.set(id, { role: "orbit", side, x, y, ox: x, oy: y });
      this.sink.orbit(0, 0, true);
      return;
    }
    if (orbiting) {
      this.fingers.set(id, { role: "inert", side, x, y, ox: x, oy: y });
      return;
    }
    if (side === "left" && ![...this.fingers.values()].some((f) => f.role === "stick")) {
      this.fingers.set(id, { role: "stick", side, x, y, ox: x, oy: y });
      this.sink.stick?.({ active: true, ox: x, oy: y, x, y });
      return;
    }
    this.fingers.set(id, { role: "web", side, x, y, ox: x, oy: y });
    this.sink.latch.setWeb(webSource(id), true);
  }

  move(id: number, x: number, y: number): void {
    const f = this.fingers.get(id);
    if (!f) return;
    if (f.role === "orbit") {
      // The midpoint of the two fingers moves; each finger reports half of it.
      const dx = (x - f.x) / 2;
      const dy = (y - f.y) / 2;
      this.sink.orbit(-dx * ORBIT_YAW_PER_PX, dy * ORBIT_PITCH_PER_PX, true);
    } else if (f.role === "stick") {
      this.sink.latch.setStick(dragStick(x - f.ox, y - f.oy, STICK_RADIUS));
      this.sink.stick?.({ active: true, ox: f.ox, oy: f.oy, x, y });
    }
    f.x = x;
    f.y = y;
  }

  up(id: number): void {
    const f = this.fingers.get(id);
    if (!f) return;
    this.fingers.delete(id);
    if (f.role === "orbit") {
      for (const other of this.fingers.values()) if (other.role === "orbit") other.role = "inert";
      this.sink.orbit(0, 0, false);
      return;
    }
    this.release(id, f);
  }

  /** Drop every finger (pause, a sheet, a lost focus). */
  reset(): void {
    for (const [id, f] of this.fingers) this.release(id, f);
    const orbiting = [...this.fingers.values()].some((f) => f.role === "orbit");
    this.fingers.clear();
    if (orbiting) this.sink.orbit(0, 0, false);
  }

  /** The role a finger has, for tests. */
  roleOf(id: number): Role | null {
    return this.fingers.get(id)?.role ?? null;
  }

  private release(id: number, f: Finger) {
    if (f.role === "web") this.sink.latch.setWeb(webSource(id), false);
    if (f.role === "stick") {
      this.sink.latch.setStick({ x: 0, y: 0 });
      this.sink.stick?.({ active: false, ox: f.ox, oy: f.oy, x: f.x, y: f.y });
    }
  }
}
