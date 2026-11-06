/**
 * A taut web drawn the way a rope would lie: over the roof edge it would otherwise cut through.
 *
 * The sim keeps the rope straight from the hero to the anchor (it checks the line when it
 * attaches, not as he swings round under a roof, and a setback's edge sits back from the
 * facade below it), so the straight line from the fist can pass through a building. Drawn
 * straight it vanishes into the wall and comes out the roof. Here the strand bends instead:
 * over the roof's edge (or round a corner) of the first building it would cross, at most
 * twice, always ending on the sim's own anchor. Only the drawing changes.
 *
 * Pure TS over the city's solids (camera/raycast.ts); no allocation per call.
 */
import type { CitySolids } from "../camera/raycast";

/** The ends of a crossing this close to a strand's ends don't count (the anchor's own face). */
const END_MARGIN = 3;
/** A strand inside a box for less than this is a graze along its face, not a crossing. */
const GRAZE = 1.5;
/** How far a wrap point sits off the box, so the strand lies on the edge, not in it. */
const LIFT = 0.6;

/** The first crossing firstCrossing() found: the box, and where along the segment. */
const hit = { box: -1, t0: 0, t1: 0 };
const cand = new Float64Array(3 * 8);
const best = new Float64Array(6);

/** Where clip() found a segment inside a box, as fractions of it. */
let c0 = 0;
let c1 = 0;

/** One axis of the slab test: narrows [c0, c1]; false once it's empty. */
function slab(o: number, d: number, lo: number, hi: number): boolean {
  if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
  let u0 = (lo - o) / d;
  let u1 = (hi - o) / d;
  if (u0 > u1) {
    const t = u0;
    u0 = u1;
    u1 = t;
  }
  if (u0 > c0) c0 = u0;
  if (u1 < c1) c1 = u1;
  return c1 >= c0;
}

/** Segment a→b against box i shrunk by `shrink`: whether it's inside it, between [c0, c1]. */
function clip(s: CitySolids, i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, shrink: number): boolean {
  c0 = 0;
  c1 = 1;
  return slab(ax, bx - ax, s.minX[i] + shrink, s.maxX[i] - shrink) && slab(ay, by - ay, s.minY[i] + shrink, s.maxY[i] - shrink) && slab(az, bz - az, s.minZ[i] + shrink, s.maxZ[i] - shrink);
}

/** The first city box the segment really crosses (past the ends' margins), into `hit`. */
function firstCrossing(s: CitySolids, ax: number, ay: number, az: number, bx: number, by: number, bz: number, skip: number): boolean {
  const L = Math.hypot(bx - ax, by - ay, bz - az);
  if (L < 2 * END_MARGIN + GRAZE) return false;
  const m = END_MARGIN / L;
  hit.box = -1;
  hit.t0 = Infinity;
  for (let i = 0; i < s.cityCount; i++) {
    if (i === skip) continue;
    if (!clip(s, i, ax, ay, az, bx, by, bz, 0)) continue;
    const t0 = Math.max(c0, m);
    const t1 = Math.min(c1, 1 - m);
    if ((t1 - t0) * L < GRAZE) continue;
    if (t0 < hit.t0) {
      hit.box = i;
      hit.t0 = t0;
      hit.t1 = t1;
    }
  }
  return hit.box >= 0;
}

/** Whether a→b stays out of box i (an edge it touches is fine). */
function clearOf(s: CitySolids, i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  if (!clip(s, i, ax, ay, az, bx, by, bz, 0.3)) return true;
  return (c1 - c0) * Math.hypot(bx - ax, by - ay, bz - az) < GRAZE;
}

/**
 * The shortest way from a to b round box i: over one of its edges (the roof's rim where the
 * straight line's footprint crosses it, or one of its four vertical corners, each nudged off
 * the box), or failing that over two of them. Into `best` (one or two points, xyz each);
 * returns how many, 0 if nothing clears it.
 */
function wrapPoint(s: CitySolids, i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const x0 = s.minX[i];
  const x1 = s.maxX[i];
  const z0 = s.minZ[i];
  const z1 = s.maxZ[i];
  const top = s.maxY[i];
  const dx = bx - ax;
  const dz = bz - az;
  let n = 0;
  // Over the top: where the footprint of a→b crosses the roof's rim.
  const rim = (u: number, isX: boolean, side: number) => {
    const d = isX ? dx : dz;
    if (Math.abs(d) < 1e-9) return;
    const t = (u - (isX ? ax : az)) / d;
    if (t <= 0 || t >= 1) return;
    const v = isX ? az + dz * t : ax + dx * t;
    if (v < (isX ? z0 : x0) || v > (isX ? z1 : x1)) return;
    cand[n * 3] = isX ? u + side * LIFT : v;
    cand[n * 3 + 1] = top + LIFT;
    cand[n * 3 + 2] = isX ? v : u + side * LIFT;
    n++;
  };
  rim(x0, true, -1);
  rim(x1, true, 1);
  rim(z0, false, -1);
  rim(z1, false, 1);
  // Round a corner: at the height the line passes it, within the wall.
  const L2 = dx * dx + dz * dz;
  for (let k = 0; k < 4; k++) {
    const ox = k & 1 ? 1 : -1;
    const oz = k & 2 ? 1 : -1;
    const cx = ox > 0 ? x1 : x0;
    const cz = oz > 0 ? z1 : z0;
    const t = L2 > 1e-9 ? Math.min(1, Math.max(0, ((cx - ax) * dx + (cz - az) * dz) / L2)) : 0;
    cand[n * 3] = cx + ox * LIFT;
    cand[n * 3 + 1] = Math.min(top - LIFT, Math.max(s.minY[i] + LIFT, ay + (by - ay) * t));
    cand[n * 3 + 2] = cz + oz * LIFT;
    n++;
  }
  let bestLen = Infinity;
  let bends = 0;
  for (let k = 0; k < n; k++) {
    const px = cand[k * 3];
    const py = cand[k * 3 + 1];
    const pz = cand[k * 3 + 2];
    if (!clearOf(s, i, ax, ay, az, px, py, pz) || !clearOf(s, i, px, py, pz, bx, by, bz)) continue;
    const len = Math.hypot(px - ax, py - ay, pz - az) + Math.hypot(bx - px, by - py, bz - pz);
    if (len < bestLen) {
      bestLen = len;
      bends = 1;
      best[0] = px;
      best[1] = py;
      best[2] = pz;
    }
  }
  if (bends) return 1;
  // Round two edges: two corners (he's swung round the building's far side), or up over one
  // rim and down the other.
  for (let k = 0; k < n; k++) {
    const px = cand[k * 3];
    const py = cand[k * 3 + 1];
    const pz = cand[k * 3 + 2];
    if (!clearOf(s, i, ax, ay, az, px, py, pz)) continue;
    const first = Math.hypot(px - ax, py - ay, pz - az);
    for (let j = 0; j < n; j++) {
      if (j === k) continue;
      const qx = cand[j * 3];
      const qy = cand[j * 3 + 1];
      const qz = cand[j * 3 + 2];
      const len = first + Math.hypot(qx - px, qy - py, qz - pz) + Math.hypot(bx - qx, by - qy, bz - qz);
      if (len >= bestLen || !clearOf(s, i, px, py, pz, qx, qy, qz) || !clearOf(s, i, qx, qy, qz, bx, by, bz)) continue;
      bestLen = len;
      bends = 2;
      best[0] = px;
      best[1] = py;
      best[2] = pz;
      best[3] = qx;
      best[4] = qy;
      best[5] = qz;
    }
  }
  return bends;
}

/**
 * Bend a taut strand (`points` holds `count` packed xyz points, the fist first and the anchor
 * last) over the edges of the buildings it would cut through, at most `maxWraps` bends (a
 * strand that would need more stays as it is past them); the points array must hold
 * `count + maxWraps` points. Returns the new count.
 */
export function wrapStrand(s: CitySolids, points: Float32Array, count: number, maxWraps = 2): number {
  let n = count;
  for (let w = 0; w < maxWraps; w++) {
    let bent = false;
    for (let k = 0; k < n - 1 && !bent; k++) {
      const a = k * 3;
      const b = (k + 1) * 3;
      if (!firstCrossing(s, points[a], points[a + 1], points[a + 2], points[b], points[b + 1], points[b + 2], -1)) continue;
      const bends = Math.min(wrapPoint(s, hit.box, points[a], points[a + 1], points[a + 2], points[b], points[b + 1], points[b + 2]), maxWraps - w);
      if (!bends) continue;
      // Insert the bends after point k.
      points.copyWithin(b + bends * 3, b, n * 3);
      for (let j = 0; j < bends * 3; j++) points[b + j] = best[j];
      n += bends;
      w += bends - 1;
      bent = true;
    }
    if (!bent) break;
  }
  return n;
}
