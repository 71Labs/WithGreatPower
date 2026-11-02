/**
 * The game's state model. Everything here is plain data so a save is JSON and every
 * rule in engine.ts is a pure function of (state, action).
 */
import type { CastId } from "./cast";

export type PowerId =
  | "web-sling"
  | "web-shield"
  | "node-sense"
  | "wall-crawl"
  | "yank"
  | "finality"
  | "web-bomb"
  | "gas-refund"
  | "fork"
  | "zk-cloak"
  | "front-run"
  | "validator-slam";

/** A move in a fight: a power, the free punch, or calling Gwei Stacy once per patrol. */
export type MoveId = PowerId | "punch" | "gwei";

export type VillainId = "gas-goblin" | "sandwich-man" | "doc-octochain" | "sybil";
export type AllyId = "aunt-mainnet" | "uncle-gen" | "mary-jpeg" | "bearson" | "gwei";
export type DistrictId = "sector-7" | "mempool-market" | "bridge-district" | "queens-block" | "validator-heights";

export type ItemId =
  | "fee-bomb"
  | "goblin-glider"
  | "crumbs"
  | "sesame-seed"
  | "chain-link"
  | "spare-arm"
  | "sybil-goo"
  | "press-pass";

export type Rarity = "common" | "uncommon" | "rare";

export type SuitId = "classic" | "midnight" | "mint" | "snow" | "stealth" | "glider" | "octo" | "sesame";

/** Colors of a masked hero's suit; the art recolors the hero sticker with these. */
export interface SuitColors {
  suit: string;
  web: string;
  lens: string;
}

export type SwingGrade = "perfect" | "good" | "miss";

export interface PowerState {
  /** Uses so far; every 6 uses is a level, up to 5. */
  mastery: number;
}

export interface Hero {
  name: string;
  level: number;
  xp: number;
  maxHp: number;
  /** 0–100. Goes up when you help people; the joke is that it never goes up fast enough. */
  responsibility: number;
  powers: Partial<Record<PowerId, PowerState>>;
  /** Up to four powers taken on patrol. */
  loadout: PowerId[];
  suit: SuitId;
  /** Level-ups waiting for the player to pick a new power. */
  pendingPicks: number;
  createdNight: number;
}

/** What the villain is about to do, shown above them before you move. */
export interface Intent {
  kind: "attack" | "heavy" | "drain" | "charge" | "summon" | "grab" | "swarm" | "frontrun" | "jam";
  label: string;
  /** Damage, or the amount drained or summoned. */
  value: number;
}

export interface Fight {
  villain: VillainId;
  level: number;
  boss: boolean;
  hp: number;
  maxHp: number;
  /** The next intents; [0] happens this turn. */
  intents: Intent[];
  turn: number;
  /** Damage the hero's web shield will soak this turn. */
  block: number;
  /** Villain attacks that will miss. */
  dodges: number;
  /** Turns the villain skips (webbed or stunned). */
  webbed: number;
  /** Next villain attack hits double. */
  charged: boolean;
  /** Sybil copies: each soaks damage and adds to his swarm. */
  copies: number;
  /** Turns your powers cost 5 more fluid (Doc's chain jam). */
  jammed: number;
  /** Your next power happens twice (Fork). */
  forked: boolean;
  cooldowns: Partial<Record<PowerId, number>>;
  /** Position in the villain's move pattern. */
  cursor: number;
  log: FightLine[];
  /** Seeded RNG state for this fight. */
  rng: number;
  result: "won" | "lost" | null;
}

export interface FightLine {
  who: "hero" | "villain" | "system";
  text: string;
}

export type Stop =
  | { kind: "fight"; villain: VillainId; district: DistrictId; level: number; boss: boolean; quest: boolean }
  | { kind: "errand"; ally: AllyId; errand: string; district: DistrictId };

export interface StopResult {
  kind: Stop["kind"];
  /** Fights: "won" or "lost". Errands: the id of the choice made. */
  outcome: string;
  /** Who the stop was with, for the sticker album and the newspaper. */
  who: CastId;
  district: DistrictId;
  /** A line for the summary: what happened. */
  text: string;
  xp: number;
  loot: Partial<Record<ItemId, number>>;
  responsibility: number;
  reputation: number;
}

export type PatrolPhase = "briefing" | "swing" | "stop" | "summary";

export interface Patrol {
  night: number;
  seed: number;
  stops: Stop[];
  /** Index of the stop being swung to or played. */
  index: number;
  phase: PatrolPhase;
  hp: number;
  maxHp: number;
  fluid: number;
  combo: number;
  perfectSwings: number;
  fight: Fight | null;
  results: StopResult[];
  /** XP from swings; stop XP is in results. */
  swingXp: number;
  /** Times Gwei Stacy can still be called tonight. */
  gweiCalls: number;
  /** What Bearson was told, if he was met. */
  quote: string | null;
  knockedOut: boolean;
  /** Played in the real-time city rather than the classic turn-based screens. */
  realtime?: boolean;
}

export interface Quest {
  villain: VillainId;
  text: string;
  rewardXp: number;
  rewardItem: ItemId;
  /** The night it applies to. */
  night: number;
  done: boolean;
}

export interface Story {
  headline: string;
  dek: string;
  who: CastId;
}

export interface Edition {
  night: number;
  headline: string;
  dek: string;
  who: CastId;
  stories: Story[];
  /** Share of readers calling you a hero, 0–100. */
  heroPoll: number;
  vote: "hero" | "menace" | null;
  quest: Quest | null;
}

export interface Stats {
  villainsCaught: number;
  errands: number;
  knockouts: number;
  perfectSwings: number;
  nights: number;
}

export interface Save {
  version: 1;
  hero: Hero | null;
  night: number;
  patrol: Patrol | null;
  /** True once tonight's patrol is finished; Sleep starts the next night. */
  nightDone: boolean;
  inventory: Partial<Record<ItemId, number>>;
  suits: SuitId[];
  /** Stickers collected: allies met and villains caught, with counts. */
  album: Partial<Record<CastId, number>>;
  editions: Edition[];
  /** −100 (menace) to 100 (hero): what the city thinks of you. */
  reputation: number;
  stats: Stats;
}
