import { describe, expect, it } from "vitest";

import { MAX_NIGHT_BITS, MAX_PICKUP_BITS, NIGHT_TAPER, nightBits, nightPay, taperedNightBits } from "./rewards";

describe("taperedNightBits", () => {
  const night = { score: 8_000, levelledUp: false }; // 85 Bits untapered
  const taper = { fullBelow: 250, floorAt: 500 };

  it("pays the whole night up to the lower mark and the 5 for showing up from the upper", () => {
    expect(taperedNightBits(night, 0, taper)).toBe(85);
    expect(taperedNightBits(night, 250, taper)).toBe(85);
    expect(taperedNightBits(night, 500, taper)).toBe(5);
    expect(taperedNightBits(night, 90_000, taper)).toBe(5);
  });

  it("falls in a straight line between the marks and never pays more than the night earned", () => {
    expect(taperedNightBits(night, 375, taper)).toBe(45);
    let last = 85;
    for (let held = 0; held <= 600; held += 7) {
      const bits = taperedNightBits(night, held, taper);
      expect(bits).toBeLessThanOrEqual(last);
      expect(bits).toBeGreaterThanOrEqual(5);
      last = bits;
    }
  });

  it("ignores a nonsense balance or taper", () => {
    expect(taperedNightBits(night, Number.NaN, taper)).toBe(85);
    expect(taperedNightBits(night, -10, taper)).toBe(85);
    expect(taperedNightBits(night, 9_999, { fullBelow: 400, floorAt: 400 })).toBe(85);
  });
});

describe("nightPay: what the server pays a verified night", () => {
  const night = { score: 8_000, levelledUp: false }; // 85 Bits untapered

  it("is the live taper: the whole night up to 150 Bits held, the 5 for showing up from 400", () => {
    expect(NIGHT_TAPER).toEqual({ fullBelow: 150, floorAt: 400 });
    expect(nightPay(night, 0)).toEqual({ bits: 85, full: 85, held: 0 });
    expect(nightPay(night, 150)).toEqual({ bits: 85, full: 85, held: 150 });
    expect(nightPay(night, 275)).toEqual({ bits: 45, full: 85, held: 275 });
    expect(nightPay(night, 400)).toEqual({ bits: 5, full: 85, held: 400 });
    expect(nightPay(night, 5_000)).toEqual({ bits: 5, full: 85, held: 5_000 });
  });

  it("pays the whole night when the balance couldn't be read", () => {
    expect(nightPay(night, null)).toEqual({ bits: 85, full: 85, held: null });
    expect(nightPay(night, Number.NaN)).toEqual({ bits: 85, full: 85, held: null });
  });

  it("lets a crafter save up to a suit's price: above 250 Bits held a night still pays more than showing up", () => {
    const suit = 250;
    expect(NIGHT_TAPER.floorAt).toBeGreaterThan(suit);
    expect(nightPay(night, suit).bits).toBeGreaterThan(5);
  });
});

describe("nightBits", () => {
  it("pays a Bit per 100 points, 5 for showing up and 25 for a level-up", () => {
    expect(nightBits({ score: 0, levelledUp: false })).toBe(5);
    expect(nightBits({ score: 4_299, levelledUp: false })).toBe(47);
    expect(nightBits({ score: 4_299, levelledUp: true })).toBe(72);
  });

  it("adds a Bit for each Bits token collected, up to a cap (ruleset 3)", () => {
    expect(nightBits({ score: 4_299, levelledUp: false, pickups: 12 })).toBe(47 + 12);
    expect(nightBits({ score: 4_299, levelledUp: false, pickups: 500 })).toBe(47 + MAX_PICKUP_BITS);
    expect(nightBits({ score: 4_299, levelledUp: false, pickups: -4 })).toBe(47);
    expect(nightBits({ score: 4_299, levelledUp: false, pickups: Number.NaN })).toBe(47);
  });

  it("stays within what one reward may mint and ignores nonsense", () => {
    expect(nightBits({ score: 10_000_000, levelledUp: true })).toBe(MAX_NIGHT_BITS);
    expect(nightBits({ score: Number.NaN, levelledUp: false })).toBe(5);
    expect(nightBits({ score: -50, levelledUp: false })).toBe(5);
  });
});
