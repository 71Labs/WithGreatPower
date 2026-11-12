import { describe, expect, it } from "vitest";

import { proofCounts } from "./live-proof";

const stats = (verified: number, played: number) => ({ runs: { verified }, players: { played } });

describe("the landing's proof line", () => {
  it("shows verified runs and heroes who have played", () => {
    expect(proofCounts(stats(229, 25))).toEqual({ verified: 229, heroes: 25 });
  });

  it("falls back to no numbers when the count is missing, empty or broken", () => {
    expect(proofCounts(null)).toBeNull();
    expect(proofCounts(stats(0, 0))).toBeNull();
    expect(proofCounts(stats(12, 0))).toBeNull();
    expect(proofCounts(stats(Number.NaN, 3))).toBeNull();
  });
});
