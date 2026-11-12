import { describe, expect, it } from "vitest";

import { formatCountdown, msToUtcMidnight } from "./tomorrow";

describe("the Daily Run's reset", () => {
  it("counts down to the next midnight UTC", () => {
    expect(msToUtcMidnight(Date.UTC(2026, 10, 12, 17, 48, 0))).toBe((6 * 60 + 12) * 60_000);
    expect(msToUtcMidnight(Date.UTC(2026, 10, 12, 23, 59, 30))).toBe(30_000);
    // At midnight itself the next reset is a day away, never zero.
    expect(msToUtcMidnight(Date.UTC(2026, 10, 13, 0, 0, 0))).toBe(86_400_000);
  });

  it("says the time left in words", () => {
    expect(formatCountdown((6 * 60 + 12) * 60_000)).toBe("6 h 12 min");
    expect(formatCountdown(3 * 3_600_000)).toBe("3 h");
    expect(formatCountdown(42 * 60_000 + 59_000)).toBe("42 min");
    expect(formatCountdown(30_000)).toBe("under a minute");
    expect(formatCountdown(-5)).toBe("under a minute");
  });
});
