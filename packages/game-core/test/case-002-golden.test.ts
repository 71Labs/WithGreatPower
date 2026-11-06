/**
 * Case File 002's golden replay (src/golden-case-002.ts): test/golden/case-002-standard.bin must
 * replay, as Case File 002, to its .json. The patrol goldens and Case File 001's are untouched.
 * After an intended change to its sim, bump CASE_002_RULESET and regenerate:
 *
 *   UPDATE_CASE_002_GOLDEN=1 pnpm --filter @wgp/game-core test case-002-golden
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CASE_002_GOLDEN_CASE, CASE_002_GOLDEN_EXPECT, CASE_002_GOLDEN_LOG, CASE_002_GOLDEN_RULESET, case002GoldenSave, replayCase002Golden } from "../src/golden-case-002";
import { CASE_GOLDEN_CASE } from "../src/golden-case";
import { decodeInputLog, toBase64 } from "../src/input/log";
import { replayRun, runLog, startChapterRun, stepRun } from "../src/replay";
import { CASE_002_RULESET } from "../src/rules/chapters";
import { RULESET_VERSION } from "../src/score";
import { botFrame, newBotMemory } from "../src/sim3d/bot";
import { chapterLogRuleset } from "../src/sim3d/chapter";

const dir = fileURLToPath(new URL("./golden/", import.meta.url));
const src = fileURLToPath(new URL("../src/golden-case-002.ts", import.meta.url));
const UPDATE = process.env.UPDATE_CASE_002_GOLDEN === "1";

interface CaseFile {
  ruleset: string;
  logRuleset: number;
  patrolRuleset: number;
  case: typeof CASE_002_GOLDEN_EXPECT;
}

const C = CASE_002_GOLDEN_CASE;
const BIN = `${dir}${C.name}.bin`;
const JSON_FILE = `${dir}${C.name}.json`;

if (UPDATE) {
  const run = startChapterRun(case002GoldenSave(), C.seed, C.chapter);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < 54_000) stepRun(run, botFrame(run.sim, mem));
  const log = runLog(run);
  const res = replayRun({ save: case002GoldenSave(), seed: C.seed, log }, { chapter: C.chapter });
  const want = { ok: res.ok, hash: res.hash, checkpoints: res.checkpoints, score: res.score, ticks: res.ticks, bytes: log.length, cleared: res.stats.cleared ?? 0 };
  writeFileSync(BIN, log);
  const file: CaseFile = { ruleset: CASE_002_RULESET, logRuleset: chapterLogRuleset(C.chapter), patrolRuleset: RULESET_VERSION, case: want };
  writeFileSync(JSON_FILE, `${JSON.stringify(file, null, 2)}\n`);
  const block = [
    "// <case-002-golden-data>",
    `export const CASE_002_GOLDEN_RULESET: string = ${JSON.stringify(CASE_002_RULESET)};`,
    `export const CASE_002_GOLDEN_LOG = ${JSON.stringify(toBase64(log))};`,
    `export const CASE_002_GOLDEN_EXPECT: GoldenExpect & { cleared: number } = ${JSON.stringify(want, null, 2)};`,
    "// </case-002-golden-data>",
  ].join("\n");
  const text = readFileSync(src, "utf8");
  writeFileSync(src, text.replace(/\/\/ <case-002-golden-data>[\s\S]*\/\/ <\/case-002-golden-data>/, block));
}

describe("the Case File 002 golden replay", () => {
  it("is pinned to its own ruleset, on the patrol's", () => {
    expect(existsSync(JSON_FILE), `${JSON_FILE} is missing; run with UPDATE_CASE_002_GOLDEN=1`).toBe(true);
    const file: CaseFile = JSON.parse(readFileSync(JSON_FILE, "utf8"));
    expect(file.ruleset).toBe(CASE_002_RULESET);
    expect(CASE_002_GOLDEN_RULESET).toBe(CASE_002_RULESET);
    expect(file.patrolRuleset).toBe(RULESET_VERSION);
    expect(file.logRuleset).toBe(chapterLogRuleset("case-002"));
    expect(file.logRuleset).toBe(0x0c002104);
  });

  it(`${C.name}: ${C.note}`, () => {
    expect(existsSync(BIN), `${BIN} is missing; run with UPDATE_CASE_002_GOLDEN=1`).toBe(true);
    const bin = new Uint8Array(readFileSync(BIN));
    const file: CaseFile = JSON.parse(readFileSync(JSON_FILE, "utf8"));
    const want = file.case;
    // The browser copy in src/golden-case-002.ts is the same data.
    expect(CASE_002_GOLDEN_LOG).toBe(toBase64(bin));
    expect(CASE_002_GOLDEN_EXPECT).toEqual(want);
    expect(decodeInputLog(bin).ruleset).toBe(chapterLogRuleset(C.chapter));
    const res = replayRun({ save: case002GoldenSave(), seed: C.seed, log: bin }, { chapter: C.chapter });
    expect({ ok: res.ok, hash: res.hash, checkpoints: res.checkpoints, score: res.score, ticks: res.ticks, bytes: bin.length, cleared: res.stats.cleared }).toEqual(want);
    expect(res.ok, res.reason).toBe(true);
    expect(want.cleared).toBe(1);
    // Three clues, the mark, the win and Uncle Gen's vote.
    expect(want.checkpoints).toHaveLength(6);
    expect(replayCase002Golden().hash).toBe(want.hash);
  });

  it("refuses cross-mode logs: as a patrol night, as Case File 001, and theirs as Case File 002", () => {
    const bin = new Uint8Array(readFileSync(BIN));
    const asNight = replayRun({ save: case002GoldenSave(), seed: C.seed, log: bin });
    expect(asNight.ok).toBe(false);
    expect(asNight.reason).toMatch(/ruleset 201335044 is not 4/);
    const asCase1 = replayRun({ save: case002GoldenSave(), seed: C.seed, log: bin }, { chapter: "case-001" });
    expect(asCase1.ok).toBe(false);
    expect(asCase1.reason).toMatch(/ruleset 201335044 is not chapter case-001's 201330948/);
    const night = new Uint8Array(readFileSync(`${dir}night-1-standard.bin`));
    const nightAs2 = replayRun({ save: case002GoldenSave(), seed: C.seed, log: night }, { chapter: "case-002" });
    expect(nightAs2.ok).toBe(false);
    expect(nightAs2.reason).toMatch(/ruleset 4 is not chapter case-002's 201335044/);
    const case1 = new Uint8Array(readFileSync(`${dir}${CASE_GOLDEN_CASE.name}.bin`));
    const case1As2 = replayRun({ save: case002GoldenSave(), seed: C.seed, log: case1 }, { chapter: "case-002" });
    expect(case1As2.ok).toBe(false);
    expect(case1As2.reason).toMatch(/ruleset 201330948 is not chapter case-002's 201335044/);
  });
});
