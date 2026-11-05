/**
 * The time trials' golden replays (src/golden-trial.ts): per course, test/golden/trial-<id>.bin
 * must replay, as that course's trial, to test/golden/trial-<id>.json, and its finish is the
 * course's dev time (rules/compete.ts DEV_TICKS). The patrol and chapter goldens are untouched.
 *
 * Regenerating (after an intended change to the trials; bump TRIAL_RULESET with it):
 *
 *   UPDATE_TRIAL_GOLDEN=1 pnpm --filter @wgp/game-core test trial-golden
 *
 * races each course with the trial bot in a grid of styles (as a designer practises a line),
 * keeps the fastest finish, and rewrites the logs, the JSON, src/golden-trial.ts's data block
 * and the MEDAL_TICKS block in src/rules/compete.ts: dev is the fastest practice run, gold the
 * 10th percentile, silver the 25th and bronze the median (rounded up to a tenth of a second).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { replayTrialGolden, TRIAL_GOLDEN_EXPECT, TRIAL_GOLDEN_LOGS, TRIAL_GOLDEN_RULESET, trialGoldenSave, type TrialGoldenExpect } from "../src/golden-trial";
import { toBase64 } from "../src/input/log";
import { replayRun, runLog, startTrialRun, stepRun, type Run } from "../src/replay";
import { COURSES, DEV_TICKS, medalFor, TRIAL_RULESET } from "../src/rules/compete";
import type { TrialCourseId } from "../src/rules/types";
import { RULESET_VERSION } from "../src/score";
import { newBotMemory } from "../src/sim3d/bot";
import { TRIAL_COURSE_IDS, TRIAL_MAX_TICKS, trialLogRuleset } from "../src/sim3d/trial";
import { TRIAL_BOT_STYLE, trialBotFrame, type TrialBotStyle } from "../src/sim3d/trial-bot";

const dir = fileURLToPath(new URL("./golden/", import.meta.url));
const src = fileURLToPath(new URL("../src/golden-trial.ts", import.meta.url));
const competeSrc = fileURLToPath(new URL("../src/rules/compete.ts", import.meta.url));
const UPDATE = process.env.UPDATE_TRIAL_GOLDEN === "1";

interface TrialFile {
  ruleset: string;
  logRuleset: number;
  patrolRuleset: number;
  course: TrialCourseId;
  /** The trial bot's style that ran it (for the record; the log is what counts). */
  style: TrialBotStyle;
  case: TrialGoldenExpect;
}

const bin = (c: TrialCourseId) => `${dir}trial-${c}.bin`;
const json = (c: TrialCourseId) => `${dir}trial-${c}.json`;

/** Race a course with the trial bot in one style. */
function raceBot(course: TrialCourseId, style: TrialBotStyle = TRIAL_BOT_STYLE): Run {
  const run = startTrialRun(trialGoldenSave(), course);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < TRIAL_MAX_TICKS + 1) stepRun(run, trialBotFrame(run.sim, mem, style));
  return run;
}

/** Every style the regeneration tries. */
function styles(): TrialBotStyle[] {
  const out: TrialBotStyle[] = [];
  for (const run of [320, 420, 520])
    for (const release of [500, 650, 800])
      for (const glide of [450, 600, 750])
        for (const climb of [380, 460, 560]) for (const gain of [1.3, 1.6, 2]) out.push({ run, release, glide, climb, gain });
  return out;
}

if (UPDATE) {
  const logs: Partial<Record<TrialCourseId, string>> = {};
  const expect: Partial<Record<TrialCourseId, TrialGoldenExpect>> = {};
  const medals: Partial<Record<TrialCourseId, Record<string, number>>> = {};
  for (const course of TRIAL_COURSE_IDS) {
    let best: { run: Run; style: TrialBotStyle } | null = null;
    const finishes: number[] = [];
    for (const style of styles()) {
      const run = raceBot(course, style);
      const t = run.sim.trial!;
      if (!t.finished) continue;
      finishes.push(run.sim.tick);
      if (!best || run.sim.tick < best.run.sim.tick) best = { run, style };
    }
    if (!best) throw new Error(`no style finished ${course}`);
    const log = runLog(best.run);
    const res = replayRun({ save: trialGoldenSave(), seed: 0, log }, { trial: course });
    const want: TrialGoldenExpect = { ok: res.ok, hash: res.hash, checkpoints: res.checkpoints, score: res.score, ticks: res.ticks, bytes: log.length, finished: res.stats.finished ?? 0 };
    writeFileSync(bin(course), log);
    const file: TrialFile = { ruleset: TRIAL_RULESET, logRuleset: trialLogRuleset(course), patrolRuleset: RULESET_VERSION, course, style: best.style, case: want };
    writeFileSync(json(course), `${JSON.stringify(file, null, 2)}\n`);
    logs[course] = toBase64(log);
    expect[course] = want;
    finishes.sort((x, y) => x - y);
    const at = (q: number) => Math.ceil(finishes[Math.floor(q * (finishes.length - 1))] / 6) * 6;
    medals[course] = { dev: res.ticks, gold: at(0.1), silver: at(0.25), bronze: at(0.5) };
  }
  const block = [
    "// <trial-golden-data>",
    `export const TRIAL_GOLDEN_RULESET: string = ${JSON.stringify(TRIAL_RULESET)};`,
    `export const TRIAL_GOLDEN_LOGS: Record<TrialCourseId, string> = ${JSON.stringify(logs, null, 2)};`,
    `export const TRIAL_GOLDEN_EXPECT: Record<TrialCourseId, TrialGoldenExpect> = ${JSON.stringify(expect, null, 2)};`,
    "// </trial-golden-data>",
  ].join("\n");
  writeFileSync(src, readFileSync(src, "utf8").replace(/\/\/ <trial-golden-data>[\s\S]*\/\/ <\/trial-golden-data>/, block));
  const rows = Object.entries(medals).map(([id, m]) => `  ${JSON.stringify(id)}: ${JSON.stringify(m).replace(/,/g, ", ").replace(/:/g, ": ").replace(/^\{/, "{ ").replace(/\}$/, " }")}`);
  const medalBlock = ["// <medal-ticks>", "export const MEDAL_TICKS: Record<TrialCourseId, Record<Medal, number>> = {", rows.join(",\n"), "};", "// </medal-ticks>"].join("\n");
  writeFileSync(competeSrc, readFileSync(competeSrc, "utf8").replace(/\/\/ <medal-ticks>[\s\S]*\/\/ <\/medal-ticks>/, medalBlock));
}

describe("the time trials' golden replays", () => {
  for (const course of TRIAL_COURSE_IDS) {
    it(`${course}: the course designer's best run, replayed`, () => {
      expect(existsSync(bin(course)), `${bin(course)} is missing; run with UPDATE_TRIAL_GOLDEN=1`).toBe(true);
      const file: TrialFile = JSON.parse(readFileSync(json(course), "utf8"));
      expect(file.ruleset).toBe(TRIAL_RULESET);
      expect(TRIAL_GOLDEN_RULESET).toBe(TRIAL_RULESET);
      expect(file.patrolRuleset).toBe(RULESET_VERSION);
      expect(file.logRuleset).toBe(trialLogRuleset(course));
      const log = new Uint8Array(readFileSync(bin(course)));
      // The browser copy in src/golden-trial.ts is the same data.
      expect(TRIAL_GOLDEN_LOGS[course]).toBe(toBase64(log));
      expect(TRIAL_GOLDEN_EXPECT[course]).toEqual(file.case);
      const res = replayRun({ save: trialGoldenSave(), seed: 0, log }, { trial: course });
      expect({ ok: res.ok, hash: res.hash, checkpoints: res.checkpoints, score: res.score, ticks: res.ticks, bytes: log.length, finished: res.stats.finished ?? 0 }).toEqual(file.case);
      expect(replayTrialGolden(course).hash).toBe(file.case.hash);
      expect(res.ok, res.reason).toBe(true);
      expect(res.stats.finished).toBe(1);
      // One checkpoint per gate, and the clock stopped at the finish.
      expect(res.checkpoints).toHaveLength(COURSES[course].gates);
      expect(res.stats[`split${COURSES[course].gates}`]).toBe(res.ticks);
    });

    it(`${course}: its finish is the dev time, the fastest medal`, () => {
      const file: TrialFile = JSON.parse(readFileSync(json(course), "utf8"));
      expect(DEV_TICKS[course]).toBe(file.case.ticks);
      expect(COURSES[course].medals.dev).toBe(file.case.ticks);
      expect(medalFor(course, file.case.ticks)).toBe("dev");
      expect(medalFor(course, file.case.ticks + 1)).toBe("gold");
      const m = COURSES[course].medals;
      // Each medal a tenth of a second on the clock, each slower than the last.
      for (const t of [m.gold, m.silver, m.bronze]) expect(t % 6).toBe(0);
      expect(m.dev < m.gold && m.gold < m.silver && m.silver < m.bronze).toBe(true);
    });
  }
});
