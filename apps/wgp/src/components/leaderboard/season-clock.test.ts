import { describe, expect, it } from "vitest";

import { clockSkew, formatLeft, phaseAt } from "./season-clock";

const S1 = { phase: "live" as const, startsAt: "2026-11-05T00:00:00.000Z", endsAt: "2026-11-15T00:00:00.000Z" };

describe("the season countdown", () => {
  it("counts down in days and hh:mm:ss, never below zero", () => {
    expect(formatLeft(((2 * 24 + 3) * 3600 + 14 * 60 + 9) * 1000)).toBe("2d 03:14:09");
    expect(formatLeft((3 * 3600 + 5) * 1000 + 999)).toBe("03:00:05");
    expect(formatLeft(86_400_000)).toBe("1d 00:00:00");
    expect(formatLeft(-5000)).toBe("00:00:00");
  });

  it("moves to the next phase as time passes, and stays final once closed", () => {
    expect(phaseAt(S1, Date.parse("2026-11-04T12:00:00Z"))).toBe("upcoming");
    expect(phaseAt(S1, Date.parse("2026-11-14T23:59:59Z"))).toBe("live");
    expect(phaseAt(S1, Date.parse("2026-11-15T00:00:00Z"))).toBe("closing");
    expect(phaseAt({ ...S1, phase: "final" }, Date.parse("2026-11-01T00:00:00Z"))).toBe("final");
  });

  it("follows the server's clock, but not a nonsense one", () => {
    expect(clockSkew("2026-11-10T00:00:05.000Z", Date.parse("2026-11-10T00:00:00Z"))).toBe(5000);
    expect(clockSkew("not a date", 0)).toBe(0);
    expect(clockSkew("2026-11-10T00:00:00.000Z", Date.parse("2020-01-01T00:00:00Z"))).toBe(0);
  });
});
