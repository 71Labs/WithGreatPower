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
export const GOLDEN_RULESET: number = 3;
export const GOLDEN_LOGS: Record<string, string> = {
  "night-1-standard": "AQMAhRangRGrgQ+ngQKnAKOAAKMBn4EBm4EBlwGvgRmzgQyzgASzgQ6zgASzgRqzgAazgQivgWCvgAWvgRWvgAWvgQqvgAevgR6rgQKrgAGrgQCngQejgQifgQebgQWXgQWTgQKTgAKPgAyPgQKTgQ6XgQebgQObAJ+AAqOACJ8An4FDn4AAo4AKp4AGq4ADAIAHAIEeO4EGP4EFQ4EDR4EES4EZT4EDT4AMU4AGV4ADWwAAgAIAAgCAAQCBEAAFAIEDy4EDz4EE04ED14EE24EC+4EA94EF84ED74ED64ED54EE44ED34EA3wPfgQHbAduAAteAAdeBEdcA04ACAIAAAIEMcwF3gQN7gQV/gQSDgQaHgQaLgQKLA4sBi4ABj4AGk4AETwFLAUcBQwE/ATsBNwEzAS8BKwEnASOBAB8BG4EAF4EBE4EBD4EBC4EBB4ECA4EC/4EC+4EB94EC84EB74EB64ED54ED44EB34EA24EB1wHTAc8BywHHAcMBvwG7AbcBswGvAasBp4EAo4EAnwGfAJuAAJeAAZMAk4EAkwCPgAGPAYuBA4eBA4OBAn+BA3uBAneBAFuBF1eBAleACVeBBVOBB1OABk+ACE+BEVOBElOAClOBBVeBa1eAEVcBV4A7VwFXgChXgQpbgAZfgAAzgRE3gQI3gAU3ATuBBT+BBzuBADsAN4AAM4AALwArACcAIwAfABsAFwAvAC+BSDOBCS+BECuABCuBECuAAieAByeBCiOBCSOABB+AAB+BHx+AARuAARuBCReABxeBABOBBBOAAg+AAg+BBg+AAROADhMBF4EOG4EHH4EBH4ABI4AGIwEngQQrgQMvgQMzgQI3gQE7gQLvAe+ADe+BBvOBA/OAAfeAAvcB+4EB/4EAA4EABwELgQAPARMB/4EU+4EG+wD7gRL7gAv7gQP3gRD3gAjzgAXzgQbvgQ3vgAPzgADvgAbrgADrgQLngWfnAPeAJvuACf+AAwOAAQMBBwEAgQgAgBYPAAuABQeABgOACP+BDPuBBveBAQCBCQALAIAJrwCzgQG3gQG7gQC/gQHDgQDHgQDLgQDPAc8D04EA14EA24EA34EA44EB54EC6wEAgQMABQCAFzOAADeAATeBAACBEwAAAAEAgADLAMeAAceBAMOBA8MDw4EAw4AAv4AIu4AFAIAQAIEQX4EWW4ECV4EBU4EATwNPgQBLgQBHgQBDAUMAQwE/gQA7gQU3gQUzgQYvgQYrgQUrACsBKwUrgQMAgSAAAwCBWAADAIEKAIAC64AC64EJ74EF84EH94EB84EB7wHrAdsBvwGjAZMBjwGLgQ+PAY+AApOAAZeAAZeBEpuBAZ8BowGnAasBswG/AcsB0wHbAeMB5wHrAe+BAPOBAvOAAveABfcB9wD3AQKLCwAAkgMAAA==",
  "night-4-heavy": "AQMAixf7AfsJ+4EN+4AB94AA84AA7wDrgADnAN8A2wDvgAHvgRDrgQDrgATrgRbrgATrgQrngQHrAeuAHeuBDe+BA+uBB+uABuuBCusA54AI54EE54AF4wHjgADngBPngRfjgQbfgQPfgAzbgCPXgQ3TAWMBYwhjAGeAAEuAFkuBEkeBAkeAD0eBDEuBFEuABE+AB0+BCFOBB1OADVOBAVeBBVuBAVuAAV+AAWuBHWuAAWeACGOABF+AAluAAFeBAFOBAGuBBVuBAFeBAluBAV+BAWMBZ4AAf4AAg4AAgwGHAWuBD2uAAGuBEWsAa4EGb4EMc4EAc4AFcwhzgAB3gAB3gQV7gQd/gQV/AIOABYeAAYeBAouBA4uAAY+AD4+BA48AjwGLgQiHgQaDgQV/gQR7gQB7gAN3gAF3gQBzgQRvgQJrgQJngQJjgQFfgQFbgQFXgQFTgQBTADMAL4AAK4AAJ4AAI4AAH4AAG4ABF4ABE4AED4ACC4ADB4ACA4AC/4EB+4EC94EA84EA74EAAIEJAAAAAQCADACBEDeBADOBAC+BACuBACeBACMBH4EAG4EAF4EBE4EADwEPgAALgQEHgQEDgQL/gQH7gQL3gQHzgQHvgQHrgQHngQDjgQHfgQDbA9sB14EA04EG14EH2wHbBduBA9+BCOOBBOMH4wHjAOOBA+eBBeuBA++BAfOBAfeBAfuBAf+BAQOBAAeBAguBAQ+BARMDE4EBAIFVAAMAgQvDgQK/gQS/AL+BBbuBCLeBALeAA7OAAq+AAasAqwGnAQCBCQAAAAEAgBEAAgCADwCBD9+BAtuBB9eBA9OBAc+BAcuBAceBAMOBAL+BALsBt4EAswGvgQCrAaeBBKOBBJ+BAQABAAMAgRoAAAABAIAATwFLgQBHgAFDgAA/gAE7gAI3gAA3gQY3CTOBAi+BACuBAACBBwCAAuOAAN+AANuAAdcB24EB2wPfgQHjgQHngQAAgQsPBQ8BE4EAF4EABwAPABcAGwAjACcAK4AAL4AAM4EEN4EEO4EDP4ECQ4EBR4EBS4EAT4EBU4EAV4EAW4EAXwFjgQBnAWsBb4EAdwF7AX8BgwGLAY8BlwGfAaMBpwGrgQCvAbOBALeBAbuBAb+BAcOBAsMAx4ABy4ABz4AAzwHTgQHXgQLbgQPfgQLjgQHngQDrgQDvAfMB9wH7Af8BBwELAQ8BFwEbgQCrAauAAaeAA6OAAKMBn4ECm4EBl4EAlwCTgAKPgAWTgAGXgACbAJ8Ao4AApwCrAK8Al4AAl4Ewl4AEl4EFlwCXgQeXgAKXgRCXgASXgQuXgB+XgQqXAJOACY+BBouBCIeBB4eADIOAAoOBHX+BIX+ABn+BF3+AEX8Bf4ALf4ELg4EcgwB/gAb/APuAA/eAAfOAAO+AAOsA5wDjgADfANsA1wDTAM8AywDHgADDAL+AALuAALeAALOAAq+AAquAAaeAAaOAA5+AA5sAGwEbgAQXgAQXgQATgQUPgQULgQQHgQIHgAADgAGDgA0DgAuDgACDgQADgQ0DCwOBGQeBCQuBBw+BBROBBxeBCBuBABsFG4EDG4AGH4ADn4AGIwMjgQcngQQrgQIAgQIAAAABAIAPAIEAf4EAg4EAh4EAi4EBj4EAk4EBl4EBm4EBn4EBo4EAp4EBq4EAr4EAs4EAt4EAuwG/gQDDAccBy4EAzwHTAdcB2wPbAd8B4wHngQDrgQDvAe8A84AA94AA+4AA/4ABA4ACB4ADCwALgQEPgQITgQIXgQwTgQWTgQGPgQWLgQALgQAHgQIDgQADAP+AAPsAAIAOAIEAswGvgQCrgQGnAaeAAaOAA5+ABZuBB5eBBZOBBI8Dj4EEk4EIl4ECm4EBnwEAgQgAgARngQBrgQBvgQFzgQRzAHOBA/eBB/eACfOACe+AB+sA64EEZ4EDY4EDX4ECW4EBV4EAU4AAT4AASwBHgABDAD8AOwA3ADMALwArgAAngAAjgAAfgQEbgQIXgQMTgQSTgQCPgQWPAI8Bj4AAi4AEi4EMh4ELh4AFgwCHAIMAhwCDAIcAgwCHAIOAAIcAgwCHAIMAhwCDAIcAgwCHAIMAhwADAAcAAwAHAAOAAAcAA4EEg4Ebh4EAhwOHgQiLgQePgQGTgQKXgQSbgAKfAJ+BAqOBAqeBAauBAq+BAbOBALeBALuBAL+BAMMBxwHLAc8B0wHXAdsB3wHjAeeBAOeAAeuAA+8A74EJ84EI94EL+4EM/4EAAwELARcBJwEzAT8BRwFLAU+BAVOBAFOAAQLSAgAArQEAAA==",
  "night-9-mixed": "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",
  "night-2-knockout": "AQMAuRhjgQtfgQVbgQRXgQNTgQVXgQFbAV8BYwFrAXMBewGDAWuBAG+BBW+ACm+BGW+AAXOAAnOBCHMAc4EUc4ADc4EEd4ENd4ADd4EPd4AAd4ETd4AJd4EKc4ETc4AEb4AHa4AEZ4ADY4ABK4EMJ4EHI4EGI4ADI4ECH4EHGwAXABcBEwEPAQsBAwH/ARuBCReBBxuBEx+BAh+ABiOAAyOBBieBCiuBAyuABi+ABTOAADOBBDeBDjOBCS+BAiuBAieBACcAI4AEH4AAH4EAG4ECF4EBE4EBD4EBC4EBB4EBAwEDAP+AAPuAAACAsxQBmAIAAA=="
};
export const GOLDEN_EXPECT: Record<string, GoldenExpect> = {
  "night-1-standard": {
    "ok": true,
    "hash": "9a6feeb8",
    "checkpoints": [
      "241040ac",
      "ecce916b",
      "c279d0f9",
      "9a6feeb8"
    ],
    "score": 8925,
    "ticks": 2821,
    "bytes": 1069
  },
  "night-4-heavy": {
    "ok": true,
    "hash": "0e649cfb",
    "checkpoints": [
      "07180621",
      "a743ba16",
      "c43b5918",
      "0e649cfb"
    ],
    "score": 9730,
    "ticks": 2955,
    "bytes": 1723
  },
  "night-9-mixed": {
    "ok": true,
    "hash": "607c0ae2",
    "checkpoints": [
      "d001922b",
      "59cbe488",
      "6efaa469",
      "607c0ae2"
    ],
    "score": 10280,
    "ticks": 3886,
    "bytes": 1881
  },
  "night-2-knockout": {
    "ok": true,
    "hash": "2a3bcc6f",
    "checkpoints": [
      "a0f054bf",
      "2a3bcc6f"
    ],
    "score": 4325,
    "ticks": 3129,
    "bytes": 244
  }
};
// </golden-data>
