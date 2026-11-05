/**
 * The web-zip's target: the point the web would pull the hero to right now, for a heading.
 * Roof edges facing him (the point on the edge his heading crosses, with roof behind it to land
 * on) and perches (antenna and mast tips, water tanks), within ZIP_RANGE and ZIP_CONE of the
 * heading, in plain sight. A pure function of the hero, the heading and the city, so the scene
 * draws the same reticle the sim will use.
 */
import { groundBelow, lineClear } from "../city";
import { HERO_RADIUS, WATER_TOWER_TOP } from "../constants";
import { len2, len3 } from "../dmath";
import type { SimState } from "../types";
import { ZIP_CONE, ZIP_DROP, ZIP_LAND_IN, ZIP_MIN, ZIP_RANGE, ZIP_RISE } from "./constants";
import { clearAt } from "./world";

const R = HERO_RADIUS;
const ids: number[] = [];

export interface ZipTarget {
  /** The point the web sticks to (an edge's top, a perch's top). */
  x: number;
  y: number;
  z: number;
  /** Where the zip carries the body's centre: just over the edge (then on in), or onto the perch. */
  lx: number;
  ly: number;
  lz: number;
  /** An edge's outward normal (0, 0 for a perch). */
  nx: number;
  nz: number;
  perch: boolean;
}

export function zipTarget(s: SimState, hx: number, hz: number): ZipTarget | null {
  const h = s.hero;
  const grid = s.grid;
  let best: ZipTarget | null = null;
  let bestScore = -Infinity;
  const consider = (px: number, py: number, pz: number, t: ZipTarget) => {
    const dx = px - h.x;
    const dz = pz - h.z;
    const dh = len2(dx, dz);
    const d = len3(dx, py - h.y, dz);
    const rise = py - h.y;
    if (d < ZIP_MIN || d > ZIP_RANGE || dh < 1 || rise < -ZIP_DROP || rise > ZIP_RISE) return;
    const cone = (dx * hx + dz * hz) / dh;
    if (cone < ZIP_CONE) return;
    const score = cone * 600 - d * 0.35 - (rise < 0 ? -rise : rise) * 0.15;
    if (score <= bestScore) return;
    if (!lineClear(grid, h.x, h.y, h.z, px + t.nx * 3, py + 3, pz + t.nz * 3)) return;
    bestScore = score;
    best = t;
  };

  // Roof edges facing him: where his heading crosses the edge's line (else its nearest point).
  const n = grid.queryEdges(h.x - ZIP_RANGE, h.z - ZIP_RANGE, h.x + ZIP_RANGE, h.z + ZIP_RANGE, ids);
  for (let k = 0; k < n; k++) {
    const e = grid.edges[ids[k]];
    const perp = e.axis === 0 ? h.z : h.x;
    if ((perp - e.c) * e.n <= 0) continue;
    const along = e.axis === 0 ? h.x : h.z;
    const ha = e.axis === 0 ? hx : hz;
    const hp = e.axis === 0 ? hz : hx;
    let t = along;
    if (hp * (e.c - perp) > 1e-6) t = along + ((e.c - perp) / hp) * ha;
    const lo = e.lo + 24;
    const hi = e.hi - 24;
    if (lo > hi) continue;
    t = t < lo ? lo : t > hi ? hi : t;
    const nx = e.axis === 1 ? e.n : 0;
    const nz = e.axis === 0 ? e.n : 0;
    const px = e.axis === 0 ? t : e.c;
    const pz = e.axis === 0 ? e.c : t;
    // A roof behind the edge to land on.
    const ix = px - nx * ZIP_LAND_IN;
    const iz = pz - nz * ZIP_LAND_IN;
    if (groundBelow(grid, ix, iz, e.y + 2) < e.y - 2 || !clearAt(grid, ix, e.y + R + 1, iz, R)) continue;
    consider(px, e.y, pz, { x: px, y: e.y, z: pz, lx: px + nx * (R + 6), ly: e.y + R + 8, lz: pz + nz * (R + 6), nx, nz, perch: false });
  }

  // Perches: antenna and mast tips, water tanks.
  for (const p of s.city.props) {
    if (p.kind !== "antenna" && p.kind !== "water-tower") continue;
    const top = p.at.y + (p.kind === "water-tower" ? WATER_TOWER_TOP : p.h);
    if (len2(p.at.x - h.x, p.at.z - h.z) > ZIP_RANGE) continue;
    if (!clearAt(grid, p.at.x, top + R + 1, p.at.z, R - 1)) continue;
    consider(p.at.x, top, p.at.z, { x: p.at.x, y: top, z: p.at.z, lx: p.at.x, ly: top + R, lz: p.at.z, nx: 0, nz: 0, perch: true });
  }
  return best;
}
