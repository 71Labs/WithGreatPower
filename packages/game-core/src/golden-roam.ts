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
export const ROAM_GOLDEN_RULESET: string = "roam-3";
export const ROAM_GOLDEN_LOG = "AYSmgHgAxhmFgByHgBqDgACDiCiHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiACDiACHiCwAgBzDiCUDiAcHiAkLiAkPiHgLiAoHiAQDiAL/iAD7iAD3CPMI7wjnCN8I1wjLCMMIuwCzAKsApwCjAJ+AAJuAAJeAAJOAAY+AAosAioAChoAGggCDgA9/gB1+gAJ6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH4AegB+AHoAfgB6AH6AAnqAEXuACXeAAa8AswC3ALsAwwDHAMsI0wjXCNsI34gA4wjniAXriAfniAv/iAD/gA0DAP+ABfuAAfeAAPYA8oAHAAAABgCAHNuIC9+IAduIDteIBtOIAtME04gI14gB04gC14gH24gB3wjjiADniADriALviATziADzAvOIA/eIE/uIDvsE+4gJ94gA84gD74gC64gC54gC44gE34gB24gC14gC0wjPiADLiADHCMMIv4gAuwi3CLMIr4gAqwinCKOIAJ8ImwiXiAGTiACPiAGLiAGHiAGDiAJ/iAJ7BH+IAoOIAoeIAI8IlwinCMMI1wjfCOOIAt8I2wjXiADTCAAAQ4gIR4gCS4gDT4gGS4gDfwiDiAeHiAaLiDCPiCKTiAqXiABDiAU/iAU7iAU3iAYziAYviEYACi+IDjOIKAAKM4gmN4gQAAo3iDgACjeIOAAKN4g4AAo3iBE7iCUACjuIOAAKO4g4AAo7iDgACjuIOAAKO4gTP4gjAAo/iChDCD8IQwg/CEMIPwhDCD8IQwg/CEMIPwhDCD8IQwg/CEOIAT+IF0OIAD8IPwBDgAA/gAAHgAEDgAD/gAD7gAD3gADzgADvgADrgADngADjgADfgALbgAHXgALTgADPgAHLgAHHgADDgAC/gAG7gAW6gAIAAAAGg4hTf4gFe4gGd4gFc4gEb4gCa4gCZ4gBYwhfiABbCFMITwhHCDsAMwAnAB8AFwAPAAsAB4AAA4AA/4AA/gD6gAP2gALygAnzgAsvADMANwA7AD8AQwBHAEsATwBTAFcAW4AAX4AAf4AWfoAGggB+AIIAfgCCAH4AggB+AIIAfgCCAH4AggB+AIIAAABDgZMBAIBZQwQAgDrDgAPHgAPLgAfHgAP7AP+AAQOAAQeAAQuAAA+AAROAABeAARuAAB+AACOAACeAASuAAS+AAjOAAjeAATuAAD+AAUOAAEcAS4AATwBTAFeAAFsAXwBjAGeAAGuAAW+AAm6ABFKAAE6ACFIATgBSAE4AUgBOAAAAP4gnQ4gAP4gAQ4gAP4gAQ4gAP4gAQ4gAP4gAQ4gAPwhHiC5LiAo/iDpPiBNLiBdPiABLiABPiABLiABPiAQ/iARDiAZHiCxXiDpDiDpXiCdbiBEAgHYA";
export const ROAM_GOLDEN_EXPECT: RoamGoldenExpect = {
  "ok": true,
  "hash": "4b1bbf5d",
  "checkpoints": [
    "14e23e00",
    "d4e674cc",
    "bfb054b6",
    "5d5acb23"
  ],
  "ticks": 3270,
  "bytes": 1074,
  "stage": [
    0,
    9,
    0,
    0,
    0
  ],
  "pages": 128,
  "views": 0
};
// </roam-golden-data>
