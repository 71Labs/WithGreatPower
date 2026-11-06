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
export const ROAM_GOLDEN_RULESET: string = "roam-2";
export const ROAM_GOLDEN_LOG = "AYSkgHgA7Q2FgByHgBqDgACDiCiHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiCwAgBzDiCUDiAcHiAkLiAkPiHgLiAoHiAQDiAL/iAD7iAD3CPMI7wjnCN8I1wjLCMMIuwCzAKsApwCjAJ+AAJuAAJeAApOABI+AC4uACIuIDYeID4eAF4oAhgCKAIYAigCGAIoAhgCKAIYAigCGAIoAhgCKAIYAigCGAIoAhgCKAIYAigCGAIoAhgCLAIcAiwCHAIsAhwCLAIcAiwCHAIsAhwCLAIcAiwCHAIsAhwCLAIcArwCzALeAALsAvwDDgADHAPsA/4ADA4AUAoADAAAABgCAHNuIBd+IEuOIH+eIBuuIBe+ICfOIAfME84gG94gD+4gd+wT7iAH/iAMDiAEHiAELiAEPiAETiAQPiAQLiAMHiAEDiAH/CPuIAPcI8wjviADrCOeIAOMI2wjXCAAAw4gBv4gMu4gDg4gGf4gxAAp/iBuDiCaHiAGDCIcIg4gAh4gAg4gAh4gAg4gAh4gAg4gAh4gAg4gAh4gAg4gAh4gAg4gAh4gAg4gAh4gAg4gAh4gAQ4gEP4gGO4glAAo7iDgACjuICz+IPzuIAD+IADuIAD+IADuIAD+IADuIAD+IADuAAD8AB4AAA4AA/4AB+4AB94AB84AL8oABAAAABoOIA3+IMoMIfwiDiAB/iACDiAB/iACDiAB/iACDiAB/iACDiAB/iACDiAB/iACDiAB/iACDiAB/iACDiAB/iACDiAB/iACDiAB/iACDCFcITwhLAEcAPwA3AC8AKwAjABsAFwATAAsAB4AAAwD/gAuDgAV/gAR7gA1/AHsAfwB7AH8AewB/AHoAfgB6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH4AegAAAEOBkwEAgFlDBACAOgA=";
export const ROAM_GOLDEN_EXPECT: RoamGoldenExpect = {
  "ok": true,
  "hash": "5f9e347e",
  "checkpoints": [
    "2869403b",
    "3445f41f",
    "17d63596",
    "6c7ea42e"
  ],
  "ticks": 1773,
  "bytes": 731,
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
