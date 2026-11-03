import { describe, expect, it } from "vitest";

import { MAX_NIGHT_BITS, nightBits } from "./rewards";

describe("nightBits", () => {
  it("pays a Bit per 100 points, 5 for showing up and 25 for a level-up", () => {
    expect(nightBits({ score: 0, levelledUp: false })).toBe(5);
    expect(nightBits({ score: 4_299, levelledUp: false })).toBe(47);
    expect(nightBits({ score: 4_299, levelledUp: true })).toBe(72);
  });

  it("stays within what one reward may mint and ignores nonsense", () => {
    expect(nightBits({ score: 10_000_000, levelledUp: true })).toBe(MAX_NIGHT_BITS);
    expect(nightBits({ score: Number.NaN, levelledUp: false })).toBe(5);
    expect(nightBits({ score: -50, levelledUp: false })).toBe(5);
  });
});
