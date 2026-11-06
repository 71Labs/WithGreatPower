/**
 * Free roam's golden replay: a fixed outing log (the scripted bot's tour: a walk, a sprint off
 * the start roof and a roll, Dev's pickpocket chase over the roofs start to finish, a Daily Rug
 * page, a swing on demand and a zip) and the result it must replay to, in Node (vitest) and in
 * any browser. It lives apart from golden.ts and golden-case.ts, so no night's or chapter's
 * golden ever changes for free roam.
 *
 * The log is test/golden/roam-standard.bin with test/golden/roam-standard.json; the block between
 * the markers below is the same data, generated. Regenerate after an intended roam change (and
 * bump ROAM_RULESET):
 *
 *   UPDATE_ROAM_GOLDEN=1 pnpm --filter @wgp/game-core test roam-golden
 */
import { fromBase64 } from "./input/log";
import { replayRoam, type RoamReplayResult } from "./roam-run";
import { freshStart } from "./sim3d/roam/step";
import type { RoamStart } from "./sim3d/roam/types";

/** The golden outing starts as a first visit does: nothing found, on the spawn roof. */
export const roamGoldenStart = (): RoamStart => freshStart();

export const roamGoldenLog = (): Uint8Array => fromBase64(ROAM_GOLDEN_LOG);

export const replayRoamGolden = (): RoamReplayResult => replayRoam({ start: roamGoldenStart(), log: roamGoldenLog() });

export interface RoamGoldenExpect {
  ok: boolean;
  hash: string;
  checkpoints: string[];
  ticks: number;
  bytes: number;
  stage: number[];
  pages: number;
  views: number;
}

// <roam-golden-data>
export const ROAM_GOLDEN_RULESET: string = "roam-1";
export const ROAM_GOLDEN_LOG = "AYSigHgAxw2FgByHgBqDgACDiCiHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiCwAgBzDiCUDiAcHiAkLiAkPiKABC4gLB4gEA4gC/4gB+wj3iADzCOsI5wjfCNcIywjDCLcArwCrAKcAowCfgACbgACXgAGTgASPgAuLgAmLiAyHiA+HgBaGgBaKAIYAigCGAIsAhwCLAIcAiwCHAIsAhwCLAIcAiwCHAIsAhwCLAIcAiwCHAIsAhwCvALMAt4AAuwC/AMOAAMcA+wD/gAMDgBQCgAMAAAAGAIAc24gF34gU44gf54gE64gB74gB84gA94gL9wT3iAD7iAj/iAEDiAAHCAsIDwgTCAAAQwhHiABLiAZPiAdTiBhPiAlLCH8Ig4gDh4gDi4gDj4gCk4gCl4gDm4gFn4gFo4gHp4gKq4gMr4gns4gUAAqziHqzgAi3gAG2AL6AAMKAAMYAygDOANYA4gDuAP4ACoACDoADEoABFoAAGgAegAAiACYALoAAMgA2gAUyAC4AGgDmAMoAwgC+gAC6gAO2gASygAOugACqAKIAlgBiAEYAAAAABkOIGoOIWH8Igwh/iACDiAB/iACDiAB/iABXCFMISwBHAD8ANwAvACcAHwAbABMADwALAAOAAP8A+4AA94AB84AD9wCHgACDgAN/gAR7gAt/AHsAfwB7AH8AewB/AHoAfgB6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH4AegAAAEOBkwEAgFlDBACAOgA=";
export const ROAM_GOLDEN_EXPECT: RoamGoldenExpect = {
  "ok": true,
  "hash": "baa892b2",
  "checkpoints": [
    "bacdb878",
    "7e701b37",
    "adf4a7d6",
    "42550e73"
  ],
  "ticks": 1735,
  "bytes": 608,
  "stage": [
    0,
    9,
    0,
    0
  ],
  "pages": 128,
  "views": 0
};
// </roam-golden-data>
