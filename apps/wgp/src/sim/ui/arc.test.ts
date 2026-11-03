import { describe, expect, it } from "vitest";

import { STICK_ZONE } from "@/game3d/input/bindings";

import { ARC_BUTTON, ARC_CORNER, ARC_GAP, ARC_MIN_RADIUS, arcLayout, arcRadius, type ArcSpot } from "./arc";

/** A button's centre, as (x left from the corner, y up from the corner). */
const centre = (s: ArcSpot) => ({ x: s.right + ARC_BUTTON / 2, y: s.bottom + ARC_BUTTON / 2 });
const gap = (a: ArcSpot, b: ArcSpot) => {
  const p = centre(a);
  const q = centre(b);
  return Math.hypot(p.x - q.x, p.y - q.y) - ARC_BUTTON;
};

describe("the touch power arc", () => {
  it("keeps neighbours apart and the pad clear, for one to four powers", () => {
    for (let n = 1; n <= 4; n++) {
      const { powers, radius } = arcLayout(n, false);
      expect(powers).toHaveLength(n);
      expect(radius).toBeGreaterThanOrEqual(ARC_MIN_RADIUS);
      for (let i = 1; i < n; i++) expect(gap(powers[i - 1], powers[i])).toBeGreaterThanOrEqual(ARC_GAP - 0.02);
      for (const p of powers) {
        const c = centre(p);
        expect(Math.hypot(c.x - ARC_CORNER, c.y - ARC_CORNER)).toBeCloseTo(radius, 1);
        // Never off the screen's edge.
        expect(p.right).toBeGreaterThanOrEqual(0);
        expect(p.bottom).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("stays out of the stick's side on a 360px phone, Gwei or not", () => {
    for (const gwei of [false, true]) {
      const { width, powers } = arcLayout(4, gwei);
      expect(360 - width).toBeGreaterThanOrEqual(360 * STICK_ZONE);
      for (const p of powers) expect(p.right + ARC_BUTTON).toBeLessThanOrEqual(width);
    }
  });

  it("stacks Gwei above the top power at the edge instead of widening the arc", () => {
    const plain = arcLayout(4, false);
    const fight = arcLayout(4, true);
    expect(fight.radius).toBe(plain.radius);
    expect(fight.width).toBe(plain.width);
    expect(fight.powers).toEqual(plain.powers);
    const top = plain.powers.at(-1)!;
    expect(fight.gwei!.right).toBe(top.right);
    expect(fight.gwei!.bottom).toBeGreaterThanOrEqual(top.bottom + ARC_BUTTON + ARC_GAP);
    expect(fight.height).toBe(Math.ceil(fight.gwei!.bottom + ARC_BUTTON));
    for (const p of fight.powers) expect(gap(p, fight.gwei!)).toBeGreaterThanOrEqual(ARC_GAP);
  });

  it("is tighter than a five-button quarter circle", () => {
    // Four powers plus Gwei on one arc needed a 159px radius, reaching into the middle of a phone.
    expect(arcRadius(5)).toBeGreaterThan(150);
    expect(arcLayout(4, true).radius).toBeLessThan(125);
  });
});
