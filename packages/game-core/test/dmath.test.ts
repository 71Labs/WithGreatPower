import { describe, expect, it } from "vitest";

import { datan2, dcos, DIR64, dirIndex, dsin, len2, len3, quantizeStick, wrapAngle } from "../src/sim3d/dmath";

describe("dmath", () => {
  it("dsin and dcos match the platform within 1e-13 over ±200 radians", () => {
    let worst = 0;
    for (let i = -20000; i <= 20000; i++) {
      const x = i * 0.01 + 0.0037;
      worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(1e-13);
  });

  it("dsin and dcos are exact at the landmarks", () => {
    expect(dsin(0)).toBe(0);
    expect(dcos(0)).toBe(1);
    expect(Math.abs(dsin(Math.PI / 2) - 1)).toBeLessThan(1e-15);
    expect(Math.abs(dcos(Math.PI))).toBeCloseTo(1, 15);
  });

  it("datan2 matches the platform within 1e-12 in every quadrant", () => {
    let worst = 0;
    for (let i = 0; i < 4000; i++) {
      const a = (i / 4000) * 2 * Math.PI - Math.PI + 0.0001;
      for (const r of [0.001, 1, 750, 1e6]) {
        const y = Math.sin(a) * r;
        const x = Math.cos(a) * r;
        worst = Math.max(worst, Math.abs(datan2(y, x) - Math.atan2(y, x)));
      }
    }
    expect(worst).toBeLessThan(1e-12);
    expect(datan2(0, 0)).toBe(0);
    expect(datan2(1, 0)).toBeCloseTo(Math.PI / 2, 15);
    expect(datan2(-1, 0)).toBeCloseTo(-Math.PI / 2, 15);
    expect(datan2(0, -1)).toBeCloseTo(Math.PI, 15);
  });

  it("wrapAngle lands in [−π, π]", () => {
    for (const x of [-100, -7, -3.2, 0, 3.2, 7, 100]) {
      const w = wrapAngle(x);
      expect(w).toBeGreaterThanOrEqual(-Math.PI - 1e-12);
      expect(w).toBeLessThanOrEqual(Math.PI + 1e-12);
      expect(Math.abs(Math.sin(w) - Math.sin(x))).toBeLessThan(1e-12);
    }
  });

  it("DIR64 is 64 literal unit vectors, 5.625° apart, with exact symmetry", () => {
    expect(DIR64).toHaveLength(64);
    DIR64.forEach(([x, z], i) => {
      expect(Math.abs(len2(x, z) - 1)).toBeLessThan(1e-15);
      const a = (i * 2 * Math.PI) / 64;
      expect(Math.abs(x - Math.cos(a))).toBeLessThan(1e-15);
      expect(Math.abs(z - Math.sin(a))).toBeLessThan(1e-15);
      // Opposite headings negate exactly; a quarter turn swaps exactly.
      const [ox, oz] = DIR64[(i + 32) % 64];
      expect(ox).toBe(-x || 0);
      expect(oz).toBe(-z || 0);
      const [qx, qz] = DIR64[(i + 16) % 64];
      expect(qx).toBe(-z || 0);
      expect(qz).toBe(x);
    });
  });

  it("dirIndex inverts DIR64 and quantizeStick stays canonical", () => {
    DIR64.forEach(([x, z], i) => expect(dirIndex(x * 3, z * 3)).toBe(i));
    expect(quantizeStick(0, 0)).toEqual({ dir: 0, mag: 0 });
    expect(quantizeStick(0.1, -0.05)).toEqual({ dir: 0, mag: 0 });
    expect(quantizeStick(0, 1)).toEqual({ dir: 16, mag: 3 });
    expect(quantizeStick(-0.5, 0)).toEqual({ dir: 32, mag: 2 });
    expect(quantizeStick(0, -0.3)).toEqual({ dir: 48, mag: 1 });
    expect(quantizeStick(Number.NaN, 1)).toEqual({ dir: 0, mag: 0 });
  });

  it("len3 is the Euclidean length", () => {
    expect(len3(2, 3, 6)).toBe(7);
  });
});
