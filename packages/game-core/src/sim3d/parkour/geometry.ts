/**
 * Questions the parkour body asks the city's boxes: how high a wall goes, whether a ledge has
 * room on top to stand, where the next face is when a climb runs off the end of one, and where
 * to hang when dropping over a roof's edge. Pure, deterministic, allocation-light.
 */
import { collideSphere, groundBelow, raycastCity, type CityIndex, type SphereHit } from "../city";
import { HERO_RADIUS } from "../constants";
import { HANG_DOWN, MANTLE_IN } from "./constants";

const R = HERO_RADIUS;

const NO_HIT: SphereHit = { hit: false, top: false, topY: 0, wall: false, wallNx: 0, wallNz: 0, wallTop: 0, ceiling: false };
const probe = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

/** Whether a sphere of radius r at (x, y, z) touches nothing solid. */
export function clearAt(grid: CityIndex, x: number, y: number, z: number, r: number): boolean {
  probe.x = x;
  probe.y = y;
  probe.z = z;
  probe.vx = 0;
  probe.vy = 0;
  probe.vz = 0;
  return !collideSphere(grid, probe, r, NO_HIT).hit;
}

const ids: number[] = [];
/** Offsets along a ledge to look for room to pull up onto (units), nearest first. */
const LATERAL = [0, 16, -16, 32, -32, 48, -48];

/**
 * The top of the solid column at (x, z) around height y (a box there spanning y ± band), with
 * any box standing flush on it added (a stepped tier going on up). −1 if nothing's there.
 */
export function columnTop(grid: CityIndex, x: number, z: number, y: number, band = 14): number {
  const n = grid.queryBoxes(x, z, x, z, ids);
  let top = -1;
  for (let k = 0; k < n; k++) {
    const b = grid.boxes[ids[k]];
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    if (b.y1 < y - band || b.y0 > y + band) continue;
    if (b.y1 > top) top = b.y1;
  }
  if (top < 0) return -1;
  for (let grew = true; grew; ) {
    grew = false;
    for (let k = 0; k < n; k++) {
      const b = grid.boxes[ids[k]];
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (b.y0 <= top + 0.5 && b.y1 > top + 0.5) {
        top = b.y1;
        grew = true;
      }
    }
  }
  return top;
}

/** The box whose top is `top` under (x, z), or null. */
function boxAt(grid: CityIndex, x: number, z: number, top: number) {
  const n = grid.queryBoxes(x, z, x, z, ids);
  for (let k = 0; k < n; k++) {
    const b = grid.boxes[ids[k]];
    if (x >= b.x0 - 0.5 && x <= b.x1 + 0.5 && z >= b.z0 - 0.5 && z <= b.z1 + 0.5 && b.y1 > top - 0.5 && b.y1 < top + 0.5) return b;
  }
  return null;
}

/**
 * Whether a body against a wall (centre at x, z; the wall's outward normal n) can pull up over
 * its ledge at `top`: room to stand MANTLE_IN in from the edge (or nearer, on a narrow ledge),
 * or on the middle of a small top (a pole, a mast, a tank, an AC unit). With `spot`, where.
 */
export function ledgeOpen(grid: CityIndex, x: number, z: number, nx: number, nz: number, top: number): boolean;
export function ledgeOpen(grid: CityIndex, x: number, z: number, nx: number, nz: number, top: number, spot: true): { x: number; z: number } | null;
export function ledgeOpen(grid: CityIndex, x: number, z: number, nx: number, nz: number, top: number, spot = false): boolean | { x: number; z: number } | null {
  const fx = x - nx * (R + 2);
  const fz = z - nz * (R + 2);
  const b = boxAt(grid, fx, fz, top);
  if (b && (b.x1 - b.x0 < 2 * MANTLE_IN || b.z1 - b.z0 < 2 * MANTLE_IN)) {
    // A small top: stand on its middle across its narrow way, and where he grabbed it along a
    // long one (a billboard, a rail), never slid along it (roam-2).
    const cx = b.x1 - b.x0 < 2 * MANTLE_IN ? (b.x0 + b.x1) / 2 : Math.min(b.x1 - 4, Math.max(b.x0 + 4, fx));
    const cz = b.z1 - b.z0 < 2 * MANTLE_IN ? (b.z0 + b.z1) / 2 : Math.min(b.z1 - 4, Math.max(b.z0 + 4, fz));
    const ok = clearAt(grid, cx, top + R + 1, cz, R - 1);
    return spot ? (ok ? { x: cx, z: cz } : null) : ok;
  }
  // Straight over the edge, else a little along it (a prop on the roof right behind the hands
  // shouldn't leave him hanging there): the nearest spot with room, in a fixed order.
  for (const t of LATERAL) {
    for (const d of [MANTLE_IN, R + 8]) {
      const sx = x - nx * (R + d) - nz * t;
      const sz = z - nz * (R + d) + nx * t;
      if (groundBelow(grid, sx, sz, top + 2) < top - 2) continue;
      if (!clearAt(grid, sx, top + R + 1, sz, R)) continue;
      return spot ? { x: sx, z: sz } : true;
    }
  }
  return spot ? null : false;
}

/** The nearest wall face behind a climber (along −n) within R + range: how far, and its outward normal. */
export function wallSeek(grid: CityIndex, h: { x: number; y: number; z: number }, nx: number, nz: number, range: number): { d: number; nx: number; nz: number } | null {
  const hit = raycastCity(grid, h.x, h.y, h.z, -nx, 0, -nz, R + range);
  if (!hit || hit.box < 0 || hit.ny !== 0) return null;
  return { d: hit.t, nx: hit.nx, nz: hit.nz };
}

/**
 * Dropping over the edge of the roof he stands on, toward (dx, dz): the hang spot just outside
 * the edge (within reach of it, with a real drop below), or null.
 */
export function ledgeSpot(grid: CityIndex, h: { x: number; y: number; z: number }, dx: number, dz: number): { x: number; z: number; nx: number; nz: number; top: number } | null {
  const feet = h.y - R;
  if (feet < 40) return null;
  const n = grid.queryBoxes(h.x, h.z, h.x, h.z, ids);
  let b = null;
  for (let k = 0; k < n; k++) {
    const o = grid.boxes[ids[k]];
    if (h.x >= o.x0 && h.x <= o.x1 && h.z >= o.z0 && h.z <= o.z1 && o.y1 > feet - 2 && o.y1 < feet + 2) b = o;
  }
  if (!b) return null;
  const alongX = (dx < 0 ? -dx : dx) >= (dz < 0 ? -dz : dz);
  let nx = 0;
  let nz = 0;
  let edge: number;
  let dist: number;
  if (alongX) {
    nx = dx >= 0 ? 1 : -1;
    edge = nx > 0 ? b.x1 : b.x0;
    dist = (edge - h.x) * nx;
  } else {
    nz = dz >= 0 ? 1 : -1;
    edge = nz > 0 ? b.z1 : b.z0;
    dist = (edge - h.z) * nz;
  }
  if (dist > R + 34) return null;
  const x = alongX ? edge + nx * (R + 1) : h.x;
  const z = alongX ? h.z : edge + nz * (R + 1);
  // A real drop below, and room to hang.
  if (groundBelow(grid, x, z, b.y1 - 1) > b.y1 - 120) return null;
  if (!clearAt(grid, x, b.y1 - HANG_DOWN, z, R - 2)) return null;
  return { x, z, nx, nz, top: b.y1 };
}
