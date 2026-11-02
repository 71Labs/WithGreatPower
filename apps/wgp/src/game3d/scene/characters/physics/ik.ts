/**
 * Inverse kinematics for the characters.
 *
 * - `solveTwoBone`: the analytic answer for a limb (shoulder → elbow → hand, hip → knee →
 *   foot). The joint bends toward a pole direction; an out-of-reach target straightens the
 *   limb along the line to it.
 * - `fabrik`: Forward And Backward Reaching IK for a chain of any length, on packed xyz
 *   points (the same layout as `Verlet.pos`, so a Verlet chain can be solved in place).
 *   Every link keeps its length exactly; the root stays put.
 *
 * Plain math on {x, y, z} objects and Float32Arrays: no three.js, no allocation per call.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Margin kept from full extension, so the joint never pops straight. */
const REACH_EPS = 1e-3;

/**
 * Two-bone IK: from `root`, links `l1` and `l2`, put the end as close to `target` as it can
 * reach, bending toward `pole` (a direction). Writes the middle joint and the end. Returns
 * whether the target was within reach.
 */
export function solveTwoBone(root: V3, target: V3, l1: number, l2: number, pole: V3, outMid: V3, outEnd: V3): boolean {
  let dx = target.x - root.x;
  let dy = target.y - root.y;
  let dz = target.z - root.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-6) {
    dx = pole.x;
    dy = pole.y;
    dz = pole.z;
  }
  const inv = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1);
  dx *= inv;
  dy *= inv;
  dz *= inv;
  const maxReach = l1 + l2 - REACH_EPS;
  const minReach = Math.abs(l1 - l2) + REACH_EPS;
  const reach = Math.min(maxReach, Math.max(minReach, dist));
  const reachable = dist <= l1 + l2 && dist >= Math.abs(l1 - l2);
  // Law of cosines: the angle at the root between the root→end line and the first link.
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  // The bend direction: the pole with its component along the root→end line removed.
  const pd = pole.x * dx + pole.y * dy + pole.z * dz;
  let bx = pole.x - pd * dx;
  let by = pole.y - pd * dy;
  let bz = pole.z - pd * dz;
  let bl = Math.sqrt(bx * bx + by * by + bz * bz);
  if (bl < 1e-6) {
    // Pole along the line: any perpendicular will do.
    if (Math.abs(dy) < 0.9) {
      bx = -dz;
      by = 0;
      bz = dx;
    } else {
      bx = 0;
      by = dz;
      bz = -dy;
    }
    bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
  }
  bx /= bl;
  by /= bl;
  bz /= bl;
  outMid.x = root.x + dx * l1 * cosA + bx * l1 * sinA;
  outMid.y = root.y + dy * l1 * cosA + by * l1 * sinA;
  outMid.z = root.z + dz * l1 * cosA + bz * l1 * sinA;
  outEnd.x = root.x + dx * reach;
  outEnd.y = root.y + dy * reach;
  outEnd.z = root.z + dz * reach;
  return reachable;
}

/**
 * FABRIK on `count` packed points (xyz at `offset + i*3`), links `lengths[i]` between point
 * i and i+1. The root (point 0) is held at its current position; the last point reaches for
 * (tx, ty, tz). Returns the final distance from the tip to the target.
 */
export function fabrik(pts: Float32Array, count: number, lengths: ArrayLike<number>, tx: number, ty: number, tz: number, iterations = 8, tolerance = 0.01, offset = 0): number {
  const o = offset;
  const rx = pts[o];
  const ry = pts[o + 1];
  const rz = pts[o + 2];
  let total = 0;
  for (let i = 0; i < count - 1; i++) total += lengths[i];
  const toTarget = Math.hypot(tx - rx, ty - ry, tz - rz);
  if (toTarget >= total) {
    // Out of reach: lay the chain straight toward the target.
    const ux = (tx - rx) / (toTarget || 1);
    const uy = (ty - ry) / (toTarget || 1);
    const uz = (tz - rz) / (toTarget || 1);
    let acc = 0;
    for (let i = 1; i < count; i++) {
      acc += lengths[i - 1];
      pts[o + i * 3] = rx + ux * acc;
      pts[o + i * 3 + 1] = ry + uy * acc;
      pts[o + i * 3 + 2] = rz + uz * acc;
    }
    return toTarget - total;
  }
  const last = o + (count - 1) * 3;
  let err = Math.hypot(pts[last] - tx, pts[last + 1] - ty, pts[last + 2] - tz);
  for (let it = 0; it < iterations && err > tolerance; it++) {
    // Backward: tip to target, then each point toward the next at its link length.
    pts[last] = tx;
    pts[last + 1] = ty;
    pts[last + 2] = tz;
    for (let i = count - 2; i >= 0; i--) place(pts, o + i * 3, o + (i + 1) * 3, lengths[i]);
    // Forward: root back home, then each point toward the previous.
    pts[o] = rx;
    pts[o + 1] = ry;
    pts[o + 2] = rz;
    for (let i = 1; i < count; i++) place(pts, o + i * 3, o + (i - 1) * 3, lengths[i - 1]);
    err = Math.hypot(pts[last] - tx, pts[last + 1] - ty, pts[last + 2] - tz);
  }
  return err;
}

/** Move point a to sit `len` from point b, along the line b → a. */
function place(p: Float32Array, a: number, b: number, len: number) {
  const dx = p[a] - p[b];
  const dy = p[a + 1] - p[b + 1];
  const dz = p[a + 2] - p[b + 2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-6) {
    p[a + 1] = p[b + 1] - len;
    return;
  }
  const k = len / d;
  p[a] = p[b] + dx * k;
  p[a + 1] = p[b + 1] + dy * k;
  p[a + 2] = p[b + 2] + dz * k;
}
