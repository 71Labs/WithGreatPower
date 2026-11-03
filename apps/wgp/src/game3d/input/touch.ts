/**
 * Touch, one thumb or two, as plain pointer bookkeeping (no DOM, so it's testable):
 *
 * - A thumb landing on the left 40% starts a floating stick where it lands; dragging it
 *   steers relative to the camera, past a small dead zone. With no stick the hero heads for
 *   the next stop, so one-thumb play is just holding the web.
 * - A thumb on the right 60% holds the web until it lifts.
 * - A second finger landing on the same side as one already down waits: if it drags, both
 *   turn into a two-finger drag that orbits the camera (a stick thumb plus a web thumb is
 *   play, not an orbit); if it lifts without dragging, nothing happened; if the first finger
 *   lifts first, the second takes over its job, so re-gripping never drops a web mid-swing.
 *   Lifting either orbiting finger ends the orbit; the other then does nothing until it lifts.
 */
import { dragStick } from "./stick";
import { ORBIT_PITCH_PER_PX, ORBIT_SLOP, ORBIT_YAW_PER_PX, STICK_DEAD_ZONE, STICK_FLOOR, STICK_RADIUS, STICK_ZONE } from "./bindings";
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

/** "pair": a second finger on a held finger's side, waiting to see if it drags (an orbit) or not. */
type Role = "stick" | "web" | "pair" | "orbit" | "inert";
type Side = "left" | "right";

interface Finger {
  role: Role;
  side: Side;
  x: number;
  y: number;
  /** Where a stick started, or where a pair finger landed. */
  ox: number;
  oy: number;
  /** A pair finger's partner (the stick or web finger it landed beside). */
  partner?: number;
}

const webSource = (id: number) => `touch:${id}`;

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

  down(id: number, x: number, y: number, width: number): void {
    if (this.fingers.has(id)) return;
    const side = TouchRouter.sideOf(x, width);
    const all = [...this.fingers.entries()];
    if (all.some(([, f]) => f.role === "orbit") || all.some(([, f]) => f.role === "pair" && f.side === side)) {
      this.fingers.set(id, { role: "inert", side, x, y, ox: x, oy: y });
      return;
    }
    const partner = all.find(([, f]) => f.side === side && (f.role === "stick" || f.role === "web"));
    if (partner) {
      this.fingers.set(id, { role: "pair", side, x, y, ox: x, oy: y, partner: partner[0] });
      return;
    }
    if (side === "left" && !all.some(([, f]) => f.role === "stick")) {
      this.startStick(id, { role: "stick", side, x, y, ox: x, oy: y });
      return;
    }
    this.fingers.set(id, { role: "web", side, x, y, ox: x, oy: y });
    this.sink.latch.setWeb(webSource(id), true);
  }

  move(id: number, x: number, y: number): void {
    const f = this.fingers.get(id);
    if (!f) return;
    if (f.role === "pair" && Math.hypot(x - f.ox, y - f.oy) > ORBIT_SLOP) this.startOrbit(f);
    if (f.role === "orbit") {
      // The midpoint of the two fingers moves; each finger reports half of it.
      const dx = (x - f.x) / 2;
      const dy = (y - f.y) / 2;
      this.sink.orbit(-dx * ORBIT_YAW_PER_PX, dy * ORBIT_PITCH_PER_PX, true);
    } else if (f.role === "stick") {
      this.sink.latch.setStick(dragStick(x - f.ox, y - f.oy, STICK_RADIUS, STICK_DEAD_ZONE, STICK_FLOOR));
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
    if (f.role === "pair" || f.role === "inert") return;
    // A finger waiting beside this one takes over its job.
    const heir = [...this.fingers.entries()].find(([, g]) => g.role === "pair" && g.partner === id);
    if (heir && f.role === "web") {
      const [hid, h] = heir;
      h.role = "web";
      h.partner = undefined;
      this.sink.latch.setWeb(webSource(hid), true);
    }
    this.release(id, f);
    if (heir && f.role === "stick") {
      const [hid, h] = heir;
      h.partner = undefined;
      this.startStick(hid, h);
    }
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

  /** A finger becomes the stick, its origin where it is now. */
  private startStick(id: number, f: Finger) {
    f.role = "stick";
    f.ox = f.x;
    f.oy = f.y;
    this.fingers.set(id, f);
    this.sink.stick?.({ active: true, ox: f.x, oy: f.y, x: f.x, y: f.y });
  }

  /** A pair finger dragged: it and its partner orbit the camera, and the partner lets go of what it held. */
  private startOrbit(f: Finger) {
    const pid = f.partner;
    const p = pid === undefined ? undefined : this.fingers.get(pid);
    f.partner = undefined;
    if (pid === undefined || !p || (p.role !== "stick" && p.role !== "web")) {
      f.role = "inert";
      return;
    }
    this.release(pid, p);
    p.role = "orbit";
    f.role = "orbit";
    this.sink.orbit(0, 0, true);
  }

  private release(id: number, f: Finger) {
    if (f.role === "web") this.sink.latch.setWeb(webSource(id), false);
    if (f.role === "stick") {
      this.sink.latch.setStick({ x: 0, y: 0 });
      this.sink.stick?.({ active: false, ox: f.ox, oy: f.oy, x: f.x, y: f.y });
    }
  }
}
