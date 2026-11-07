/**
 * Free roam's golden replay and determinism (src/golden-roam.ts, ruleset tag roam-3): test/golden/roam-standard.bin
 * must replay, as an outing, to test/golden/roam-standard.json; the same log replays the same
 * way twice and after other runs; a roam log is refused by the night and chapter verifiers and
 * their logs by the roam verifier. The patrol and chapter goldens (golden.test.ts,
 * case-golden.test.ts) are untouched by free roam. After an intended roam change, bump
 * ROAM_RULESET and regenerate:
 *
 *   UPDATE_ROAM_GOLDEN=1 pnpm --filter @wgp/game-core test roam-golden
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { caseGoldenSave } from "../src/golden-case";
import { ROAM_GOLDEN_EXPECT, ROAM_GOLDEN_LOG, ROAM_GOLDEN_RULESET, replayRoamGolden, roamGoldenStart, type RoamGoldenExpect } from "../src/golden-roam";
import { decodeInputLog, encodeInputCodes, encodeInputLog, toBase64 } from "../src/input/log";
import { replayRun } from "../src/replay";
import { replayRoam, roamLog, startRoamRun, stepRoamRun } from "../src/roam-run";
import { hashState } from "../src/hash";
import { RULESET_VERSION } from "../src/score";
import { chapterLogRuleset } from "../src/sim3d/chapter";
import { HERO_RADIUS } from "../src/sim3d/constants";
import { ROAM_LOG_RULESET, ROAM_OLD_LOG_RULESETS, ROAM_RULESET } from "../src/sim3d/roam/constants";
import { furnitureSolids } from "../src/sim3d/roam/furniture";
import { newRoamBot, roamBotFrame, roamTour } from "../src/sim3d/roam/bot";
import { roamCityFurniture, roamWorld } from "../src/sim3d/roam/world";
import { TASK_DONE } from "../src/sim3d/roam/types";

const dir = fileURLToPath(new URL("./golden/", import.meta.url));
const src = fileURLToPath(new URL("../src/golden-roam.ts", import.meta.url));
const UPDATE = process.env.UPDATE_ROAM_GOLDEN === "1";
const NAME = "roam-standard";
const BIN = `${dir}${NAME}.bin`;
const JSON_FILE = `${dir}${NAME}.json`;

interface RoamFile {
  ruleset: string;
  logRuleset: number;
  patrolRuleset: number;
  outing: RoamGoldenExpect;
}

function playTour() {
  const run = startRoamRun(roamGoldenStart());
  const goals = roamTour(roamWorld());
  const mem = newRoamBot(goals);
  while (mem.i < goals.length && run.sim.tick < 60 * 60 * 5) stepRoamRun(run, roamBotFrame(run.sim, mem));
  return run;
}

const pick = (res: ReturnType<typeof replayRoam>, bytes: number): RoamGoldenExpect => ({
  ok: res.ok,
  hash: res.hash,
  checkpoints: res.checkpoints,
  ticks: res.ticks,
  bytes,
  stage: res.outing.stage,
  pages: res.outing.pages,
  views: res.outing.views,
});

if (UPDATE) {
  const run = playTour();
  const log = roamLog(run);
  const res = replayRoam({ start: roamGoldenStart(), log });
  const want = pick(res, log.length);
  writeFileSync(BIN, log);
  const file: RoamFile = { ruleset: ROAM_RULESET, logRuleset: ROAM_LOG_RULESET, patrolRuleset: RULESET_VERSION, outing: want };
  writeFileSync(JSON_FILE, `${JSON.stringify(file, null, 2)}\n`);
  const block = [
    "// <roam-golden-data>",
    `export const ROAM_GOLDEN_RULESET: string = ${JSON.stringify(ROAM_RULESET)};`,
    `export const ROAM_GOLDEN_LOG = ${JSON.stringify(toBase64(log))};`,
    `export const ROAM_GOLDEN_EXPECT: RoamGoldenExpect = ${JSON.stringify(want, null, 2)};`,
    "// </roam-golden-data>",
  ].join("\n");
  writeFileSync(src, readFileSync(src, "utf8").replace(/\/\/ <roam-golden-data>[\s\S]*\/\/ <\/roam-golden-data>/, block));
}

describe("the free-roam golden replay", () => {
  it("is pinned to roam's ruleset tag, on the patrol's", () => {
    expect(existsSync(JSON_FILE), `${JSON_FILE} is missing; run with UPDATE_ROAM_GOLDEN=1`).toBe(true);
    const file: RoamFile = JSON.parse(readFileSync(JSON_FILE, "utf8"));
    expect(file.ruleset).toBe(ROAM_RULESET);
    expect(ROAM_GOLDEN_RULESET).toBe(ROAM_RULESET);
    expect(file.patrolRuleset).toBe(RULESET_VERSION);
    expect(file.logRuleset).toBe(ROAM_LOG_RULESET);
    // Its own log ruleset: never a night's, never a chapter's.
    expect(ROAM_LOG_RULESET).not.toBe(RULESET_VERSION);
    expect(ROAM_LOG_RULESET).not.toBe(chapterLogRuleset("case-001"));
  });

  it("roam-standard: the tour (a walk, a sprint and a roll, the pickpocket chase, a page, a swing, a zip) replays to its pinned result", () => {
    expect(existsSync(BIN), `${BIN} is missing; run with UPDATE_ROAM_GOLDEN=1`).toBe(true);
    const bin = new Uint8Array(readFileSync(BIN));
    const file: RoamFile = JSON.parse(readFileSync(JSON_FILE, "utf8"));
    expect(ROAM_GOLDEN_LOG).toBe(toBase64(bin));
    expect(ROAM_GOLDEN_EXPECT).toEqual(file.outing);
    expect(decodeInputLog(bin).ruleset).toBe(ROAM_LOG_RULESET);
    const res = replayRoam({ start: roamGoldenStart(), log: bin });
    expect(res.ok, res.reason).toBe(true);
    expect(pick(res, bin.length)).toEqual(file.outing);
    expect(replayRoamGolden().hash).toBe(file.outing.hash);
    // The pickpocket task finished and one page found: checkpoints at each.
    expect(file.outing.stage[1]).toBe(TASK_DONE);
    expect(file.outing.pages).not.toBe(0);
    expect(file.outing.checkpoints.length).toBeGreaterThanOrEqual(4);
  });

  it("roam-2: the tour meets the traffic (a car knocks him down, he gets up) and the City's furniture (lamps, cars, rails he slides along or vaults)", () => {
    const run = startRoamRun(roamGoldenStart());
    const goals = roamTour(roamWorld());
    const mem = newRoamBot(goals);
    const solids = furnitureSolids(roamCityFurniture());
    const touched = new Set<number>();
    let hits = 0;
    let ups = 0;
    while (mem.i < goals.length && run.sim.tick < 60 * 60 * 5) {
      for (const e of stepRoamRun(run, roamBotFrame(run.sim, mem))) {
        if (e.type === "roam-car-hit") hits++;
        if (e.type === "roam-move" && e.from === "knocked") ups++;
      }
      const h = run.sim.hero;
      solids.forEach((b, i) => {
        if (h.x < b.x0 - 30 || h.x > b.x1 + 30 || h.z < b.z0 - 30 || h.z > b.z1 + 30) return;
        const qx = Math.max(b.x0, Math.min(b.x1, h.x));
        const qy = Math.max(b.y0, Math.min(b.y1, h.y));
        const qz = Math.max(b.z0, Math.min(b.z1, h.z));
        if (Math.hypot(h.x - qx, h.y - qy, h.z - qz) < HERO_RADIUS + 1) touched.add(i);
      });
    }
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(ups).toBe(hits);
    expect(touched.size).toBeGreaterThanOrEqual(3);
  });

  it("the bot plays the same tour frame for frame, and the live run hashes as the replay does", () => {
    const one = playTour();
    const two = playTour();
    expect(two.codes).toEqual(one.codes);
    const log = roamLog(one);
    const res = replayRoam({ start: roamGoldenStart(), log });
    expect(res.hash).toBe(replayRoam({ start: roamGoldenStart(), log }).hash);
    expect(res.checkpoints).toEqual(one.checkpoints);
  });

  it("replays the same after other runs (no shared scratch or cache leaks)", () => {
    const bin = new Uint8Array(readFileSync(BIN));
    const a = replayRoam({ start: roamGoldenStart(), log: bin });
    // Something else in between: a night and another outing.
    replayRun({ save: caseGoldenSave(), seed: 1, log: new Uint8Array(readFileSync(`${dir}night-1-standard.bin`)) });
    replayRoam({ start: { ...roamGoldenStart(), at: { x: 3810, y: 0, z: 600, fx: 0, fz: 1 } }, log: bin.slice(0) });
    const b = replayRoam({ start: roamGoldenStart(), log: bin });
    expect(b).toEqual(a);
  });

  it("a changed frame is a different outing", () => {
    const bin = new Uint8Array(readFileSync(BIN));
    const base = replayRoam({ start: roamGoldenStart(), log: bin });
    const decoded = decodeInputLog(bin);
    for (let i = 200; i < 230; i++) decoded.frames[i] = { ...decoded.frames[i], dir: (decoded.frames[i].dir + 16) % 64, mag: 3 };
    const tampered = replayRoam({ start: roamGoldenStart(), log: encodeInputLog(decoded) });
    expect(tampered.hash).not.toBe(base.hash);
  });

  it("refuses a log that isn't an outing's: bad bytes, a night's or a chapter's ruleset, a late start, events", () => {
    const bin = new Uint8Array(readFileSync(BIN));
    const decoded = decodeInputLog(bin);
    const reason = (bytes: Uint8Array) => replayRoam({ start: roamGoldenStart(), log: bytes }).reason ?? "ok";
    expect(reason(bin)).toBe("ok");
    expect(reason(bin.slice(0, bin.length - 1))).toMatch(/bad log/);
    expect(reason(encodeInputLog({ ...decoded, ruleset: RULESET_VERSION }))).toMatch(/ruleset 4 is not free roam/);
    expect(reason(encodeInputLog({ ...decoded, ruleset: chapterLogRuleset("case-001") }))).toMatch(/is not free roam/);
    // roam-1's outings (before the City's furniture was solid and its cars hit him) and roam-2's
    // (before interact was held and the relays went up) aren't roam-3's.
    for (const old of ROAM_OLD_LOG_RULESETS) expect(reason(encodeInputLog({ ...decoded, ruleset: old }))).toMatch(/is an older free roam's \(stale\)/);
    expect(reason(encodeInputLog({ ...decoded, fromTick: 3 }))).toMatch(/tick 0/);
    expect(reason(encodeInputCodes([0, 0, 0], [{ tick: 1, kind: "errand-choice", value: 0 }], 0, ROAM_LOG_RULESET))).toMatch(/no events/);
    // A night's golden is refused as an outing.
    const night = new Uint8Array(readFileSync(`${dir}night-1-standard.bin`));
    expect(reason(night)).toMatch(/ruleset 4 is not free roam/);
  });

  it("is refused by the night verifier and the chapter verifier", () => {
    const bin = new Uint8Array(readFileSync(BIN));
    const asNight = replayRun({ save: caseGoldenSave(), seed: 1, log: bin });
    expect(asNight.ok).toBe(false);
    expect(asNight.reason).toMatch(new RegExp(`ruleset ${ROAM_LOG_RULESET} is not 4`));
    const asCase = replayRun({ save: caseGoldenSave(), seed: 1, log: bin }, { chapter: "case-001" });
    expect(asCase.ok).toBe(false);
    expect(asCase.reason).toMatch(/is not chapter case-001/);
  });

  it("leaves a night's state hash alone: a roam state's extra fields are hashed apart", () => {
    const run = startRoamRun(roamGoldenStart());
    const before = hashState(run.sim);
    run.sim.roam!.progress.pages = 7;
    expect(hashState(run.sim)).toBe(before);
  });
});
