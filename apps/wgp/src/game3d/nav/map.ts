/**
 * Map math for the minimap and the full city map. Pure: no DOM, no three.js.
 *
 * - The map plane is the world's xz: +x is east (map right) and −z is north (map up), so a
 *   north-up map draws world (x, z) at (x, z) scaled, with y down the screen like z.
 * - A heading-up minimap turns that plane so the camera's forward points up the screen.
 * - Stops: a fight's target is its arena centre, an errand's is the ally (as the sim's
 *   stopTarget). The route is the frame's v1.3 `route` when the sim sends it, else the
 *   remaining stops from `City.zones` and the frame's stop index.
 */
import type { City, RenderFrame3D, Vec3, Zone } from "@wgp/game-core/sim3d/contract";

/**
 * World units per metre for distances on screen. The hero is drawn 88 units tall and reads
 * as a big lad of about 2.2 m; city blocks come out at about 15 m and the city at 180 m.
 */
export const UNITS_PER_METRE = 40;

/** Units → whole metres, in steps of 5 past 100 m so the label doesn't flicker. */
export function metres(units: number): number {
  const m = Math.max(0, units) / UNITS_PER_METRE;
  return m < 100 ? Math.round(m) : Math.round(m / 5) * 5;
}

/** Where the hero has to get to for a stop: the arena centre, or the ally on an errand. */
export function stopPoint(zone: Zone): Vec3 {
  return zone.kind === "errand" ? (zone.allyAt ?? zone.center) : zone.center;
}

/** The stops still ahead, in order: the frame's route if it has one, else the city's zones from `stop` on. */
export function remainingRoute(city: City, frame: Pick<RenderFrame3D, "stop" | "route">): Vec3[] {
  if (frame.route) return frame.route;
  const out: Vec3[] = [];
  for (let i = Math.max(0, frame.stop); i < city.zones.length; i++) out.push(stopPoint(city.zones[i]));
  return out;
}

/** The route polyline the rings sit on: from the last stop (or the start) through every stop still ahead. */
export function routeLine(city: City, frame: Pick<RenderFrame3D, "stop" | "route">): Vec3[] {
  const prev = frame.stop > 0 && city.zones[frame.stop - 1] ? stopPoint(city.zones[frame.stop - 1]) : city.start;
  return [prev, ...remainingRoute(city, frame)];
}

/**
 * The direction (unit xz) of the route segment nearest `p`: the way a ring there should face.
 * One point: the way from `p` to it. Fewer: +x.
 */
export function routeDirAt(p: { x: number; z: number }, line: readonly { x: number; z: number }[]): { x: number; z: number } {
  if (line.length === 1) return unit(line[0].x - p.x, line[0].z - p.z);
  let best = Infinity;
  let dir = { x: 1, z: 0 };
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    if (len2 < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / len2));
    const dx = a.x + ex * t - p.x;
    const dz = a.z + ez * t - p.z;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      dir = unit(ex, ez);
    }
  }
  return dir;
}

function unit(x: number, z: number): { x: number; z: number } {
  const d = Math.hypot(x, z);
  return d > 1e-6 ? { x: x / d, z: z / d } : { x: 1, z: 0 };
}

/* ------------------------------------------------------------------ the view */

/** A map view: which world point sits at the canvas point (cx, cy), at what scale, turned by how much. */
export interface MapView {
  /** World point at the view's centre. */
  x: number;
  z: number;
  /** Canvas px per world unit. */
  scale: number;
  /** Clockwise screen rotation, radians (0 is north up). */
  rotation: number;
  /** The canvas point the centre lands on. */
  cx: number;
  cy: number;
}

/**
 * The rotation that puts a camera looking along (fx, fz) facing up the screen: the angle θ
 * with R(θ)·(fx, fz) = (0, −1) for the canvas's clockwise rotate(θ).
 */
export function headingUpRotation(fx: number, fz: number): number {
  if (Math.abs(fx) < 1e-9 && Math.abs(fz) < 1e-9) return 0;
  return Math.atan2(-fx, -fz);
}

/** A world xz point on the view's canvas. */
export function toMap(view: MapView, x: number, z: number): { x: number; y: number } {
  const dx = (x - view.x) * view.scale;
  const dy = (z - view.z) * view.scale;
  const c = Math.cos(view.rotation);
  const s = Math.sin(view.rotation);
  return { x: view.cx + c * dx - s * dy, y: view.cy + s * dx + c * dy };
}

/** A world direction (unit xz) as a screen angle for an arrow drawn pointing along +x then rotated. */
export function mapAngle(view: MapView, dx: number, dz: number): number {
  return Math.atan2(dz, dx) + view.rotation;
}

/**
 * Keeps a point inside a circle of radius `r` about (cx, cy): points past the rim slide
 * back along their bearing onto it. `clamped` says whether it moved.
 */
export function clampToDisc(x: number, y: number, cx: number, cy: number, r: number): { x: number; y: number; clamped: boolean; angle: number } {
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  if (d <= r) return { x, y, clamped: false, angle };
  return { x: cx + (dx / d) * r, y: cy + (dy / d) * r, clamped: true, angle };
}

/** The view that fits the whole city, north up, in a w × h canvas with `pad` px to spare. */
export function fitCity(bounds: City["bounds"], w: number, h: number, pad = 0): MapView {
  const bw = Math.max(1, bounds.x1 - bounds.x0);
  const bh = Math.max(1, bounds.z1 - bounds.z0);
  const scale = Math.max(1e-6, Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh));
  return { x: (bounds.x0 + bounds.x1) / 2, z: (bounds.z0 + bounds.z1) / 2, scale, rotation: 0, cx: w / 2, cy: h / 2 };
}

/** A compass word for a world direction (north is −z): for screen-reader lines. */
export function compass(dx: number, dz: number): string {
  if (Math.hypot(dx, dz) < 1e-6) return "here";
  const names = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
  const a = Math.atan2(dz, dx);
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return names[i];
}
