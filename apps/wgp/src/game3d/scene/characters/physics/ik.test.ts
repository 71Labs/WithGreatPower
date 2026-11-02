import { describe, expect, it } from "vitest";

import { fabrik, solveTwoBone, type V3 } from "./ik";

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("solveTwoBone", () => {
  it("reaches every reachable target with both links at length", () => {
    const root = v(0, 0, 0);
    const mid = v(0, 0, 0);
    const end = v(0, 0, 0);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 200; i++) {
      // Random targets strictly inside the reachable shell (|l1 − l2| < d < l1 + l2).
      const dir = v(rnd(), rnd(), rnd());
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
      const d = 12 + (60 - 14) * Math.abs(rnd());
      const target = v((dir.x / len) * d, (dir.y / len) * d, (dir.z / len) * d);
      const ok = solveTwoBone(root, target, 32, 28, v(0, 0, 1), mid, end);
      expect(ok).toBe(true);
      expect(dist(end, target)).toBeLessThan(1e-3);
      expect(dist(root, mid)).toBeCloseTo(32, 4);
      expect(dist(mid, end)).toBeCloseTo(28, 4);
    }
  });

  it("bends toward the pole", () => {
    const mid = v(0, 0, 0);
    const end = v(0, 0, 0);
    solveTwoBone(v(0, 0, 0), v(0, -40, 0), 30, 30, v(0, 0, 1), mid, end);
    expect(mid.z).toBeGreaterThan(10);
    solveTwoBone(v(0, 0, 0), v(0, -40, 0), 30, 30, v(0, 0, -1), mid, end);
    expect(mid.z).toBeLessThan(-10);
  });

  it("straightens toward an out-of-reach target", () => {
    const mid = v(0, 0, 0);
    const end = v(0, 0, 0);
    const ok = solveTwoBone(v(0, 0, 0), v(200, 0, 0), 30, 30, v(0, 1, 0), mid, end);
    expect(ok).toBe(false);
    expect(end.x).toBeCloseTo(60, 2);
    expect(Math.abs(end.y)).toBeLessThan(1e-6);
    expect(dist(v(0, 0, 0), mid)).toBeCloseTo(30, 4);
  });
});

describe("fabrik", () => {
  const chain = (n: number, link: number) => {
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pts[i * 3 + 1] = -i * link;
    return pts;
  };
  const lengths = (pts: Float32Array, n: number) =>
    Array.from({ length: n - 1 }, (_, i) => Math.hypot(pts[(i + 1) * 3] - pts[i * 3], pts[(i + 1) * 3 + 1] - pts[i * 3 + 1], pts[(i + 1) * 3 + 2] - pts[i * 3 + 2]));

  it("reaches a reachable target and preserves every link length", () => {
    const n = 12;
    const pts = chain(n, 10);
    const ls = new Array(n - 1).fill(10);
    const err = fabrik(pts, n, ls, 40, -50, 30, 30, 0.01);
    expect(err).toBeLessThan(0.05);
    for (const l of lengths(pts, n)) expect(l).toBeCloseTo(10, 3);
    expect(pts[0]).toBeCloseTo(0, 9);
    expect(pts[1]).toBeCloseTo(0, 9);
  });

  it("lays the chain straight toward an out-of-reach target", () => {
    const n = 6;
    const pts = chain(n, 10);
    fabrik(pts, n, [10, 10, 10, 10, 10], 500, 0, 0);
    for (let i = 0; i < n; i++) {
      expect(pts[i * 3]).toBeCloseTo(i * 10, 4);
      expect(pts[i * 3 + 1]).toBeCloseTo(0, 4);
    }
  });
});
