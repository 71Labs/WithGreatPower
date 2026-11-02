/**
 * Golden replays. test/golden/<case>.bin are fixed input logs; hashes.json is what they
 * must replay to. src/golden.ts carries the same data for the browser check at
 * /lab/determinism. After an intended change, regenerate all three (and bump
 * RULESET_VERSION):
 *
 *   UPDATE_GOLDEN=1 pnpm --filter @wgp/game-core test golden
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { GOLDEN_CASES, GOLDEN_EXPECT, GOLDEN_LOGS, GOLDEN_RULESET, goldenSave, replayGolden, type GoldenExpect } from "../src/golden";
import { toBase64 } from "../src/input/log";
import { replayRun, runLog } from "../src/replay";
import { RULESET_VERSION } from "../src/score";
import { playBot } from "./helpers";

const dir = fileURLToPath(new URL("./golden/", import.meta.url));
const src = fileURLToPath(new URL("../src/golden.ts", import.meta.url));
const UPDATE = process.env.UPDATE_GOLDEN === "1";

interface HashesFile {
  ruleset: number;
  cases: Record<string, GoldenExpect>;
}

if (UPDATE) {
  const cases: Record<string, GoldenExpect> = {};
  const logs: Record<string, string> = {};
  for (const c of GOLDEN_CASES) {
    const played = playBot(goldenSave(c), c.seed, { idleInFights: c.policy === "idle-in-fights" });
    const log = runLog(played.run);
    const res = replayRun({ save: goldenSave(c), seed: c.seed, log });
    writeFileSync(`${dir}${c.name}.bin`, log);
    logs[c.name] = toBase64(log);
    cases[c.name] = { ok: res.ok, hash: res.hash, checkpoints: res.checkpoints, score: res.score, ticks: res.ticks, bytes: log.length };
  }
  const file: HashesFile = { ruleset: RULESET_VERSION, cases };
  writeFileSync(`${dir}hashes.json`, `${JSON.stringify(file, null, 2)}\n`);
  const block = [
    "// <golden-data>",
    `export const GOLDEN_RULESET: number = ${RULESET_VERSION};`,
    `export const GOLDEN_LOGS: Record<string, string> = ${JSON.stringify(logs, null, 2)};`,
    `export const GOLDEN_EXPECT: Record<string, GoldenExpect> = ${JSON.stringify(cases, null, 2)};`,
    "// </golden-data>",
  ].join("\n");
  const text = readFileSync(src, "utf8");
  writeFileSync(src, text.replace(/\/\/ <golden-data>[\s\S]*\/\/ <\/golden-data>/, block));
}

describe("golden replays", () => {
  const file: HashesFile = JSON.parse(readFileSync(`${dir}hashes.json`, "utf8"));

  it("are pinned to this ruleset", () => {
    expect(file.ruleset).toBe(RULESET_VERSION);
    expect(GOLDEN_RULESET).toBe(RULESET_VERSION);
  });

  for (const c of GOLDEN_CASES) {
    it(`${c.name}: ${c.note}`, () => {
      const path = `${dir}${c.name}.bin`;
      expect(existsSync(path), `${path} is missing; run with UPDATE_GOLDEN=1`).toBe(true);
      const bin = new Uint8Array(readFileSync(path));
      const want = file.cases[c.name];
      // The browser copy in src/golden.ts is the same data.
      expect(GOLDEN_LOGS[c.name]).toBe(toBase64(bin));
      expect(GOLDEN_EXPECT[c.name]).toEqual(want);
      const res = replayRun({ save: goldenSave(c), seed: c.seed, log: bin });
      expect({ ok: res.ok, hash: res.hash, checkpoints: res.checkpoints, score: res.score, ticks: res.ticks, bytes: bin.length }).toEqual(want);
      expect(replayGolden(c).hash).toBe(want.hash);
      if (c.policy === "bot") expect(res.ok, res.reason).toBe(true);
    });
  }
});
