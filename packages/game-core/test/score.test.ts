import { describe, expect, it } from "vitest";

import { levelScale } from "../src/rules/data";
import { fightPoints, PAR_SECONDS, scoreRun } from "../src/score";

describe("score", () => {
  it("pays 1,000 × levelScale for a fight, half again for a boss, in integers", () => {
    for (let level = 1; level <= 20; level++) {
      expect(fightPoints(level, false)).toBe(Math.round(1000 * levelScale(level)));
      expect(fightPoints(level, true)).toBe(Math.round(1000 * levelScale(level) * 1.5));
      expect(Number.isInteger(fightPoints(level, true))).toBe(true);
    }
  });

  it("adds errands, capped perfect swings, the best combo, health left and time under par", () => {
    const s = scoreRun({
      fights: [
        { level: 3, boss: false, won: true },
        { level: 3, boss: true, won: true },
      ],
      errands: 2,
      perfect: 75,
      maxCombo: 9,
      hpLeft: 63,
      ticks: 150 * 60 + 59,
    });
    expect(s.fights).toBe(1240 + 1860);
    expect(s.errands).toBe(500);
    expect(s.perfect).toBe(60 * 40);
    expect(s.combo).toBe(225);
    expect(s.hp).toBe(315);
    expect(s.time).toBe((PAR_SECONDS - 150) * 10);
    expect(s.total).toBe(s.fights + s.errands + s.perfect + s.combo + s.hp + s.time);
  });

  it("pays nothing for a lost fight or time over par, and never goes negative", () => {
    const s = scoreRun({ fights: [{ level: 5, boss: true, won: false }], errands: 0, perfect: -3, maxCombo: Number.NaN, hpLeft: 0, ticks: 60 * 60 * 20 });
    expect(s).toEqual({ fights: 0, errands: 0, perfect: 0, combo: 0, hp: 0, time: 0, total: 0 });
  });
});
