/**
 * Where the streets are, inferred from the building footprints: project every footprint onto
 * each axis, merge what overlaps (alleys under `alley` units count as one block), and the
 * gaps left inside the city bounds are the streets. The ground shader paints them with a
 * dashed centre line and crosswalks; everything else inside the bounds is sidewalk.
 *
 * Street lamps stand a fixed spacing apart, counted from the first crossing on each axis, so
 * (with the city's regular block pitch) they fall mid-block and never in a crossing; the
 * ground shader paints their light pools from the same numbers.
 *
 * The contract has no street list, and this keeps the scene working for any grid city.
 */
import type { City } from "@wgp/game-core/sim3d/contract";

export interface Street {
  /** Centre line on the axis. */
  c: number;
  /** Full width, curb to curb. */
  w: number;
}

export interface StreetGrid {
  /** Streets that run along z, at fixed x. */
  xs: Street[];
  /** Streets that run along x, at fixed z. */
  zs: Street[];
  /** Where lamp spacing starts: along x (from the first street at fixed x) and along z. */
  lampOrigin: { x: number; z: number };
}

export const MAX_STREETS = 16;

/** Street lamps: spacing along a street (they alternate sides), distance from the curb onto the walk, light-pool radius. */
export const LAMP = { spacing: 260, curb: 8, pool: 46 } as const;

/**
 * Lamp stops along one axis, from `origin`, inside [lo, hi]: where each stands and which
 * side of the street it is on (they zigzag, +1 on even stops).
 */
export function lampStops(origin: number, lo: number, hi: number): { at: number; side: 1 | -1 }[] {
  const out: { at: number; side: 1 | -1 }[] = [];
  const first = Math.ceil((lo - origin) / LAMP.spacing - 0.5);
  for (let n = first; ; n++) {
    const at = origin + (n + 0.5) * LAMP.spacing;
    if (at > hi) break;
    if (at >= lo) out.push({ at, side: ((n % 2) + 2) % 2 === 0 ? 1 : -1 });
  }
  return out;
}

function gaps(intervals: [number, number][], lo: number, hi: number, alley: number, minGap: number, sidewalk: number): Street[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + alley) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const out: Street[] = [];
  let cursor = lo;
  for (const [a, b] of merged) {
    if (a - cursor >= minGap) out.push({ c: (a + cursor) / 2, w: Math.max(20, a - cursor - sidewalk * 2) });
    cursor = Math.max(cursor, b);
  }
  if (hi - cursor >= minGap) out.push({ c: (hi + cursor) / 2, w: Math.max(20, hi - cursor - sidewalk * 2) });
  return out.slice(0, MAX_STREETS);
}

export function inferStreets(city: City, alley = 30, minGap = 70, sidewalk = 16): StreetGrid {
  const xs: [number, number][] = city.buildings.map((b) => [b.x0, b.x1]);
  const zs: [number, number][] = city.buildings.map((b) => [b.z0, b.z1]);
  const sx = gaps(xs, city.bounds.x0, city.bounds.x1, alley, minGap, sidewalk);
  const sz = gaps(zs, city.bounds.z0, city.bounds.z1, alley, minGap, sidewalk);
  return { xs: sx, zs: sz, lampOrigin: { x: sx[0]?.c ?? city.bounds.x0, z: sz[0]?.c ?? city.bounds.z0 } };
}
