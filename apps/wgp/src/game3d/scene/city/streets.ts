/**
 * Where the streets are, inferred from the building footprints: project every footprint onto
 * each axis, merge what overlaps (alleys under `alley` units count as one block), and the
 * gaps left inside the city bounds are the streets. The ground shader paints them with a
 * dashed centre line; everything else inside the bounds is sidewalk.
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
}

export const MAX_STREETS = 16;

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
  return {
    xs: gaps(xs, city.bounds.x0, city.bounds.x1, alley, minGap, sidewalk),
    zs: gaps(zs, city.bounds.z0, city.bounds.z1, alley, minGap, sidewalk),
  };
}
