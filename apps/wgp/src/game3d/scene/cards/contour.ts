/**
 * A sticker's die-cut outline from its silhouette mask: marching squares walks the outer
 * boundary of the first solid blob, Ramer–Douglas–Peucker drops the staircase, and one pass
 * of Chaikin rounds what is left. Pure, so it can be tested without a canvas.
 */

export type Pt = [number, number];

const UP = 0;
const RIGHT = 1;
const DOWN = 2;
const LEFT = 3;
const NONE = 4;
const DX = [0, 1, 0, -1, 0];
const DY = [-1, 0, 1, 0, 0];

/** The outer boundary of the first solid blob (raster order), as pixel-corner points. */
export function traceContour(mask: Uint8Array, w: number, h: number): Pt[] {
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] > 0;
  let sx = -1;
  let sy = -1;
  for (let i = 0; i < w * h && sx < 0; i++) {
    if (mask[i] > 0) {
      sx = i % w;
      sy = Math.floor(i / w);
    }
  }
  if (sx < 0) return [];
  const out: Pt[] = [];
  let x = sx;
  let y = sy;
  let prev = NONE;
  const limit = (w + 1) * (h + 1) * 4;
  for (let guard = 0; guard < limit; guard++) {
    const state = (solid(x - 1, y - 1) ? 1 : 0) | (solid(x, y - 1) ? 2 : 0) | (solid(x - 1, y) ? 4 : 0) | (solid(x, y) ? 8 : 0);
    let next = NONE;
    switch (state) {
      case 1:
      case 5:
      case 13:
        next = UP;
        break;
      case 2:
      case 3:
      case 7:
        next = RIGHT;
        break;
      case 4:
      case 12:
      case 14:
        next = LEFT;
        break;
      case 8:
      case 10:
      case 11:
        next = DOWN;
        break;
      case 6:
        next = prev === UP ? LEFT : RIGHT;
        break;
      case 9:
        next = prev === RIGHT ? UP : DOWN;
        break;
    }
    if (next === NONE) break;
    if (next !== prev) out.push([x, y]);
    x += DX[next];
    y += DY[next];
    prev = next;
    if (x === sx && y === sy) break;
  }
  return out;
}

function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** Ramer–Douglas–Peucker on an open polyline. */
export function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let bestD = epsilon;
    for (let i = a + 1; i < b; i++) {
      const d = perpDistance(points[i], points[a], points[b]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify a closed ring: split at the point farthest from the first, simplify both halves. */
export function simplifyClosed(ring: Pt[], epsilon: number): Pt[] {
  if (ring.length < 4) return ring.slice();
  let far = 0;
  let farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplify(ring.slice(0, far + 1), epsilon);
  const b = simplify([...ring.slice(far), ring[0]], epsilon);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** One pass of Chaikin corner cutting on a closed ring. */
export function chaikin(ring: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
  }
  return out;
}

/** Signed area (positive = counter-clockwise in y-up coordinates). */
export function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** The die-cut outline for a mask: traced, simplified and rounded. */
export function stickerOutline(mask: Uint8Array, w: number, h: number, epsilon = 0.7): Pt[] {
  const raw = traceContour(mask, w, h);
  if (raw.length < 3) return [];
  return chaikin(simplifyClosed(raw, epsilon));
}
