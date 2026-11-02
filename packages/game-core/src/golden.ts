/**
 * Golden replays: fixed input logs and the hashes they must produce, so any drift in the
 * sim, the city, the engine or the scoring shows up, in Node (vitest) and in every browser
 * (/lab/determinism, checked by Playwright on Chromium, WebKit and Firefox).
 *
 * The logs live in test/golden/<name>.bin with test/golden/hashes.json; the block between
 * the golden-data markers below is the same data, generated, so the browser can import it.
 * Regenerate all three after an intended change (and bump RULESET_VERSION):
 *
 *   UPDATE_GOLDEN=1 pnpm --filter @wgp/game-core test golden
 */
import { fromBase64 } from "./input/log";
import { replayRun } from "./replay";
import { newSave, reduce } from "./rules/engine";
import type { PowerId, Save } from "./rules/types";
import type { ReplayResult } from "./sim3d/contract";

export interface GoldenCase {
  name: string;
  /** What the case covers. */
  note: string;
  night: number;
  hero: string;
  /** The three starter powers picked at sign-up. */
  starters: PowerId[];
  /** Powers granted on top (as level-ups would), and the loadout taken on patrol. */
  extra: PowerId[];
  loadout: PowerId[];
  /** The server-issued seed for start-patrol. */
  seed: number;
  /** How the log was played: the bot throughout, or the bot idling once a fight starts (a knockout). */
  policy: "bot" | "idle-in-fights";
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  {
    name: "night-1-standard",
    note: "a first night with the starter powers",
    night: 1,
    hero: "Golden One",
    starters: ["web-sling", "web-shield", "wall-crawl"],
    extra: ["node-sense"],
    loadout: ["web-sling", "web-shield", "wall-crawl", "node-sense"],
    seed: 0x5eed0001,
    policy: "bot",
  },
  {
    name: "night-4-heavy",
    note: "level-2 villains, web bomb, validator slam and front-run",
    night: 4,
    hero: "Golden Two",
    starters: ["web-sling", "web-shield", "node-sense"],
    extra: ["web-bomb", "validator-slam", "front-run"],
    loadout: ["web-sling", "web-bomb", "validator-slam", "front-run"],
    seed: 0x5eed0004,
    policy: "bot",
  },
  {
    name: "night-9-mixed",
    note: "level-5 villains, Fork, ZK cloak and gas refund",
    night: 9,
    hero: "Golden Three",
    starters: ["web-sling", "yank", "finality"],
    extra: ["fork", "zk-cloak", "gas-refund"],
    loadout: ["web-sling", "fork", "zk-cloak", "gas-refund"],
    seed: 0x5eed0009,
    policy: "bot",
  },
  {
    name: "night-2-knockout",
    note: "standing still in the first fight until knocked out",
    night: 2,
    hero: "Golden Four",
    starters: ["web-sling", "web-shield", "wall-crawl"],
    extra: [],
    loadout: ["web-sling", "web-shield", "wall-crawl"],
    seed: 0x5eed0002,
    policy: "idle-in-fights",
  },
];

/** The run-start save for a case (the patrol not yet started: replay starts it from the seed). */
export function goldenSave(c: GoldenCase): Save {
  let s = reduce(newSave(), { type: "create-hero", name: c.hero, suit: "classic", powers: c.starters });
  const hero = s.hero!;
  const powers = { ...hero.powers };
  for (const p of c.extra) powers[p] = powers[p] ?? { mastery: 0 };
  s = { ...s, night: c.night, hero: { ...hero, powers, loadout: c.loadout.slice(0, 4) } };
  return s;
}

export interface GoldenExpect {
  ok: boolean;
  hash: string;
  checkpoints: string[];
  score: number;
  ticks: number;
  /** Log size in bytes. */
  bytes: number;
}

/** A case's log as bytes. */
export function goldenLog(c: GoldenCase): Uint8Array {
  return fromBase64(GOLDEN_LOGS[c.name] ?? "");
}

/** Replay a case's log from its save and seed. */
export function replayGolden(c: GoldenCase): ReplayResult {
  return replayRun({ save: goldenSave(c), seed: c.seed, log: goldenLog(c) });
}

// <golden-data>
export const GOLDEN_RULESET: number = 2;
export const GOLDEN_LOGS: Record<string, string> = {
  "night-1-standard": "AQIAhCcAgT0AgAQAgcEBAIA/AIHKAQCABQCBGgCABQCBQQCARwCBDgCAMQCBGQAAAIEly4EAz4EC04EA14EA24EA34EA4wHngQDrAe8A84AA9wD7gAD/AAOAAAeAAAuAAQ+AABOAAheAARuAAx+ABR+BACOBBieBAiuBAS+BADOBADeBADsBOwA/gQBDgQFHgQBLAUsATwFPAE8BUwBTAVcAV4EAW4ECW4AGX4AIY4ADZ4ACa4ABbwAAgBK3ALuBAL8BwwHHAcsBzwPTgQDXgQDbgQ/bBdsB34EY94EU84EO74EB7wPvgQXrgQjjgRzjgAbfgAbbgAPXgAPTgAHTAc+BAsuBAseBAsMBwwPDAb+BAbuBAbeBAbOBAK+BAauBAKeBAKOBAZ8AAIANAIHiAQCABQCBXwCAEwCBHwAAAIFaAIAGAIENAIAFAIFbAIAEAIEkAIAGAIFXAIAbAIEXAIAGAIEvAAAAgSYAgAUAgRYAgAUAgVsAgAYAgSUAgAUAgVgAgAUAgRMAgEwAgWwAgAUAAQCACACBUgCABQCBKEOBXwCBBgAAAIE8AIAGAIEtAIAyAIEsAIAAAIFvAIAJAAEAgBkAgTAAgAcAgScAgAOzgASzgTKzgAmzgRoAAQCABQCBBQCABQCBBACABACBRgCABQCBjgEAAACBMwCARQCB8wEAgAoAgUwAgAUAgR4AgDUAgTMHgQAHgAILgAIPgAITABOBAheBAhuBAh+BAB+ACiOACCeABCuABS+AAC+BAjOBAzeBCzOBBjMAM4EPM4ACL4AHK4ADJwAAgA4AgQYACwCBHAADAIETAAUAgRrHgQHHgADHgQPDgQW/gQO7AQCBDwADAIEzAAAAAYOBAH+BBHuBBneBBXOBBW+BA28Db4EDa4ECa4AEZ4AFY4AMAIAGAAFjgQtngQQAAWeBBACBEQADAIEGp4EAq4EBr4EBq4EKp4EOAIEQAAUAgRkAAwCBBQCABgCBRACABQCBLALuDgAAngkAAA==",
  "night-4-heavy": "AQIAhB8AAQAJAIEPAIAVAIEsAIAFAIFLAIAZAIEVAIAOAIEmAIAFAIEvAAkAgSAAgFsAgRUAgEgAgUEAgAAAgUIACACAGACBBgCACgCB2wEAgAUAgQI7gTI7CTuBATuAEDuBAzuAEACBMwAAAIEhAIA9AIE8AAAAgUUACQCBKwCAEACBSgCAAwCBHwCACACBDQCABwCBCQCABwCBYQAJAIErAIAFAIEnAIAAAIEdAIAAAIEgAAAAgSw3gQI3ADOABC+AAiuAAQCAEwCBC+MB34EH24EH14FU1wPXgQ3bgQTbBdsB34EB3wDfgQPjgQMAgRcAgBIABgCABQCBAAAAAAEAAAABAwADAQMAAwEDgAH/AP8C/wD/gQX7gQf3gQH3gALzgAPvgALrgALngAHjgADfgADbgADXgADTgADPAMsAxwDDAL8AuwC3ALOAAK8Aq4AAp4AIo4EEn4EEm4EElwOXgQWTgRCXgQGbgQGfgQKjgQOngQSrgR+ngQWjgQKjA6MBn4EHo4EAAIFEAIA3AIGGAQCABQCBDQCABQCBLQCABgCBHQAAAIEtAIAFAIFGAIA5AAgAgAAAgR0bgQAXgQETgQAPgQALgQAHgQADgQD/gQD7gQD3gQHzgQLvAW+BBGuBAW+BBXOBBneBPXeAIXOABHMB8wHzC/OBBu+BAeuBAeeAAOOAAN+AANsA1wDTAM8AywDHAMOAAL8AuwC3BLOAAK+AAKuAAKeAASMAI4EAHwEfgAAbgAIXgAAXAhcAE4AAEwETABMBD4AADwEPAAsBCwALAQsABwAHAQeAAAOAAf+AAfuAAfeAAfOAAe+AAeuAAeeAAuOAB+MG44AC34EC3wDfAd+ABd+BDd+AAtsIAIAFAIEJ14EA04EAz4EBy4EBx4EBw4EBv4EBu4EBt4EAs4EAr4EAq4EAp4EAo4EAn4EBm4EAl4EBk4EDj4EFi4AIB4AQA4AVAwIDgB3/gDX7gAL7AvuAAACAE2MAWwBXAE8ARwA/ADcAMwArACeAAiuABS+AAC+BBCuBESeBBiOBBB+BBBuBBRcBl4EDk4EAE4ECD4EFC4EGB4FABwAHgQeHgRkHgQILgQOLgQqPgQsPgQCPA4+BApOBGJeBCJOBD4+BB4uBBIuAAIuBDI+BAI8Dj4EMk4EEAIEKAIAGAIE3AIAHAIElAAAAAQLlAwAA4gUAAA==",
  "night-9-mixed": "AQIAkC8AgaoBAIABAIEwAIAIAIGQAQCABQCBUgCABgCBIACAXQCBFgCAEACBMACACQCBTQCABQCBLAAAAIEgAIAFAIEmAIAxAIFJAIANAIEZAIAHAIEuAIALAIEFAIAKAIE3AIAGAIEtAIB6AIEei4EIh4EAgwF/AXsBbwFjAVMBRwE7ATcBMwEvgQArgQErACuBASeBCyeABKcBpwCnAauBBK+BBLOBBbeBBLuBBb+BBcOBBceBBkcBS4EZR4EQQ4ECQwVDgQQ/gQG/gQU/gRM7gQA7gAS7gAO7gQM7AT+BIr8Bu4EKO4EKu4EGt4EAN4EHtwO3gQKzgQevgQargQOngQSjgQCjAKMBn4EBm4EAAIEFAIAMAAEAgAQAgRMAAwCBFa+BA6uBBaeBCqOBA6eBBKOBAJ+BAJsBl4EAkwGPAYsBh4EAgwF/AXsBdwFzAW8BawFnAWOBAF8BW4EBV4EBU4EDT4EQS4EDR4EFQ4ECP4ECO4EAN4EBMwEvgQArgQAnASMBH4AAGwAXABOAAA8AC4AAB4AAA4AA/wD7gAD3gABzA2+BAGsBZ4EAYwFfgQBbAVeBAFOBDleBCluBBF+BAmOBAWeBAACBDACABKsAr4AAs4ABt4ADu4ADuwK/gAzDgAdDgADDgA7HgA1HgBvHgALHBMeAFMuAAUuAF8uADEuADcuAAcuBAEuBAU+BAlOBAleBAluBAV+BAWOBAWMAZ4ABa4ADb4AGc4AEd4AAdwZ3gAJ7gAh/gAiDgAMDAgOABAeABACBbACABQCBIQCABQCBSwAAAIEFAAAAgQYAAACBDQCABQCBGACABQCBKgCABgCBFgCABgCBEwCABQCBKACABgCBBwCABQCBGwCABQCBOgCABQCBQACABgABAIAJAIFKAIAaAIEfAIAFAIGMAQCABQCBVwCABQCBHwCABQCBTQCASwCBCACAKgCBQQCABwCBHACATQCBFACABgCBBwCABQCBIQCABQCBqQEAAACBKQCABQCBPwCACwCBYwCABQCB5wEAAACBFwCACwCBOACACACBDACABgCBBACABgCBLtuBAN+BBuOBAt+BA9sBAIELs4EAr4EGs4ECt4EEu4EIv4EDw4ECx4EBy4EBz4EB04EC1wDXgQDbgQLfgQLjgQLngQLrgQLvgQLzgQL3gQL7gQH/gQIDgQEHgQELgQEPgQETgQEXgQAbgQEfgQAjgQEngQArgQEvCy8BM4EDN4EFO4ECP4EDQ4EDR4EBRwNHAUuBBE+BA1OBBFeBAVcFV4EBW4EPWwBbBluABluBBV+BAQCBAwCAAAABAAAAAQAAAAEAAAABAAAAAQCABgCBAgADAIEG8wH3gQH7gQL7gAH/gAP/gQH7gQX/gQAAAQAAAAEAAACBCEeBAEuBAU+BAlOBBk+BDFOBAleBAVuBAFsDX4EAY4EAZ4EAa4EAb4EBcwFzgAB3AXcAdwF7AHsBewB/AX+AAH8Bg4AAg4EEf4ECf4ACe4AEd4ADc4ACb4ACa4ACZ4ACY4ABX4ABW4ABV4ABU4ABT4AAS4ABR4ABQwJDgAA/gAE7ATuAATeAAjOAAC8BLwAvgQAAgQcAAAABAIADAAEAAH8AfwF/AH8BfwB/AX8AfwF/gAWDgAEAgSEAAwCBNQAAawBvgAFvgRIAgQgAAwCBH+8B84EC94EE+4EA+wD7AfuACfuBCfeBDfOBAvcB9wP3gQEAgSgTgQEPgQILgQIHgQIDgQH/gQL7B/uBAveBAvOBBe+AA+8B7wnrgQTngQ3nA+eBAeOBCd+BA9uBANsF14ED04EBz4EBy4EBx4EBw4EEv4Ecu4ENuwO7gQAAgVYAAwCBIwCAEwCBHgADAIEhAIAFAIFHAIAGAIEMAsQHAADlFAAA",
  "night-2-knockout": "AQIAnxYAgWkAgAUAgT8AgAcAgQ0AgAcAgaQBAIAFAIElAIAFAIEhAAAAgUMAgAoAgTIAgAkAgTIAgAYAgaIBAIAFAIEiAIAAAIFbAIAIAIEzAIAHAIE0AIAFAIEfAICqDQGkBQAA"
};
export const GOLDEN_EXPECT: Record<string, GoldenExpect> = {
  "night-1-standard": {
    "ok": true,
    "hash": "462dc0c6",
    "checkpoints": [
      "4c6393b9",
      "c5aeb9be",
      "ff2710b3",
      "462dc0c6"
    ],
    "score": 7960,
    "ticks": 4996,
    "bytes": 760
  },
  "night-4-heavy": {
    "ok": true,
    "hash": "1cc4e543",
    "checkpoints": [
      "eb636728",
      "ad813d6a",
      "8019ab34",
      "1cc4e543"
    ],
    "score": 8270,
    "ticks": 3972,
    "bytes": 901
  },
  "night-9-mixed": {
    "ok": true,
    "hash": "f8e88306",
    "checkpoints": [
      "81d20bda",
      "c9851655",
      "573d0575",
      "f8e88306"
    ],
    "score": 9865,
    "ticks": 6032,
    "bytes": 1422
  },
  "night-2-knockout": {
    "ok": true,
    "hash": "ff1b8529",
    "checkpoints": [
      "e20b037b",
      "ff1b8529"
    ],
    "score": 3965,
    "ticks": 2847,
    "bytes": 102
  }
};
// </golden-data>
