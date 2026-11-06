/**
 * The time trials' golden replays: per course, a fixed log (the course designer's best run,
 * which sets the course's dev time) and the result it must replay to, in Node (vitest) and in
 * any browser. It lives apart from golden.ts and golden-case.ts so neither the patrol goldens
 * nor Case File 001's ever change for a trial.
 *
 * The logs are test/golden/trial-<course>.bin with test/golden/trial-<course>.json; the block
 * between the markers below is the same data, generated. Regenerate after an intended change
 * to the trials (and bump TRIAL_RULESET):
 *
 *   UPDATE_TRIAL_GOLDEN=1 pnpm --filter @wgp/game-core test trial-golden
 */
import type { GoldenExpect } from "./golden";
import { fromBase64 } from "./input/log";
import { replayRun } from "./replay";
import { trialSave } from "./rules/compete";
import type { Save, TrialCourseId } from "./rules/types";
import type { ReplayResult } from "./sim3d/contract";

/** The run-start save every trial golden races from. */
export const trialGoldenSave = (): Save => trialSave({ name: "Golden Racer", suit: "midnight" });

export const trialGoldenLog = (course: TrialCourseId): Uint8Array => fromBase64(TRIAL_GOLDEN_LOGS[course]);

/** Replay a course's golden from its save. */
export function replayTrialGolden(course: TrialCourseId): ReplayResult {
  return replayRun({ save: trialGoldenSave(), seed: 0, log: trialGoldenLog(course) }, { trial: course });
}

export type TrialGoldenExpect = GoldenExpect & { finished: number };

// <trial-golden-data>
export const TRIAL_GOLDEN_RULESET: string = "trial-1";
export const TRIAL_GOLDEN_LOGS: Record<TrialCourseId, string> = {
  "rooftop-sprint": "AYSChD0A6QMDgQADgEsDgQADgAIDgQv3AAMB+wD/AAOAAAeABQOAF/+ABAMB/wADgQQbgAAfgAAjAAeBCw+AAAOAJfuAAgMB+4AB94AAA4AG/4AEAwEDAAOBCP+BKveABC+AATOAAzeAATuAAT+AAEMAR4AASwBPAL+AAL8B04AB1wDzgAjvgBC/gQHzABOAABeAABOAAReABhuAAAcAC4ABtwG3gA63gR23AO+ABg+BAguBBbeAA7eBAUeBAQOBAv+BAdsA14AC04AA84EM4wDfgALbAAA=",
  "bridge-run": "AYSEhD0AkwODgByDAYOABX8Ag4EAf4ECe4EBd4EBc4EBb4EAbwBbgABXgABngQFjgQFfgQFbgQFXgQFTgQFPgQFLgQFHgQFDgQA/gQE7gQA3gQEzgQAvgQArgQAngQAjgQAfgQAbAReBABMBDwELAQcBg4EAh4EDi4EEh4EOg4EGf4EEe4EEf4ELg4AEfwGDgAB/gCCDAH8AgwB/AH+BC4+AA5MAfwGTgACXgAGbgACPgAGTgAKXgAibAIeAAoOAIn+BASOBBoOBA4eBMIeAAIuAA4eABIsAhwCLgACHAIsAh4AFAA==",
  "canyon-swing": "AYSGhD0AxALXAdeAAdeBF9eAA9eBCbeAALuACrOAAK+AAssBq4ACp4AEw4EAv4EAuwG3AbMBqwGfAcMBv4ECv4ACt4ABs4ADr4ACq4ABp4AAo4AAnwCbAJcAkwD7AP+AAQOAAN8BB4ABC4AAD4AAEwDzAfeBAPsB/wEDAQcBCwArAC8AK4ADJ4AEI4AC64AH54AF44AB34AB24AA1wDTAM8A/4EE6wDvAPOAAPcA/4EE/wD/AQOBAAcBCwEPATsAJwAHgAALAB+AAQuAAR+AAhuABBeABRuABR+AAiOAACcAKwAzADsASwBrAIMAi4ABj4ATk4AEj4AFh4ACg4AJh4ABi4AIbwGvALMAAA==",
  "tower-climb": "AYSIhD0A6APfgQ7bgQXbgAbbgRrXgQLTgQHPgQDLgQHHgQDDgQG/Ab+AALuAAreAAbOAAq+AAa8Bq4ECp4ECo4ECn4EKo4EDp4EBq4EBr4EAswGzAMcAy4ABz4AB04ABw4EAx4ECy4ECz4EC04EC14EC24ED34EC44EC54EC64ED74ED84EH94Ea64AD54AD+4AG+wH/gAL/gQMPgAX/gQEDgQYHAQeAAgcBC4ECD4EBE4EBF4EAG4EAH4EAI4EAJ4ECKwFHgAJLgANPgAM7gQE/gQFDgQFHgRdPgAZDgQpDAD+BDTeABDuBEwuBAfeABPOABAsB7wALAQOAEAeABAsBA4EWB4AEAA==",
  "gauntlet": "AYSKhD0A3AgDgQADgD4DAQOABgOBAgMAA4EPA4AzPwBDAEOBAFsAVwBTAEsARwA/ADsANwAzAC8AKwAnAD+BACMAH4ABG4AAF4AAEwAfABsAKwErgAAngAUjACOBHA+ACxOAAxcAHwEXgAEbgBUfgAUbgAkXgAIbgAAXAFcAWwBbgQ5bgApfgAFfgQM/gSY/gAY/gRI/gBQ/gQVTgQJTAFOBCFOAM1OBDVOADI+BJo8Aj4EEj4ANq4AApwCPgBq7gAO/gBO7gAajgASvgQOzgQHLAKMBo4AGw4EBx4ECy4EAzwHTAeMBLwFDAUcBS4EAT4EAU4ECV4EBW4EBX4EBa4ABb4AFc4AJd4AMb4AFc4AEc4EJd4EAh4ABg4AZhwCbgAifgASjgACPAaMAp4AAk4ABl4ADm4ALhwGDgQNrgARngAVjgABfgAF3gAdfgARbgBFXgAtbgAJfgAVjgA13AVsAV4AAUwBPAEsARwB3gAabgASXAHcAh4ACk4AAj4ATk4AFl4ADm4AAn4AAowCnAK8AtwDHAN8A8wD/AAOAAAeAAQuAEQ+AAYeAAguBAg+BAhOBBA+BLROBARuAAB+ABAA="
};
export const TRIAL_GOLDEN_EXPECT: Record<TrialCourseId, TrialGoldenExpect> = {
  "rooftop-sprint": {
    "ok": true,
    "hash": "0c140e44",
    "checkpoints": [
      "3e78d172",
      "a787213f",
      "cc696318",
      "becb742c",
      "61e1bc7e",
      "0c140e44"
    ],
    "score": 0,
    "ticks": 489,
    "bytes": 215,
    "finished": 1
  },
  "bridge-run": {
    "ok": true,
    "hash": "1f9742e9",
    "checkpoints": [
      "e76ac9a7",
      "dd62f83e",
      "73323051",
      "e823451a",
      "36fe3501",
      "1f9742e9"
    ],
    "score": 0,
    "ticks": 403,
    "bytes": 229,
    "finished": 1
  },
  "canyon-swing": {
    "ok": true,
    "hash": "bcb23670",
    "checkpoints": [
      "9a5bba03",
      "7138fd59",
      "3ec4030e",
      "baf632a8",
      "8baa421c",
      "bcb23670"
    ],
    "score": 0,
    "ticks": 324,
    "bytes": 268,
    "finished": 1
  },
  "tower-climb": {
    "ok": true,
    "hash": "3311386c",
    "checkpoints": [
      "44d96e5b",
      "bf10b054",
      "a6ad7bf3",
      "3311386c"
    ],
    "score": 0,
    "ticks": 488,
    "bytes": 265,
    "finished": 1
  },
  "gauntlet": {
    "ok": true,
    "hash": "af06c53b",
    "checkpoints": [
      "9f5ce2e6",
      "8b6932a2",
      "8db304a3",
      "9cefde3f",
      "34fd55ae",
      "c0d54c3f",
      "af06c53b"
    ],
    "score": 0,
    "ticks": 1116,
    "bytes": 449,
    "finished": 1
  }
};
// </trial-golden-data>
