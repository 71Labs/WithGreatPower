/**
 * Case File 003's golden replay (src/golden-case-003.ts): test/golden/case-003-standard.bin must
 * replay, as case-003, to its .json. The patrol goldens and Case File 001's are untouched by it.
 * After an intended change to the case's sim, bump FEE_STRIKE_RULESET and regenerate:
 *
 *   UPDATE_CASE3_GOLDEN=1 pnpm --filter @wgp/game-core test case-003-golden
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CASE_GOLDEN_CASE, caseGoldenSave } from "../src/golden-case";
import { CASE3_GOLDEN_CASE, CASE3_GOLDEN_EXPECT, CASE3_GOLDEN_LOG, CASE3_GOLDEN_RULESET, case3GoldenSave, replayCase3Golden } from "../src/golden-case-003";
import { decodeInputLog, toBase64 } from "../src/input/log";
import { replayRun, runLog, startChapterRun, stepRun } from "../src/replay";
import { FEE_STRIKE_RULESET } from "../src/rules/case-003";
import { RULESET_VERSION } from "../src/score";
import { chapterLogRuleset } from "../src/sim3d/chapter";
import { botFrame, newBotMemory } from "../src/sim3d/bot";

const dir = fileURLToPath(new URL("./golden/", import.meta.url));
const src = fileURLToPath(new URL("../src/golden-case-003.ts", import.meta.url));
const UPDATE = process.env.UPDATE_CASE3_GOLDEN === "1";

interface CaseFile {
  ruleset: string;
  logRuleset: number;
  patrolRuleset: number;
  case: typeof CASE3_GOLDEN_EXPECT;
}

const BIN = `${dir}${CASE3_GOLDEN_CASE.name}.bin`;
const JSON_FILE = `${dir}${CASE3_GOLDEN_CASE.name}.json`;

if (UPDATE) {
  const run = startChapterRun(case3GoldenSave(), CASE3_GOLDEN_CASE.seed, CASE3_GOLDEN_CASE.chapter);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < 54_000) stepRun(run, botFrame(run.sim, mem));
  const log = runLog(run);
  const res = replayRun({ save: case3GoldenSave(), seed: CASE3_GOLDEN_CASE.seed, log }, { chapter: CASE3_GOLDEN_CASE.chapter });
  const want = { ok: res.ok, hash: res.hash, checkpoints: res.checkpoints, score: res.score, ticks: res.ticks, bytes: log.length, cleared: res.stats.cleared ?? 0 };
  writeFileSync(BIN, log);
  const file: CaseFile = { ruleset: FEE_STRIKE_RULESET, logRuleset: chapterLogRuleset(CASE3_GOLDEN_CASE.chapter), patrolRuleset: RULESET_VERSION, case: want };
  writeFileSync(JSON_FILE, `${JSON.stringify(file, null, 2)}\n`);
  const block = [
    "// <case3-golden-data>",
    `export const CASE3_GOLDEN_RULESET: string = ${JSON.stringify(FEE_STRIKE_RULESET)};`,
    `export const CASE3_GOLDEN_LOG = ${JSON.stringify(toBase64(log))};`,
    `export const CASE3_GOLDEN_EXPECT: GoldenExpect & { cleared: number } = ${JSON.stringify(want, null, 2)};`,
    "// </case3-golden-data>",
  ].join("\n");
  const text = readFileSync(src, "utf8");
  writeFileSync(src, text.replace(/\/\/ <case3-golden-data>[\s\S]*\/\/ <\/case3-golden-data>/, block));
}

describe("the Case File 003 golden replay", () => {
  it("is pinned to the case's own ruleset, on the patrol's", () => {
    expect(existsSync(JSON_FILE), `${JSON_FILE} is missing; run with UPDATE_CASE3_GOLDEN=1`).toBe(true);
    const file: CaseFile = JSON.parse(readFileSync(JSON_FILE, "utf8"));
    expect(file.ruleset).toBe(FEE_STRIKE_RULESET);
    expect(FEE_STRIKE_RULESET).toBe("c003-1");
    expect(CASE3_GOLDEN_RULESET).toBe(FEE_STRIKE_RULESET);
    expect(file.patrolRuleset).toBe(RULESET_VERSION);
    expect(file.logRuleset).toBe(chapterLogRuleset("case-003"));
    expect(file.logRuleset).toBe(0x0c003104);
  });

  it(`${CASE3_GOLDEN_CASE.name}: ${CASE3_GOLDEN_CASE.note}`, () => {
    expect(existsSync(BIN), `${BIN} is missing; run with UPDATE_CASE3_GOLDEN=1`).toBe(true);
    const bin = new Uint8Array(readFileSync(BIN));
    const file: CaseFile = JSON.parse(readFileSync(JSON_FILE, "utf8"));
    const want = file.case;
    // The browser copy in src/golden-case-003.ts is the same data.
    expect(CASE3_GOLDEN_LOG).toBe(toBase64(bin));
    expect(CASE3_GOLDEN_EXPECT).toEqual(want);
    expect(decodeInputLog(bin).ruleset).toBe(chapterLogRuleset("case-003"));
    const res = replayRun({ save: case3GoldenSave(), seed: CASE3_GOLDEN_CASE.seed, log: bin }, { chapter: "case-003" });
    expect({ ok: res.ok, hash: res.hash, checkpoints: res.checkpoints, score: res.score, ticks: res.ticks, bytes: bin.length, cleared: res.stats.cleared }).toEqual(want);
    expect(res.ok, res.reason).toBe(true);
    expect(want.cleared).toBe(1);
    // Three clues, the grab, the bakery, the win and the cooled meter.
    expect(want.checkpoints).toHaveLength(7);
    expect(replayCase3Golden().hash).toBe(want.hash);
  });

  it("is refused as a patrol night and as Case File 001, and their logs as case-003", () => {
    const bin = new Uint8Array(readFileSync(BIN));
    const asNight = replayRun({ save: case3GoldenSave(), seed: CASE3_GOLDEN_CASE.seed, log: bin });
    expect(asNight.ok).toBe(false);
    expect(asNight.reason).toMatch(/ruleset 201339140 is not 4/);
    const asCase1 = replayRun({ save: case3GoldenSave(), seed: CASE3_GOLDEN_CASE.seed, log: bin }, { chapter: "case-001" });
    expect(asCase1.ok).toBe(false);
    expect(asCase1.reason).toMatch(/is not chapter case-001/);
    const night = new Uint8Array(readFileSync(`${dir}night-1-standard.bin`));
    const nightAs3 = replayRun({ save: case3GoldenSave(), seed: CASE3_GOLDEN_CASE.seed, log: night }, { chapter: "case-003" });
    expect(nightAs3.ok).toBe(false);
    expect(nightAs3.reason).toMatch(/ruleset 4 is not chapter case-003/);
    const case1 = new Uint8Array(readFileSync(`${dir}${CASE_GOLDEN_CASE.name}.bin`));
    const case1As3 = replayRun({ save: caseGoldenSave(), seed: CASE_GOLDEN_CASE.seed, log: case1 }, { chapter: "case-003" });
    expect(case1As3.ok).toBe(false);
    expect(case1As3.reason).toMatch(/ruleset 201330948 is not chapter case-003/);
  });
});
