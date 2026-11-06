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
export const ROAM_GOLDEN_LOG = "AYSkgHgA8g+FgByHgBqDgACDiCiHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiCwAgBzDiCUDiAcHiAkLiAkPiHgLiAoHiAQDiAL/iAD7iAD3CPMI7wjnCN8I1wjLCMMIuwCzAKsApwCjAJ+AAJuAAJeAAJOAAY+AAosAioAChoAGggCDgA9/gB1+gAJ6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH6AAnqAEXuACXeAAa8AswC3ALsAwwDHAMsI0wjXCNsI34gA4wjniATriALvCOuIDOcI6wjnCP+IAf+AFPuAAfcA9oAB8oAFAAAABgCAHNuIC9+IAduIDteIBtOIAtME04gH14gC0wjXiAnbiADfiADjiADniADriADviAPziATzAveID/uIF/sE+4gJ94gA84gD74gC64gC54gC44gE34gB24gC14gC0wjPiADLiADHCMMIv4gAuwi3CLMIr4gAqwinCKOIAJ8ImwiXiAGTiACPiAGLiAGHiAGDiAJ/iAJ7BH+IAoOIAoeIAI8IlwinCMMI1wjfCOOIAt8I2wjXiADTCAAAQ4gIR4gCS4gDT4gGS4gDfwiDiAeHiAaLiDCPiCKTiAqXiABDiAU/iAU7iAU3iAYziAYviEYACi8IM4hsL4gGK4gTJ4gCB4gAA4AB/4AB+4AA94AA8wDvgADrAOeAAOMA3wDbgADXANOAAM8Ay4AAxwDDgAC/gAC7gAC3gCC2gAEAAAAGg4gif4iVAYMIfwiDiAB/iACDiAB/iACDiAB/iACDiAB/iACDiAB/iACDiAB/iACDiAB/iACDiAB/iACDCFcIUwhPAEcAQwA7ADMAKwAjAB8AFwATAA8ACwAHAAMA/4AI+wD/AIOABn+ABXuABH8AewB/AHsAfwB7AH8AewB/AHsAfwB7AH8AewB/AHoAfgB6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH4AegAAAEOBkwEAgFlDBACAOgA=";
export const ROAM_GOLDEN_EXPECT: RoamGoldenExpect = {
  "ok": true,
  "hash": "e539196b",
  "checkpoints": [
    "d0cc8a6b",
    "0be40d89",
    "dd1b2b85",
    "017bce6d"
  ],
  "ticks": 2034,
  "bytes": 806,
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
