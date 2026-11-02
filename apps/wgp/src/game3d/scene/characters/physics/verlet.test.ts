import { describe, expect, it } from "vitest";

import { fabrik } from "./ik";
import { Verlet } from "./verlet";

/** A horizontal chain of n particles, root pinned, links of `link` units. */
function chain(n: number, link: number) {
  const v = new Verlet(n, { gravity: 1750, damping: 0.02, iterations: 12 });
  for (let i = 0; i < n; i++) v.place(i, i * link, 0, 0);
  for (let i = 0; i < n - 1; i++) v.link(i, i + 1);
  v.pin(0);
  return v;
}

describe("Verlet", () => {
  it("preserves chain length while it falls and swings under gravity", () => {
    const n = 16;
    const v = chain(n, 10);
    for (let s = 0; s < 600; s++) {
      v.step(1 / 120);
      let total = 0;
      for (let i = 0; i < n - 1; i++) total += v.distance(i, i + 1);
      // Within 2% of the rest length at every step.
      expect(total).toBeGreaterThan(150 * 0.98);
      expect(total).toBeLessThan(150 * 1.02);
    }
    // After five seconds of damping it hangs (nearly) straight down from the pin.
    const tip = v.pos[(n - 1) * 3 + 1];
    expect(tip).toBeLessThan(-140);
    expect(v.pos[0]).toBe(0);
  });

  it("keeps particles above the floor", () => {
    const v = new Verlet(1, { gravity: 1750 });
    v.place(0, 0, 50, 0);
    v.floor = () => 10;
    for (let s = 0; s < 240; s++) v.step(1 / 120);
    expect(v.pos[1]).toBeCloseTo(10, 4);
  });

  it("lets FABRIK drive a sagging chain's tip with exact link lengths", () => {
    const n = 10;
    const v = chain(n, 12);
    const lengths = new Array(n - 1).fill(12 * 0.9);
    for (let s = 0; s < 240; s++) {
      v.integrate(1 / 120);
      fabrik(v.pos, n, lengths, 70, -20, 10, 6, 0.01);
    }
    const tip = (n - 1) * 3;
    expect(Math.hypot(v.pos[tip] - 70, v.pos[tip + 1] + 20, v.pos[tip + 2] - 10)).toBeLessThan(0.1);
    for (let i = 0; i < n - 1; i++) expect(v.distance(i, i + 1)).toBeCloseTo(12 * 0.9, 3);
    // The slack makes the middle sag below the straight line from the root to the tip.
    const mid = Math.floor(n / 2) * 3;
    const lineY = (-20 * Math.floor(n / 2)) / (n - 1);
    expect(v.pos[mid + 1]).toBeLessThan(lineY);
  });
});
