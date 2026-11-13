/**
 * What /lab/determinism runs: every golden input log from @wgp/game-core, replayed here and
 * compared with the hashes Node recorded (packages/game-core/test/golden/hashes.json, the
 * same data as GOLDEN_EXPECT). The page calls `replayAll` in the browser; a test calls the
 * same function in Node, so the page's verdict line is checked without a browser.
 */
import { GOLDEN_CASES, GOLDEN_EXPECT, GOLDEN_RULESET, replayGolden } from "@wgp/game-core/golden";
import { RULESET_VERSION } from "@wgp/game-core/score";

export interface DeterminismRow {
  name: string;
  note: string;
  expected: string;
  got: string;
  checkpointsMatch: boolean;
  score: number;
  expectedScore: number;
  ticks: number;
  ms: number;
  pass: boolean;
}

export type DeterminismStatus = "running" | "pass" | "fail";

/** Replays every golden log and compares hash, checkpoints, score, ticks and outcome with the recorded ones. */
export function replayAll(): DeterminismRow[] {
  return GOLDEN_CASES.map((c) => {
    const want = GOLDEN_EXPECT[c.name];
    const t0 = performance.now();
    const res = replayGolden(c);
    const ms = performance.now() - t0;
    const checkpointsMatch = !!want && res.checkpoints.length === want.checkpoints.length && res.checkpoints.every((h, i) => h === want.checkpoints[i]);
    const pass = !!want && res.hash === want.hash && checkpointsMatch && res.score === want.score && res.ticks === want.ticks && res.ok === want.ok;
    return {
      name: c.name,
      note: c.note,
      expected: want?.hash ?? "missing",
      got: res.hash,
      checkpointsMatch,
      score: res.score,
      expectedScore: want?.score ?? 0,
      ticks: res.ticks,
      ms,
      pass,
    };
  });
}

/** Pass only when there are rows, every one matches, and the logs were recorded under this ruleset. */
export function verdictOf(rows: DeterminismRow[]): Exclude<DeterminismStatus, "running"> {
  return rows.length > 0 && rows.every((r) => r.pass) && GOLDEN_RULESET === RULESET_VERSION ? "pass" : "fail";
}

/** The page's verdict line. */
export function verdictText(status: DeterminismStatus, rows: DeterminismRow[]): string {
  if (status === "running") return "Replaying the golden logs…";
  const failed = rows.filter((r) => !r.pass).length;
  return status === "pass" ? `All ${rows.length} replays match Node` : `${failed} of ${rows.length} replays differ from Node`;
}
