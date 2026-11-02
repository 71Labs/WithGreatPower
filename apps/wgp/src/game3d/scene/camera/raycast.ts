/**
 * The city's solids for the camera and the shadows: every building box and setback, the
 * bridge deck and legs, water towers and billboards as AABBs; a ray cast against them, and
 * the surface height under a point.
 *
 * The camera uses game-core's `raycastCity` (the sim's own spatial hash) for the city, plus
 * these local boxes for the big rooftop props the sim doesn't collide with. Pure TS, no
 * allocation per call.
 */
import { CityIndex, raycastCity } from "@wgp/game-core/sim3d";
import type { City, Vec3 } from "@wgp/game-core/sim3d/contract";

import type { Raycast } from "./chase";

export interface CitySolids {
  count: number;
  minX: Float32Array;
  minY: Float32Array;
  minZ: Float32Array;
  maxX: Float32Array;
  maxY: Float32Array;
  maxZ: Float32Array;
  /** A coarse xz grid of box indices, for point queries. */
  cell: number;
  gx0: number;
  gz0: number;
  cols: number;
  rows: number;
  grid: number[][];
}

type Aabb = [number, number, number, number, number, number];

/** Water towers and billboards: big rooftop props the camera must not sit behind or inside. */
function propBoxes(city: City): Aabb[] {
  const boxes: Aabb[] = [];
  for (const p of city.props) {
    if (p.kind !== "water-tower" && p.kind !== "billboard") continue;
    const r = Math.max(p.w, p.d) / 2;
    const top = p.kind === "billboard" ? p.at.y + 34 + p.h : p.at.y + p.h;
    boxes.push([p.at.x - r, p.at.y, p.at.z - r, p.at.x + r, top, p.at.z + r]);
  }
  return boxes;
}

/** Buildings, setbacks, the bridge (deck and legs) and, unless `props` is false, the big props. */
export function citySolids(city: City, opts: { cell?: number; props?: boolean; city?: boolean } = {}): CitySolids {
  const cell = opts.cell ?? 200;
  const boxes: Aabb[] = [];
  if (opts.city !== false) {
    for (const b of city.buildings) {
      boxes.push([b.x0, 0, b.z0, b.x1, b.h, b.z1]);
      if (b.top) boxes.push([b.top.x0, b.h, b.top.z0, b.top.x1, b.top.h, b.top.z1]);
    }
    if (city.bridge) {
      const d = city.bridge.deck;
      boxes.push([d.x0, d.y - 44, d.z0, d.x1, d.y, d.z1]);
      const h = city.bridge.towerHalf ?? 25;
      for (const t of city.bridge.towers) boxes.push([t.x - h, 0, t.z - h, t.x + h, t.y, t.z + h]);
    }
  }
  if (opts.props !== false) boxes.push(...propBoxes(city));
  const n = boxes.length;
  const s: CitySolids = {
    count: n,
    minX: new Float32Array(n),
    minY: new Float32Array(n),
    minZ: new Float32Array(n),
    maxX: new Float32Array(n),
    maxY: new Float32Array(n),
    maxZ: new Float32Array(n),
    cell,
    gx0: city.bounds.x0,
    gz0: city.bounds.z0,
    cols: Math.max(1, Math.ceil((city.bounds.x1 - city.bounds.x0) / cell)),
    rows: Math.max(1, Math.ceil((city.bounds.z1 - city.bounds.z0) / cell)),
    grid: [],
  };
  for (let i = 0; i < s.cols * s.rows; i++) s.grid.push([]);
  boxes.forEach(([x0, y0, z0, x1, y1, z1], i) => {
    s.minX[i] = x0;
    s.minY[i] = y0;
    s.minZ[i] = z0;
    s.maxX[i] = x1;
    s.maxY[i] = y1;
    s.maxZ[i] = z1;
    const c0 = Math.max(0, Math.floor((x0 - s.gx0) / cell));
    const c1 = Math.min(s.cols - 1, Math.floor((x1 - s.gx0) / cell));
    const r0 = Math.max(0, Math.floor((z0 - s.gz0) / cell));
    const r1 = Math.min(s.rows - 1, Math.floor((z1 - s.gz0) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) s.grid[r * s.cols + c].push(i);
  });
  return s;
}

/** Distance along `dir` (unit) to the first box, or null within `maxDist`. Slab test over every box. */
export function raycastSolids(s: CitySolids, o: Vec3, dir: Vec3, maxDist: number): number | null {
  const ix = 1 / (dir.x || 1e-12);
  const iy = 1 / (dir.y || 1e-12);
  const iz = 1 / (dir.z || 1e-12);
  let best = maxDist;
  let found = false;
  for (let i = 0; i < s.count; i++) {
    let t0 = (s.minX[i] - o.x) * ix;
    let t1 = (s.maxX[i] - o.x) * ix;
    let tmin = Math.min(t0, t1);
    let tmax = Math.max(t0, t1);
    t0 = (s.minY[i] - o.y) * iy;
    t1 = (s.maxY[i] - o.y) * iy;
    tmin = Math.max(tmin, Math.min(t0, t1));
    tmax = Math.min(tmax, Math.max(t0, t1));
    if (tmax < tmin) continue;
    t0 = (s.minZ[i] - o.z) * iz;
    t1 = (s.maxZ[i] - o.z) * iz;
    tmin = Math.max(tmin, Math.min(t0, t1));
    tmax = Math.min(tmax, Math.max(t0, t1));
    if (tmax < tmin || tmax < 0) continue;
    const t = Math.max(0, tmin);
    if (t < best) {
      best = t;
      found = true;
    }
  }
  return found ? best : null;
}

/** The camera's ray: game-core's raycastCity against the city, then the big rooftop props. */
export function createCityRaycast(city: City): Raycast {
  const grid = new CityIndex(city);
  const props = citySolids(city, { city: false });
  return (o, d, max) => {
    const hit = raycastCity(grid, o.x, o.y, o.z, d.x, d.y, d.z, max);
    const prop = raycastSolids(props, o, d, hit ? hit.t : max);
    return prop ?? (hit ? hit.t : null);
  };
}

/** The same ray against the local boxes only (no game-core index). */
export function createLocalRaycast(city: City): Raycast {
  const s = citySolids(city);
  return (o, d, max) => raycastSolids(s, o, d, max);
}

/** The highest surface at or below `y` under (x, z): a roof, the bridge deck, or the street (0). */
export function surfaceBelow(s: CitySolids, x: number, z: number, y = Infinity): number {
  const c = Math.floor((x - s.gx0) / s.cell);
  const r = Math.floor((z - s.gz0) / s.cell);
  if (c < 0 || r < 0 || c >= s.cols || r >= s.rows) return 0;
  let best = 0;
  for (const i of s.grid[r * s.cols + c]) {
    if (x < s.minX[i] || x > s.maxX[i] || z < s.minZ[i] || z > s.maxZ[i]) continue;
    const top = s.maxY[i];
    if (top <= y + 1 && top > best) best = top;
  }
  return best;
}
