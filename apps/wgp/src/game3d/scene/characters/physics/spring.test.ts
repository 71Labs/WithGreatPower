import { describe, expect, it } from "vitest";

import { Spring, Spring3 } from "./spring";
import { FixedStepper } from "./stepper";

describe("Spring", () => {
  it("settles on the target without overshoot when critically damped", () => {
    const s = new Spring(12, 1, 0);
    let last = 0;
    let max = 0;
    for (let i = 0; i < 240; i++) {
      const v = s.step(100, 1 / 120);
      // Monotonic approach from below, never past the target.
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      max = Math.max(max, v);
      last = v;
    }
    expect(max).toBeLessThanOrEqual(100 + 1e-9);
    expect(s.value).toBeCloseTo(100, 3);
    expect(Math.abs(s.velocity)).toBeLessThan(1e-3);
  });

  it("does not overshoot even with an initial velocity away from the target", () => {
    const s = new Spring(10, 1, 0);
    s.velocity = -300;
    let crossed = 0;
    let prevSign = Math.sign(s.value - 50);
    for (let i = 0; i < 600; i++) {
      s.step(50, 1 / 120);
      const sign = Math.sign(s.value - 50);
      if (sign !== 0 && sign !== prevSign) crossed++;
      if (sign !== 0) prevSign = sign;
    }
    // A critically damped spring crosses its target at most once.
    expect(crossed).toBeLessThanOrEqual(1);
    expect(s.value).toBeCloseTo(50, 3);
  });

  it("overshoots and rings when under-damped", () => {
    const s = new Spring(12, 0.3, 0);
    let max = 0;
    for (let i = 0; i < 240; i++) max = Math.max(max, s.step(100, 1 / 120));
    expect(max).toBeGreaterThan(110);
  });

  it("is frame-rate independent (exact steps)", () => {
    const a = new Spring(9, 0.7, 0);
    const b = new Spring(9, 0.7, 0);
    for (let i = 0; i < 30; i++) a.step(40, 1 / 30);
    for (let i = 0; i < 240; i++) b.step(40, 1 / 240);
    expect(a.value).toBeCloseTo(b.value, 6);
    expect(a.velocity).toBeCloseTo(b.velocity, 4);
  });

  it("sags by a/ω² under a constant acceleration", () => {
    const s = new Spring3(10, 1);
    for (let i = 0; i < 600; i++) s.step(0, 0, 0, 1 / 120, 0, -1750, 0);
    expect(s.y).toBeCloseTo(-1750 / 100, 2);
  });
});

describe("FixedStepper", () => {
  it("runs whole sub-steps and reports the remainder as alpha", () => {
    const st = new FixedStepper(120);
    let n = 0;
    st.advance(1 / 60, () => n++);
    expect(n).toBe(2);
    st.advance(0.004, () => n++);
    expect(n).toBe(2);
    expect(st.alpha).toBeCloseTo(0.004 * 120, 5);
  });

  it("caps the work a long frame can do", () => {
    const st = new FixedStepper(120, 6);
    let n = 0;
    st.advance(2, () => n++);
    expect(n).toBe(6);
    expect(st.alpha).toBeLessThan(1);
  });
});
