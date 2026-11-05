/**
 * Case File 001's golden replay: a fixed chapter log and the result it must replay to, in
 * Node (vitest) and, like the patrol goldens (golden.ts, kept byte for byte), in any browser.
 * It lives apart from golden.ts so the patrol goldens never change for a chapter.
 *
 * The log is test/golden/case-001.bin with test/golden/case-001.json; the block between the
 * markers below is the same data, generated. Regenerate after an intended chapter change (and
 * bump CHAPTER_RULESET):
 *
 *   UPDATE_CASE_GOLDEN=1 pnpm --filter @wgp/game-core test case-golden
 */
import { goldenSave, type GoldenCase, type GoldenExpect } from "./golden";
import { fromBase64 } from "./input/log";
import { replayRun } from "./replay";
import { CHAPTER_ID, CHAPTER_RULESET } from "./rules/chapters";
import type { ChapterId, Save } from "./rules/types";
import type { ReplayResult } from "./sim3d/contract";

export interface CaseGoldenCase extends GoldenCase {
  chapter: ChapterId;
}

export const CASE_GOLDEN_CASE: CaseGoldenCase = {
  name: "case-001-standard",
  note: "Case File 001 cleared by the bot: three clues, the Right-Clicker, Mary restored",
  night: 3,
  hero: "Golden Detective",
  starters: ["web-sling", "web-shield", "wall-crawl"],
  extra: ["web-bomb"],
  loadout: ["web-sling", "web-bomb", "web-shield", "wall-crawl"],
  seed: 0xc0010001,
  policy: "bot",
  chapter: CHAPTER_ID,
};

/** The run-start save (no patrol: a chapter doesn't need one). */
export const caseGoldenSave = (): Save => goldenSave(CASE_GOLDEN_CASE);

export const caseGoldenLog = (): Uint8Array => fromBase64(CASE_GOLDEN_LOG);

/** Replay the chapter golden from its save and seed. */
export function replayCaseGolden(): ReplayResult {
  return replayRun({ save: caseGoldenSave(), seed: CASE_GOLDEN_CASE.seed, log: caseGoldenLog() }, { chapter: CASE_GOLDEN_CASE.chapter });
}

// <case-golden-data>
export const CASE_GOLDEN_RULESET: string = "c001-1";
export const CASE_GOLDEN_LOG = "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";
export const CASE_GOLDEN_EXPECT: GoldenExpect & { cleared: number } = {
  "ok": true,
  "hash": "cc173491",
  "checkpoints": [
    "cdd731cd",
    "2e1eb325",
    "95de1d16",
    "9e86f3a5",
    "ffe2cbff"
  ],
  "score": 0,
  "ticks": 3181,
  "bytes": 1520,
  "cleared": 1
};
// </case-golden-data>
