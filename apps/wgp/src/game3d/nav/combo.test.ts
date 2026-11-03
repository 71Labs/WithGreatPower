import { describe, expect, it } from "vitest";

import { ComboClock, MeterPacer, multiplierText } from "./combo";

describe("the combo meter", () => {
  it("drains over the ruleset's window and refills on a feed", () => {
    const clock = new ComboClock(180);
    expect(clock.share(0, 0)).toBe(0);
    expect(clock.share(1, 180)).toBe(1);
    expect(clock.share(1, 90)).toBe(0.5);
    expect(clock.share(2, 180)).toBe(1);
  });

  it("writes a draining bar at most ten times a second, not every frame", () => {
    const pacer = new MeterPacer(10);
    let writes = 0;
    // Six seconds of a 60 fps drain from full to empty.
    for (let f = 0; f <= 360; f++) if (pacer.next(1 - f / 360, f / 60) !== null) writes += 1;
    expect(writes).toBeGreaterThan(50);
    expect(writes).toBeLessThanOrEqual(61);
  });

  it("writes a refill or the combo ending at once", () => {
    const pacer = new MeterPacer(10);
    expect(pacer.next(0.5, 0)).toBe(0.5);
    // A frame later: a small drain waits, a refill doesn't.
    expect(pacer.next(0.49, 1 / 60)).toBeNull();
    expect(pacer.next(1, 2 / 60)).toBe(1);
    expect(pacer.next(0, 3 / 60)).toBe(0);
    // Nothing changed: nothing to write, however long it's been.
    expect(pacer.next(0, 10)).toBeNull();
    pacer.reset();
    expect(pacer.next(0, 10.01)).toBe(0);
  });

  it("names the multiplier", () => {
    expect(multiplierText(2)).toBe("×2");
    expect(multiplierText(1.5)).toBe("×1.5");
  });
});
