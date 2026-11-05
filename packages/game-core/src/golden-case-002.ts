/**
 * Case File 002's golden replay: a fixed chapter log and the result it must replay to, in Node
 * (vitest) and in any browser. It lives apart from golden.ts and golden-case.ts, so neither the
 * patrol goldens nor Case File 001's ever change for it.
 *
 * The log is test/golden/case-002-standard.bin with its .json; the block between the markers
 * below is the same data, generated. Regenerate after an intended change to Case File 002's sim
 * (and bump CASE_002_RULESET):
 *
 *   UPDATE_CASE_002_GOLDEN=1 pnpm --filter @wgp/game-core test case-002-golden
 */
import { goldenSave, type GoldenExpect } from "./golden";
import type { CaseGoldenCase } from "./golden-case";
import { fromBase64 } from "./input/log";
import { replayRun } from "./replay";
import { CASE_002_ID } from "./rules/chapters";
import type { Save } from "./rules/types";
import type { ReplayResult } from "./sim3d/contract";

export const CASE_002_GOLDEN_CASE: CaseGoldenCase = {
  name: "case-002-standard",
  note: "Case File 002 cleared by the bot: three drop boxes, the lineup, the Sybil's three stages, Uncle Gen's ballot counted",
  night: 3,
  hero: "Golden Voter",
  starters: ["web-sling", "web-shield", "wall-crawl"],
  extra: ["web-bomb"],
  loadout: ["web-sling", "web-bomb", "web-shield", "wall-crawl"],
  seed: 0xc0020001,
  policy: "bot",
  chapter: CASE_002_ID,
};

/** The run-start save (no patrol: a chapter doesn't need one). */
export const case002GoldenSave = (): Save => goldenSave(CASE_002_GOLDEN_CASE);

export const case002GoldenLog = (): Uint8Array => fromBase64(CASE_002_GOLDEN_LOG);

/** Replay Case File 002's golden from its save and seed. */
export function replayCase002Golden(): ReplayResult {
  return replayRun({ save: case002GoldenSave(), seed: CASE_002_GOLDEN_CASE.seed, log: case002GoldenLog() }, { chapter: CASE_002_GOLDEN_CASE.chapter });
}

// <case-002-golden-data>
export const CASE_002_GOLDEN_RULESET: string = "c002-1";
export const CASE_002_GOLDEN_LOG = "AYTCgGAAtRRHgRJDgQpDgANDgU9DgAVDgQpDgAZDgQ0/gQY/AEOAGUOBBkeBHkeAAEuAAUuBB0+BAU+AAVMAf4AAf4EDg4EGh4ERg4EAgwCDgQN/gQR7gQR3gQNzgQNvgQNrgQNnAWeAAmOAAV8AW4AAVwDjAOOBCOeBKOcA54EH44EY44AM34AB34EQ34AB34ED24Eb34EK3wDfgSPbgQXfgRLjAeOADOeBDM8B04EA1wHbAd8B4wHnAeuBBO+BA+eBAOuBAO+BAPMB9wH7AQOAAAcAC4AA84AH7wDvgQ7rgQjngQXjgATfgALbgALXgADXgQHTgQLPgQHLgQLHgQHDgQK/gQG7gQG3gQKzAbOAAK+AAauAA6eAA6MAo4EBn4EBm4EBl4EAk4EAj4EAi4EAh4EAg4EAf4EAewB3AHMAbwBrAGcAYwBfAFsAUwBPAEsARwBDAT8BO4EANwEzAS+BACuBACeBACOBAB+BABuBABeBAROBAA+BABOBBxeBARuBAR8BIwEnASsBC4EAC4AID4ACD4EME4EIF4EBF4AEG4AFHwAfgQIjgQIngQErgQEvgQEzgQE3gQA7ATuAAD8AAICbAYMCg4ATgwSDgBGCgAAAB4KAAKuAD6eAAEYBp4ADq4AEr4AFs4ABsgGzgAAfAh+ABCOACoIBI4AAJ4ABI4ABH4AKSwDCAUuAEU+ABFOAAleAAVuABF+ABGOAAwACAIAezgHPgAAPgA/OAc+ABNOAC9MG0wDSAWeAB2uACG8Cb4ABc4ABd4ABe4AGf4ACg4ADh4ALi4ADAIAsAwIDgBcAAQOAHmMAXwBbgAAvAMIBw4AAL4ANK4ACJ4ACIwAjAiMAH4AA1gEfABuADhsEG4ABF4ACE4ACD4ACogGjgAOnAIIAfoABwoABvoAAuoAAtgAAgASuAKqAAKaAAKKAAJ4AmoAAloAAkgCSAZKAAOeAB+cG54AT5wLngABWAdsA34AE44AE54AGfgHngAHrgAzvgAKGAe8AQ4AVAAFDgBBDAkOAJwCAGbeADPeABvcC94AGq4ACp4AOpgGngAWrgAKvgAGzgAWyAbOAAUcAS4AFT4AIU4ADV4ACW4AYAIA00gFbAFcAE4AJEwYTgANPgARTgANXgAFbgAJfgAFjgAtngAprgAhvgAbaAduAAQOANp4BK4ABA4AcAwIjgAQngAUrgAMAgADjgA+KAQCAAOOAD9OAD24BG4ATjgEbgA2DgASCAYOAACeBFCOBAx8BFwHvAbMBqwGngQKjgQSjgAKfgACfgQybgQaXgQSTgQOPgQGLgQCHAYMBfwF7AXMBawFfAFMARwE7ATcBLwErASeBACOBAR+BAhuBAheBAxOBCMsAywHLgAPPAPeAIfcG94AGOwE7AD+AAEOAAEeBAEuBAE+BAFMBV4EAWwFfgQBjAWcBawFvgQBzAXcBewF/gQCDAYcBiwGPgQCTAZcBm4EAnwGjgQCngQCrAa+BALOBALeBALuBAL+BAcOBAMeBAMuBAM+BAdOBANeBANuBAt+BA+OBAeeBAeuBAO8B8wH3AfsB/wADAAsBDwEXAR8BJwEvATMBOwE/AUMBRwFLgQBPAVOBAFeBAFuBAF+BJwA=";
export const CASE_002_GOLDEN_EXPECT: GoldenExpect & { cleared: number } = {
  "ok": true,
  "hash": "e44afdb5",
  "checkpoints": [
    "5179b569",
    "6e12cc08",
    "9d951a30",
    "12cb0190",
    "7494d3ee",
    "b908deb2"
  ],
  "score": 0,
  "ticks": 2613,
  "bytes": 1217,
  "cleared": 1
};
// </case-002-golden-data>
