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
export const GOLDEN_RULESET: number = 1;
export const GOLDEN_LOGS: Record<string, string> = {
  "night-1-standard": "AQEAwDcAgUoAAACBuQEAgAAAgacBAAAAgRkAgAUAgRgAgAQAgR4AgAUAgVUAgAQAgTgAAACBIwCABgCBDwCABgCBBACAAACBCACACACBAwCACAABAIAHAIFhAIANAIFiAAAAgRpzgQFvgQBrgQBnAWOBAF8BWwFXAVMBTwFLAUcBQwE/AT8AOwA3gAAzgAEvgAIrgAMngAEngQQrgQYvgQIzgQI3gQA7gQA/gQBDgQBHgQBLgQBPAVOBAFeBAFcAW4AAX4ABY4AHX4AKW4AHV4ADUwAAgAcAAQCADueAAOOAAd+AAduAAtsC1wHbgQjfgQPjAQCBAgAFAIAMA4AAB4ACC4ACDwAPgQETgQIXgQATgQIPgQILgQEHgQIAgREAAwCBFmuBA2+BBnOBB3eBBgCBCQCACgCBqwJXgR5XAFeBJFeACVcBV4AJV4EBAIGHAQCAAACBPIeBHIeAD4eBH4eADIeBAIcAAIAEAIEJAIAIAAEAgAcAgTQAgAYAAQCACgABAIADAAEAAAABAAAAgacBb4EYb4AVb4EuAIHPAZuBN5uADZuBFwCBcQAAAAEAAAABAAAAAQAAAIEGAAAAAQAAAIFkAAAAAQAAAAEAAAABAAAAAQAAAAEAAACBRXeBA3eACneBTgCBVQAAAIGTAQCAAQCBcAAAAIFJAIAEM4AIM4FVAIFVAIAFL4AEL4E8LwAvgRoAgQAAgAUAgRcAgAUAgR0AgBoAgc8BS4E6SwBLgSIDgQUDgAADgQYDgAsDgQkDgAsDgRQDgAgDgQkAgcsBAIACAIEsAIAEAIEIAIAFAIEYAIAFAIEFAIAEAIHwAQeBIQeABQeBNQCBrAH/gRX/gA3/gSv/gAH/gQkAgScAgAgAgQ0AgAYAAQCACgABAIADAAEAAAABAAAAgWsAgBMAgSRDgV8AgcwB/4EE/4AH/wH/gAD/Af8A/wH/AP8B/wD/gUcAgRQAAAABAAAAAQAAAAEAAACBHwCAFACBSwAAAIEp+4Ej94EPAIEP+4ED/4EMA4EJBwEHgA4HgQMLgQgPgQgAgQQAAACBBQALAIETy4EBz4EA04EC1wPXgQLbAdeBCNOBBM8Fz4ECy4EEx4EEw4EGv4EGu4EFt4EHs4EEAIEMAAMAgQangQAAgS9/gQB7gQIAgQAAAAABd4ECc4EFb4EFa4EBawNrgQNvgQtzgRFvgQIAgQlfAVuBA1eBDluBB1+BAQCBAgADAIEdAIAIAAFjgQcAgQsABQCBFwADAIEbn4EFo4EFpwEAgQmvgQizgQS3gQK7gQG/gQHDgQHHgQHLgQDPAc8DzwHTgQDXAdcA24AB34AA44AB54AB64AA74AB84AB94ABAIALAAEDgQAHgQULgQYAgQoTgQMAgQUXgQMAgQEAAwCBAheBAwCBBReBAwCBDwAAAIFsAq4YAACQCgAA",
  "night-4-heavy": "AQEAhiwAAQAJAIENAIAKAIGhAQCABACBpQEACQCBBQCADACBCACACgCBGAAAAIFfAAAAgTIAgAYAgUkAAACBGgAJAIAMAIGcAVOBXxOBBhOAAROBIxOABROBEhMIE4AEE4EBE4AFEwETgAIAgAIAgTcAgAYAge4BAAkAgQ8AgAwAgWwAgAAAAQCAAAABAAAAAQAAAIEGAAAAgVoAgA4AAQCAAQABAAAAgTcACQCACwCBxgFPgThPgBNPgQVPgAmPgBKPCI+AEI+BEY+ADI+BFwCBMQCABgCBBACABgCBBACADACBKACABACBIQCABQCBGQCABgCBGACABgCBAAAJAIEOAIALAIEFAIADAIFDAAAAgT0AgAQAgR4AgAUAgQwAgAUAgQkAgAUAgRIAgAUAgREAgAUAgSYACACABwCBNACADQCBUwCAC4eAEYeBMIcAh4EZAIE3AAkAgQMAgAgAgQAAgAgAgSUAAACBMU8BU4EEV4EEW4EKV4EFU4E8UwBTgQ0AgRYAAwCBEwAFAIETAAcAgQ8AgA0AgSAAgAUAgRAAgAQAgV4ACQABAIAMAIEuAAAAgTYAgAcAgUAAgAcAgRwAgAQAgUEAgAMAgRAACQCAEQCBOQCACwCBswGXgROXgBSXgTQAgQkACQCBAwCAEwCBLQCABACBrgHXgRfXgDDXCNeAE1eAAVeBAleACleBLFeACleBDFeABACAAACBJwAAAIE7AIASAIEBAIAXAIEJAIAJAIEjAAkAgBAAgSZzgQVzgAFzAZOBAZeBBBeBAhuBBR+BAyOBASeBACcAK4EAL4EAMwA3ATsAPwFDAEcATwBTAFcAW4AAXwBjgABngAFrgAFvgANvgQBzgQHzAfOAA/eAD/OABfOBBXOBAG+BBWuBA2eBAWOBAF8BXwBbAVsAVwFTAE8BSwBDAT8ANwEzAS8BKwEngQAjAR+BARuAAxeAA5eAAJOAApcKl4AEm4ABG4AAH4ADI4ADJ4ADK4ACKwQrAC+AAS+BADOBCbOBALeBALcDAIE0o4EAn4ECm4EDl4EElwmXgQCbAZ8BAIEIAIAB64AA74AA7wLzgADzAfMA8wHzAPOBDfMHc4AIb4Eh74Ee84EBc4EP8wP3gQv7gQEAgQYAgCZzgAtzgQNvgQNrgQFrA2cBAIEHc4ENc4AFc4EIc4AHc4ErAIEbAAAAgQkC8QgAAPcJAAA=",
  "night-9-mixed": "AQEAszsAgYECd4FZd4ADdwF7gQp7gAB7gQh7gAB7gSJ7gAZ7gQZ7gAh7gQcAgUQAgAEAgQ0AgAEAgR3zgV/vgQXvgFh3gAh3gQ53AHeBCXcAd4EYd4Ae74E474AH74EQ74AK+4AB+4EF+4AL+4EO+4AQ+4ES+4AK+4EGAIEnAIANAIEdM4EfM4AJMwEzgA0zgRAzADOBBjOABzMBAIEPAIAHAIETAIAHAIETAIAHAIEFAIAGAIEBAIAGAIG2AQAAAIEHAIAFAIHVAQAAAIFmAIADAIE5AIAAAIHUAQAAAIEXAIAFAIFOAIAEAIG0AQCAEACBMwCADQABAAAAgXbjgRTjgBbjgS3jgAIAgAAAgRsAAACBKwCABQABAIAHAIEnAAAAgREAAAABAAAAgRUAAACBSACAGgCBI3uBAneBAXMBb4EAawFjAV8BWwFTAUsBRwE/ATsBNwEzATMAL4AAK4EBJ4EAJwAnASOBBB8AHwEjgAAngAErgAIvAK+AALOABbeABbeBArOBBi+BBCuBAieBAiOBAB+BARuBABeBABMBEwAPgQALAQeBAAMA/4EA+wH3gQDzAe+AAOuAAOeAAOOAAd+AAduAA9eAAVeAAlOBCE+BB08FTwFLgQQAgRRHgQQAgQZHgQQAgQZHgQTHgQLLgQZLgQTLgQTPgQfTgQXXgQXbgQTfgQbjAeOABeeAAmcCZ4ABa4ACa4EBb4EEc4ECd4ECe4EAAIE+AANrgQBngQFjgQJfgQNbgQNXgQLXgQDTgQXPgQvTgQHXgQPbgQPfgQHfAOOAA+eABeuAAOuBBeeBCeOBBt+BBduBBdeBBNOBBc+BBMuBBMeBBcOBBr+BAj8DP4ECAIEZh4EEg4EFf4EEe4EDd4ECc4ECb4EBa4EBZ4EAYwFjgABfgABbgABXgABTgAFPgAFLgAJHAkcAAIAOAAE/gQO/gQ67gQW3gQazgQWvgQSrgQOngQKjgQOfgQKbgQKXBZeBAJOBAo+BAouBAoeBAoOBAX+BAnuBAneBAnOBAm+BAmuBAmeBA2OBAl+BBFuBBl8BXwdjAWcBZwBrAHMAdwB7AIMAhwCPAJMAlwCbAJ+AAKOAAKeAAquAD6uBKKeBASeBCCcDJ4ELI4EBAIETAIAHAIFfAIAAAIGYAQAAAIEwAIADAIE2AAAAgUEAgA0AgekBr4EDr4AFrwGvgAOvgSuvgAyvgRIAgRoAAAABAAAAAQAAAAEAAAABAAAAgaoBAIABu4ADuwG7ALsBuwC7gVW7AACAAAABAIADAAEAgAIAAQCAAQABAAAAAQAAAAEAAAABAAAAgT63gRW3gA+3gR63gAG3gRQAgREAgAYAgRMAgAUAgSEAAACBHwCABACBfgAAAIHWAW+BH2+ACW+BAm+AAW+BLACB5AEAAACBhQEAAACBMQAAAIErAIAEAIEPAIAFAIEMAIAFAIEpAAAAgSAAgAYAgRsAgAUAgRYAgAUAAUuBAkeBBEOBBD+BBTuBADuABDeABDeBADOBBC+BBSuBBieBBgCBVwALAIEcAAMAgRMABQCBEwAHAIEEb4EBc4ECd4EDe4ECf4EDg4ECh4ECiwGLAIuBAY+BApOBAJMDkwGXgQObgQWfgQSjgQOngQKrgQGvAQCBClsBV4EEU4EAV4ESW4EPWwNbgQBfgQpjgRxjAF+ABgCAIACBAQADAIFH04EA14EB24EA34EB44EB3wEAgQEAAwCBMAAAAIEaO4EFN4ECNwM3gQIzgQk3gQAAgSuDgQR/gQN7gQF3gQFzgQBvgQBrgQBnAWMBAIEBAAMAAVMBT4EBS4ECR4EDQ4EEP4EEO4EEN4EDM4ECAIALAIELAAcAgQoAAAABAAAAAQAAAAEAAACBAAAJAAAAAQAAAAEAAAABAIANAAIAgBMABAAAAIFBAAMAgX0CtwwAAIEeAAA=",
  "night-2-knockout": "AQEAohwAgZ4BAAAAgSAAgAQAgRsAgAQAgRgAgAUAgRIAgAYAgQ4AgAcAgbkBAAAAgRkAgAUAgRcAgAQAgaYBAAAAgV0AAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAgc8BAIADAIEXAIAFAIGyAQCAAACBFACABACBDwCABACBCQCAAQCBPACABQABAIAHAIFCAIAJAIE7AIACAIG/AQAAAIF5AIAEAIE3AIAAAIErAIDTDAHXBAAA"
};
export const GOLDEN_EXPECT: Record<string, GoldenExpect> = {
  "night-1-standard": {
    "ok": true,
    "hash": "4f0d8b8c",
    "checkpoints": [
      "f86793b4",
      "0dcf3455",
      "9d9461ed",
      "4f0d8b8c"
    ],
    "score": 7865,
    "ticks": 7104,
    "bytes": 1080
  },
  "night-4-heavy": {
    "ok": true,
    "hash": "fb4574be",
    "checkpoints": [
      "b0d5e35c",
      "51984506",
      "8e4abed0",
      "fb4574be"
    ],
    "score": 9410,
    "ticks": 5638,
    "bytes": 908
  },
  "night-9-mixed": {
    "ok": true,
    "hash": "03cd6d8a",
    "checkpoints": [
      "521e6049",
      "d7454470",
      "474d1d47",
      "03cd6d8a"
    ],
    "score": 9410,
    "ticks": 7603,
    "bytes": 1454
  },
  "night-2-knockout": {
    "ok": true,
    "hash": "5796b62c",
    "checkpoints": [
      "c81c6abf",
      "5796b62c"
    ],
    "score": 4160,
    "ticks": 3618,
    "bytes": 189
  }
};
// </golden-data>
