/**
 * /lab/determinism, without a browser: the page is client-rendered, so a request for it only
 * shows that it is served. This runs the function the page runs (`replayAll`) and asserts
 * what the page would print, "All 4 replays match Node", against the hashes Node recorded
 * on disk. Whether a given browser agrees is what opening the page shows.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { GOLDEN_CASES } from "@wgp/game-core/golden";
import { RULESET_VERSION } from "@wgp/game-core/score";

import { replayAll, verdictOf, verdictText } from "./determinism";

interface Recorded {
  ruleset: number;
  cases: Record<string, { ok: boolean; hash: string; checkpoints: string[]; score: number; ticks: number }>;
}
/** The hashes Node recorded when the golden logs were made (packages/game-core/test/golden/hashes.json). */
const recorded = JSON.parse(readFileSync(new URL("../../../../../packages/game-core/test/golden/hashes.json", import.meta.url), "utf8")) as Recorded;

describe("the determinism lab's replays", () => {
  const rows = replayAll();

  it("replays the page's four recorded nights to the hashes Node recorded, and the page's verdict is All 4 replays match Node", () => {
    expect(rows.map((r) => r.name)).toEqual(GOLDEN_CASES.map((c) => c.name));
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      const want = recorded.cases[r.name]!;
      expect(want, `${r.name} has no recorded hash`).toBeDefined();
      // The hash this run computed is the one in the file Node wrote, not only the copy the page imports.
      expect(r.got, r.name).toBe(want.hash);
      expect(r.expected, r.name).toBe(want.hash);
      expect(r.score, r.name).toBe(want.score);
      expect(r.ticks, r.name).toBe(want.ticks);
      expect(r.checkpointsMatch, r.name).toBe(true);
      expect(r.pass, r.name).toBe(true);
    }
    expect(recorded.ruleset).toBe(RULESET_VERSION);
    expect(verdictOf(rows)).toBe("pass");
    expect(verdictText(verdictOf(rows), rows)).toBe("All 4 replays match Node");
  });

  it("would say so if a replay differed: one wrong hash fails the page", () => {
    const broken = rows.map((r, i) => (i === 1 ? { ...r, got: "00000000", pass: false } : r));
    expect(verdictOf(broken)).toBe("fail");
    expect(verdictText("fail", broken)).toBe("1 of 4 replays differ from Node");
    expect(verdictOf([])).toBe("fail");
    expect(verdictText("running", [])).toBe("Replaying the golden logs…");
  });
});
