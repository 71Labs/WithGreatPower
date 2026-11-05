import { COURSES } from "@wgp/game-core/compete";
import { describe, expect, it } from "vitest";

import { dayLabel, kitLine, nextMedal, spokenGap, untilLabel } from "./format";
import { raceShareText, racePath } from "./share";

describe("compete words", () => {
  it("names the next medal to chase, and none past the dev time", () => {
    const m = COURSES["rooftop-sprint"].medals;
    expect(nextMedal("rooftop-sprint", null)).toEqual({ medal: "bronze", ticks: m.bronze });
    expect(nextMedal("rooftop-sprint", m.bronze)).toEqual({ medal: "silver", ticks: m.silver });
    expect(nextMedal("rooftop-sprint", m.gold)).toEqual({ medal: "dev", ticks: m.dev });
    expect(nextMedal("rooftop-sprint", m.dev)).toBeNull();
  });

  it("says the kit, the countdown, the day and a gap", () => {
    expect(kitLine(["web-sling", "yank", "node-sense", "web-bomb"])).toBe("Web-sling, Yank, Node sense and Web bomb");
    expect(untilLabel(Date.UTC(2026, 10, 6), Date.UTC(2026, 10, 5, 16, 52))).toBe("7 h 08 m");
    expect(untilLabel(1000, 0)).toBe("under a minute");
    expect(dayLabel("2026-11-05")).toBe("Nov 5");
    expect(spokenGap(144, "#1")).toBe("2.4 seconds behind #1");
    expect(spokenGap(-48, "#1")).toBe("0.8 seconds ahead of #1");
    expect(spokenGap(0, "you")).toBe("level with you");
  });

  it("writes a share post with a challenge link, and no promises", () => {
    const text = raceShareText({ kind: "trial", course: "bridge-run", ticks: 403, score: 0, medal: "gold", runId: "abc", ghost: { handle: "ace", won: true } });
    expect(text).toContain("Bridge run in 0:06.7 (Gold) and beat ace’s ghost");
    expect(text).toContain(racePath("abc"));
    expect(text).not.toMatch(/\$|prize|win money|reward/i);
    expect(raceShareText({ kind: "daily", course: "2026-11-05", ticks: 7200, score: 9120, medal: null, runId: "x" })).toContain("today’s Daily Run in 2:00.0 for 9,120");
  });
});
