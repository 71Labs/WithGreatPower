import { describe, expect, it } from "vitest";

import { SUITS } from "@wgp/game-core/data";

import { suitTrim, webLine } from "./hero-model";

describe("the hero's suit colours", () => {
  it("gives only a near-white suit (Snow) a suit's cues, and leaves every other suit as it was", () => {
    for (const suit of Object.values(SUITS)) {
      const t = suitTrim(suit.colors.suit);
      if (suit.id === "snow") expect(t).toBe(1);
      else expect(t, suit.id).toBe(0);
    }
  });

  it("draws a pale suit's web in a deeper shade of its own colour", () => {
    const line = webLine(SUITS.snow.colors.web);
    // #B6A2EC, deeper: the same hue, far darker than the near-white suit (#F4F4F2).
    expect(line.x).toBeLessThan(0.45);
    expect(line.z).toBeGreaterThan(line.x);
    expect(line.z).toBeGreaterThan(line.y);
  });
});
