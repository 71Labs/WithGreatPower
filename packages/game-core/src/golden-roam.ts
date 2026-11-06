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
export const ROAM_GOLDEN_LOG = "AYSigHgAnQ2FgByHgBqDgACDiCiHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiCwAgBzDiCUDiAcHiAkLiAkPiHgLiAoHiAQDiAL/iAD7iAD3CPMI7wjnCN8I1wjLCMMIuwCzAKsApwCjAJ+AAJuAAJeAApOABI+AC4uACIuIDYeID4eAF4oAhgCKAIYAigCGAIoAhgCKAIYAigCGAIoAhgCKAIYAigCGAIoAhgCKAIYAigCGAIoAhgCLAIcAiwCHAIsAhwCLAIcAiwCHAIsAhwCLAIcAiwCHAIsAhwCLAIcArwCzALeAALsAvwDDgADHAPsA/4ADA4AUAoADAAAABgCAHNuIBd+IFOOIH+eIBOuIAe+IAfOIAPeIC/cE94gA+4gI/4gBA4gABwgLCA8IEwgAAEMIR4gAS4gGT4gHU4gYT4gJSwh/CIOIA4eIA4uIA4+IApOIApeIA5uIBZ+IBaOIB6eICquIDK+IJ7OIFAAKs4h6s4AIt4ABtgC+gADCgADGAMoAzgDWAOIA7gD+AAqAAg6AAxKAARaAABoAHoAAIgAmAC6AADIANoAFMgAuABoA5gDKAMIAvoAAuoADtoAEsoADroAAqgCiAJYAYgBGAAAAAAZDiBqDiFh/CIMIf4gAg4gAf4gAg4gAf4gAVwhTCEsARwA/ADcALwAnAB8AGwATAA8ACwADgAD/APuAAPeAAfOAA/cAh4AAg4ADf4AEe4ALfwB7AH8AewB/AHsAfwB6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH4AegB+AHoAAABDgZMBAIBZQwQAgDoA";
export const ROAM_GOLDEN_EXPECT: RoamGoldenExpect = {
  "ok": true,
  "hash": "d062175a",
  "checkpoints": [
    "2869403b",
    "932028f4",
    "56874a90",
    "6353c0a2"
  ],
  "ticks": 1693,
  "bytes": 648,
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
