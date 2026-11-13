/**
 * "8 ways to play; all are built", checked against the code and not against the README's own
 * table. Each way is tied to what makes it exist: the run modes the server counts
 * (`STAT_MODES`), the page that plays it and the API route behind it. The README's table must
 * then name exactly these ways, so adding a row without the code, or a run mode without a
 * row, fails here.
 */
import { describe, expect, it } from "vitest";

import { CHAPTER_IDS } from "@wgp/game-core/chapters";
import { TASK_IDS } from "@wgp/game-core/city";
import { DAILY_MODE, DUEL_COURSE, TRIAL_COURSE_IDS, TRIAL_MODE } from "@wgp/game-core/compete";

import { competeKind } from "@/server/db/compete";
import { REFERRAL_GOAL } from "@/server/db/referrals";
import { STAT_MODES } from "@/server/db/stats";

import { exists, plainDoc, read, tableAfter } from "./repo";

interface Way {
  /** The README row's name. */
  row: string;
  /** The run modes it is counted under in /api/stats; empty for a way that isn't a verified run of its own. */
  modes: readonly string[];
  /** The page that plays it and the route the page talks to, under apps/wgp/src/app. */
  page: string;
  api: string;
}

const WAYS: Way[] = [
  { row: "Ranked nights", modes: ["patrol"], page: "play/patrol/page.tsx", api: "api/runs/start/route.ts" },
  { row: "Daily Run", modes: [DAILY_MODE], page: "play/compete/page.tsx", api: "api/compete/route.ts" },
  { row: "Time trials", modes: [TRIAL_MODE], page: "play/compete/page.tsx", api: "api/compete/route.ts" },
  { row: "Duels", modes: [DUEL_COURSE], page: "play/compete/page.tsx", api: "api/compete/race/[runId]/route.ts" },
  { row: "Case files", modes: CHAPTER_IDS, page: "play/cases/page.tsx", api: "api/cases/route.ts" },
  { row: "The City", modes: [], page: "play/city/page.tsx", api: "api/city/outing/route.ts" },
  { row: `Invite ${REFERRAL_GOAL} friends`, modes: [], page: "play/invite/page.tsx", api: "api/referrals/route.ts" },
  { row: "Season 1", modes: [], page: "play/leaderboard/page.tsx", api: "api/seasons/[id]/results/route.ts" },
];

describe("the ways to play are the ones the code has", () => {
  it("every run mode the server counts belongs to exactly one way, and no way claims a mode the server doesn't have", () => {
    expect(WAYS.flatMap((w) => w.modes)).toEqual([...STAT_MODES]);
    // The compete modes are told apart by the server itself, a duel being a trial on the course "duel".
    expect(competeKind({ mode: DAILY_MODE, course: null })).toBe("daily");
    expect(competeKind({ mode: TRIAL_MODE, course: TRIAL_COURSE_IDS[0]! })).toBe("trial");
    expect(competeKind({ mode: TRIAL_MODE, course: DUEL_COURSE })).toBe("duel");
    expect(competeKind({ mode: "patrol", course: null })).toBeNull();
    // The ways that aren't run modes have content of their own.
    expect(TASK_IDS.length).toBeGreaterThan(0);
    expect(CHAPTER_IDS.length).toBeGreaterThan(0);
    expect(REFERRAL_GOAL).toBeGreaterThan(0);
  });

  it("every way has its page and its API route in the app: all are built", () => {
    for (const w of WAYS) {
      expect(exists(`apps/wgp/src/app/${w.page}`), `${w.row}: no page ${w.page}`).toBe(true);
      expect(exists(`apps/wgp/src/app/${w.api}`), `${w.row}: no route ${w.api}`).toBe(true);
    }
    // Season 1 is a season the migrations create, not only a board.
    expect(read("apps/wgp/src/server/db/schema.ts")).toContain('export const seasons = pgTable("seasons"');
  });

  it("the README's table names exactly these ways, and its count is theirs", () => {
    const rows = tableAfter(read("README.md"), "## Ways to play").map((cells) => cells[0]!.replace(/[*`]/g, "").replace(/\s*\(.*$/, ""));
    expect(rows).toEqual(WAYS.map((w) => w.row));
    expect(plainDoc("README.md")).toContain(`${WAYS.length} ways to play; all are built.`);
  });
});
