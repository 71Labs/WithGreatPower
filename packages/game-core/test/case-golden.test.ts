/**
 * Case File 001's golden replay (src/golden-case.ts): test/golden/case-001.bin must replay, as
 * a chapter, to test/golden/case-001.json. The patrol goldens (golden.test.ts) are untouched by
 * chapters. After an intended chapter change, bump CHAPTER_RULESET and regenerate:
 *
 *   UPDATE_CASE_GOLDEN=1 pnpm --filter @wgp/game-core test case-golden
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CASE_GOLDEN_CASE, CASE_GOLDEN_EXPECT, CASE_GOLDEN_LOG, CASE_GOLDEN_RULESET, caseGoldenSave, replayCaseGolden } from "../src/golden-case";
import { decodeInputLog, toBase64 } from "../src/input/log";
import { replayRun, runLog, startChapterRun } from "../src/replay";
import { CHAPTER_RULESET } from "../src/rules/chapters";
import { RULESET_VERSION } from "../src/score";
import { chapterLogRuleset } from "../src/sim3d/chapter";
import { botFrame, newBotMemory } from "../src/sim3d/bot";
import { stepRun } from "../src/replay";

const dir = fileURLToPath(new URL("./golden/", import.meta.url));
const src = fileURLToPath(new URL("../src/golden-case.ts", import.meta.url));
const UPDATE = process.env.UPDATE_CASE_GOLDEN === "1";

interface CaseFile {
  ruleset: string;
  logRuleset: number;
  patrolRuleset: number;
  case: typeof CASE_GOLDEN_EXPECT;
}

const BIN = `${dir}${CASE_GOLDEN_CASE.name}.bin`;
const JSON_FILE = `${dir}${CASE_GOLDEN_CASE.name}.json`;

if (UPDATE) {
  const run = startChapterRun(caseGoldenSave(), CASE_GOLDEN_CASE.seed, CASE_GOLDEN_CASE.chapter);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < 54_000) stepRun(run, botFrame(run.sim, mem));
  const log = runLog(run);
  const res = replayRun({ save: caseGoldenSave(), seed: CASE_GOLDEN_CASE.seed, log }, { chapter: CASE_GOLDEN_CASE.chapter });
  const want = { ok: res.ok, hash: res.hash, checkpoints: res.checkpoints, score: res.score, ticks: res.ticks, bytes: log.length, cleared: res.stats.cleared ?? 0 };
  writeFileSync(BIN, log);
  const file: CaseFile = { ruleset: CHAPTER_RULESET, logRuleset: chapterLogRuleset(CASE_GOLDEN_CASE.chapter), patrolRuleset: RULESET_VERSION, case: want };
  writeFileSync(JSON_FILE, `${JSON.stringify(file, null, 2)}\n`);
  const block = [
    "// <case-golden-data>",
    `export const CASE_GOLDEN_RULESET: string = ${JSON.stringify(CHAPTER_RULESET)};`,
    `export const CASE_GOLDEN_LOG = ${JSON.stringify(toBase64(log))};`,
    `export const CASE_GOLDEN_EXPECT: GoldenExpect & { cleared: number } = ${JSON.stringify(want, null, 2)};`,
    "// </case-golden-data>",
  ].join("\n");
  const text = readFileSync(src, "utf8");
  writeFileSync(src, text.replace(/\/\/ <case-golden-data>[\s\S]*\/\/ <\/case-golden-data>/, block));
}

describe("the Case File 001 golden replay", () => {
  it("is pinned to the chapter's ruleset, on the patrol's", () => {
    expect(existsSync(JSON_FILE), `${JSON_FILE} is missing; run with UPDATE_CASE_GOLDEN=1`).toBe(true);
    const file: CaseFile = JSON.parse(readFileSync(JSON_FILE, "utf8"));
    expect(file.ruleset).toBe(CHAPTER_RULESET);
    expect(CASE_GOLDEN_RULESET).toBe(CHAPTER_RULESET);
    expect(file.patrolRuleset).toBe(RULESET_VERSION);
    expect(file.logRuleset).toBe(chapterLogRuleset(CASE_GOLDEN_CASE.chapter));
  });

  it(`${CASE_GOLDEN_CASE.name}: ${CASE_GOLDEN_CASE.note}`, () => {
    expect(existsSync(BIN), `${BIN} is missing; run with UPDATE_CASE_GOLDEN=1`).toBe(true);
    const bin = new Uint8Array(readFileSync(BIN));
    const file: CaseFile = JSON.parse(readFileSync(JSON_FILE, "utf8"));
    const want = file.case;
    // The browser copy in src/golden-case.ts is the same data.
    expect(CASE_GOLDEN_LOG).toBe(toBase64(bin));
    expect(CASE_GOLDEN_EXPECT).toEqual(want);
    expect(decodeInputLog(bin).ruleset).toBe(chapterLogRuleset(CASE_GOLDEN_CASE.chapter));
    const res = replayRun({ save: caseGoldenSave(), seed: CASE_GOLDEN_CASE.seed, log: bin }, { chapter: CASE_GOLDEN_CASE.chapter });
    expect({ ok: res.ok, hash: res.hash, checkpoints: res.checkpoints, score: res.score, ticks: res.ticks, bytes: bin.length, cleared: res.stats.cleared }).toEqual(want);
    expect(res.ok, res.reason).toBe(true);
    expect(want.cleared).toBe(1);
    // Three clues, the win and Mary's release.
    expect(want.checkpoints).toHaveLength(5);
    expect(replayCaseGolden().hash).toBe(want.hash);
  });

  it("is refused as a patrol night, and a patrol golden as a chapter", () => {
    const bin = new Uint8Array(readFileSync(BIN));
    const asNight = replayRun({ save: caseGoldenSave(), seed: CASE_GOLDEN_CASE.seed, log: bin });
    expect(asNight.ok).toBe(false);
    expect(asNight.reason).toMatch(/ruleset/);
    const night = new Uint8Array(readFileSync(`${dir}night-1-standard.bin`));
    const asCase = replayRun({ save: caseGoldenSave(), seed: CASE_GOLDEN_CASE.seed, log: night }, { chapter: "case-001" });
    expect(asCase.ok).toBe(false);
    expect(asCase.reason).toMatch(/ruleset 4 is not chapter case-001/);
  });
});
