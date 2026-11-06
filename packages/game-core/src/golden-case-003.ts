/**
 * Case File 003's golden replay ("Fee Strike"): a fixed case-003 log and the result it must
 * replay to, in Node (vitest) and in any browser. It lives apart from golden.ts (the patrol
 * goldens, byte for byte) and golden-case.ts (Case File 001's), so neither ever changes for it.
 *
 * The log is test/golden/case-003-standard.bin with its .json; the block between the markers
 * below is the same data, generated. Regenerate after an intended change to the case's sim (and
 * bump FEE_STRIKE_RULESET):
 *
 *   UPDATE_CASE3_GOLDEN=1 pnpm --filter @wgp/game-core test case-003-golden
 */
import { goldenSave, type GoldenExpect } from "./golden";
import type { CaseGoldenCase } from "./golden-case";
import { fromBase64 } from "./input/log";
import { replayRun } from "./replay";
import { FEE_STRIKE_ID } from "./rules/case-003";
import type { Save } from "./rules/types";
import type { ReplayResult } from "./sim3d/contract";

export const CASE3_GOLDEN_CASE: CaseGoldenCase = {
  name: "case-003-standard",
  note: "Case File 003 cleared by the bot: three clues, the chase to the bakery, Gas Goblin, the meter cooled",
  night: 3,
  hero: "Golden Courier",
  starters: ["web-sling", "web-shield", "wall-crawl"],
  extra: ["web-bomb"],
  loadout: ["web-sling", "web-bomb", "web-shield", "wall-crawl"],
  seed: 0xc0030001,
  policy: "bot",
  chapter: FEE_STRIKE_ID,
};

/** The run-start save (no patrol: a case doesn't need one). */
export const case3GoldenSave = (): Save => goldenSave(CASE3_GOLDEN_CASE);

export const case3GoldenLog = (): Uint8Array => fromBase64(CASE3_GOLDEN_LOG);

/** Replay the case-003 golden from its save and seed. */
export function replayCase3Golden(): ReplayResult {
  return replayRun({ save: case3GoldenSave(), seed: CASE3_GOLDEN_CASE.seed, log: case3GoldenLog() }, { chapter: CASE3_GOLDEN_CASE.chapter });
}

// <case3-golden-data>
export const CASE3_GOLDEN_RULESET: string = "c003-1";
export const CASE3_GOLDEN_LOG = "AYTigGAAlhsLgRYLgAELAQeBCQuBA++BAuuBAueBAucA44AB34AA3wHbgQHXgSvXANOABNMBz4EFy4EOV4AKU4AEUwFTgCJXgARjgQtfgQFbgQBXgQBTAU+BAEsBRwFDAT8BOwE3ATcAMwAvgAArgAEngAAjgAIfgAMbARuAAReAAROAARMBD4EBC4ECB4EBA4EB/4EB+4EB94EB84EB74EA64EA64AA54AB44AB34AB24AC14AA14EBv4EYw4EHx4Egw4EJw4ACw4EDv4ESw4EBw4AEw4EFx4EMy4EKz4EAz4AJz4EH04EJ1wHXgALbgAbXgADXgQjTgQbXgQnbgRLbgAbbgQbbgADXgATTgALPgALLgACrAKsBq4ACp4ABp4EFo4EGn4EFn4ABm4ABm4EEl4EDk4ECj4EAi4EAh4EAg4EAfwF7gQB3gQFzgQFvgR5vAHOABHOBBneBB3uBA3uAAH+ABoOAB4OBJYOABYOBCYOABoOBDYeBBYOBA4OAB3+ABHuAA3eAAnOAAW+AAGuAAGcAZwFjgQBfgQBbgQBXgQBTgQBPAU+AAEuBAkeBA0OBFz+BCjuBID+BBj+ABz+BGT+ACTuBDDeBDTOBLC+BCi+ABS+BAiuBBCsAK4EPJ4EBK4EdJ4EFI4ECH4ECG4EBFwEXgAATgAIPgAELgAIHgQMDgQT/gQ3/gAX/gQn/gAX/gRL/AP+BCAOBAgMAA4Ed/4EB/wD/gQD7gQX3gQXzgQv3gQj7gQP/gQL/gAADgAkDgQ3/gQj/gAb7gAD7gQf3gQb3gAHzgAbzAe+BCOuBCOeBCueAAOOABOOBAt+BCtuBANuABdeAAteBAtuBA9+BA+OBAuOAAOeAA+eBAOuBAu+BA/OBAveBAvuBA/+BAwOBAQeBAguBBA+BBxOBDRMAF4AQFwEXgBsXAReADBOABROBCg+BCwuBBQeBBAOBAv+BAfuAAfeAAPMA74AA6wDnAOMA3wDbANcA0wDPADMALwArACcAI4AAHwAbABeAABOAAA+AAQsAD4AGC4AIB4AXAIAmpoAEAIADpoACAIADpoAAAIABpgAAAKYAAIAcqwKrgA9DgAJDBEOADUeABEcGS4ABAIAFS4AFT4AbTwJPgBBTgDZXgAhbgARfAl+AAmOAA2eAAmuABG8AQ4AS1wHXgATXAdcA1wHTANMB0wDTAdMA0wHPAMsBTwDLAT+ACj8GP4AHI4AKIwIjgA8fgAUbgAMXgAYTgA8PgA4LgAwHgAQHAgeAAQOACf+ABvuABveABvOABu+ABuuACOeAAn8Ae4APd4ACdwJ3gAlzgAPfgAPfBNuABteABNOABM8A+wCfgBofgBAfAh+AB5+AGh+AGp+AF58Cn4AAH4AaJ4Aaz4ARywDPAMsAzwDLAM8AywDPAMsAzwDLAM8AywHLAsuAA2OAEGeAAmuAAW+AAXOAAXeAAXuAAX+AAIOAAIeAAYuAAI+AAJOAAJeAAJuAAJ+AAKOAAKeAAKuAAa+AAIMAh4AEAIALAAIAgFwbARuABReAABcHFwAXARcAEwEAgABbAFuBBF+BCGOBAmeBAWuBAG8BcwF7AYcBlwGzAcMBywHTAdeBANuBAN+BBOOBULuAE7eAAgCAEgCBBTuBDQCBA7uANjuBDwCBCgAHAIGNAbeAM7OAATOBBTcBMwE3ARcBF4AAEwATgQIPgQILgQEHgQADgQH/AfuBAPcB8wHzAO8A6wDnAN8A2wDXANMBywHHAcMBvwG7AbeBALMBrwGrgQCngQCjgQCfgQCbgQCXgQCTgQGPgQCLgQGHAYeAAIOAAn+BAHuBAXeBAHOBAG+BAGuBAGcBZwBjAF8AW4AAVwBTAE8BSwFHAUMBPwE7gQA3ATMBLwErASeBACMBH4EAGwEXgQATAQ+BAAuBAAeBAAMB/4EA+4EA94EA84EA74EA64AC5wDngQHjgQDfgQDbgQDXgQDTAc+BAMsAxwC/ALsAswAA";
export const CASE3_GOLDEN_EXPECT: GoldenExpect & { cleared: number } = {
  "ok": true,
  "hash": "0cdaafae",
  "checkpoints": [
    "2a93345d",
    "1cb79809",
    "82239ea6",
    "f7fffef1",
    "5d8fb2cf",
    "8d2a249c",
    "6ab184c7"
  ],
  "score": 0,
  "ticks": 3478,
  "bytes": 1494,
  "cleared": 1
};
// </case3-golden-data>
