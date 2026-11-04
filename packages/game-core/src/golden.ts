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
export const GOLDEN_RULESET: number = 4;
export const GOLDEN_LOGS: Record<string, string> = {
  "night-1-standard": "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",
  "night-4-heavy": "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",
  "night-9-mixed": "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",
  "night-2-knockout": "AQQA3StjgQtfgQVbgQRXgQNTgQVXgQFbAV8BYwFrAXMBewGDAWuBAG+BBW+ACm+BGW+AAXOAAnOBCHMAc4EUc4ADc4EEd4ENd4ADd4EPd4AAd4ETd4AJd4EKc4ETc4AEb4AHa4AEZ4ADY4ABK4EMJ4EHI4EGI4ADI4ECH4EHGwAXABcBEwEPAQsBAwH/ARuBCReBBxuBEx+BAh+ABiOAAyOBBieBCiuBAyuABi+ABTOAADOBBDeBDjOBCS+BAiuBAieBACcAI4AEH4AAH4EAG4ECF4EBE4EBD4EBC4EBB4EBA4EA/wH/APuAAPeAAPOAAO8A6wAAgNEnAZgCAAA="
};
export const GOLDEN_EXPECT: Record<string, GoldenExpect> = {
  "night-1-standard": {
    "ok": true,
    "hash": "b9bce814",
    "checkpoints": [
      "371e780a",
      "e452bd7d",
      "d6427050",
      "b9bce814"
    ],
    "score": 8235,
    "ticks": 4047,
    "bytes": 2003
  },
  "night-4-heavy": {
    "ok": true,
    "hash": "946c462d",
    "checkpoints": [
      "07180621",
      "a743ba16",
      "42ce349c",
      "946c462d"
    ],
    "score": 8475,
    "ticks": 3946,
    "bytes": 1655
  },
  "night-9-mixed": {
    "ok": true,
    "hash": "b89eb054",
    "checkpoints": [
      "d001922b",
      "fffed26b",
      "27621fbf",
      "b89eb054"
    ],
    "score": 8870,
    "ticks": 4876,
    "bytes": 2087
  },
  "night-2-knockout": {
    "ok": true,
    "hash": "4d9e7083",
    "checkpoints": [
      "a0f054bf",
      "4d9e7083"
    ],
    "score": 3915,
    "ticks": 5597,
    "bytes": 254
  }
};
// </golden-data>
