/**
 * Game content: powers, villains, loot, suits, districts and errands. Readable on
 * purpose, since every number here is a rule players feel.
 */
import type { SuitColors } from "@/components/cast";
import type { CastId } from "@/content/cast";

import type { AllyId, DistrictId, Intent, ItemId, PowerId, Rarity, SuitId, VillainId } from "./types";

export interface Power {
  id: PowerId;
  name: string;
  /** One line, shown on the move button. */
  blurb: string;
  cost: number;
  cooldown: number;
  starter: boolean;
  /** Base numbers at power level 1; each level adds 15%. */
  damage?: number;
  block?: number;
  heal?: number;
  dodge?: number;
  fluid?: number;
  stun?: number;
}

export const POWERS: Record<PowerId, Power> = {
  "web-sling": { id: "web-sling", name: "Web-sling", blurb: "A quick shot of web. Reliable, cheap.", cost: 8, cooldown: 0, starter: true, damage: 16 },
  "web-shield": { id: "web-shield", name: "Web shield", blurb: "Soak the next hit.", cost: 6, cooldown: 1, starter: true, block: 18 },
  "node-sense": { id: "node-sense", name: "Node sense", blurb: "Dodge the next attack completely.", cost: 10, cooldown: 2, starter: true, dodge: 1 },
  "wall-crawl": { id: "wall-crawl", name: "Wall-crawl", blurb: "Scuttle up a wall and catch your breath.", cost: 6, cooldown: 2, starter: true, heal: 16 },
  yank: { id: "yank", name: "Yank", blurb: "Pull them off balance and cancel a wind-up.", cost: 8, cooldown: 2, starter: true, damage: 10 },
  finality: { id: "finality", name: "Finality", blurb: "Double damage on a webbed villain.", cost: 10, cooldown: 1, starter: true, damage: 12 },
  "web-bomb": { id: "web-bomb", name: "Web bomb", blurb: "Big hit, and they're webbed for a turn.", cost: 18, cooldown: 3, starter: false, damage: 26, stun: 1 },
  "gas-refund": { id: "gas-refund", name: "Gas refund", blurb: "Get your fluid back, plus a little health.", cost: 0, cooldown: 4, starter: false, fluid: 22, heal: 8 },
  fork: { id: "fork", name: "Fork", blurb: "Your next power happens twice.", cost: 12, cooldown: 4, starter: false },
  "zk-cloak": { id: "zk-cloak", name: "ZK cloak", blurb: "Prove you’re not there. Dodge the next two attacks.", cost: 16, cooldown: 4, starter: false, dodge: 2 },
  "front-run": { id: "front-run", name: "Front-run", blurb: "Strike first. Wrecks Sandwich Man’s timing.", cost: 10, cooldown: 2, starter: false, damage: 14 },
  "validator-slam": { id: "validator-slam", name: "Validator slam", blurb: "A heavy hit that stuns for a turn.", cost: 16, cooldown: 3, starter: false, damage: 22, stun: 1 },
};

export const STARTER_POWERS = (Object.values(POWERS) as Power[]).filter((p) => p.starter).map((p) => p.id);

export const PUNCH = { name: "Punch", blurb: "Free. Not glamorous.", damage: 7 };
export const GWEI_ASSIST = { name: "Call Gwei", blurb: "Gwei Stacy swings in once a patrol.", damage: 24 };

export interface Villain {
  id: VillainId;
  name: string;
  district: DistrictId;
  hp: number;
  /** The move pattern; the fight walks it in order with a little shuffle. */
  moves: Intent[];
  loot: { common: ItemId; rare: ItemId };
  taunt: string;
  defeat: string;
}

export const VILLAINS: Record<VillainId, Villain> = {
  "gas-goblin": {
    id: "gas-goblin",
    name: "Gas Goblin",
    district: "sector-7",
    hp: 84,
    moves: [
      { kind: "drain", label: "Fee bomb", value: 11 },
      { kind: "attack", label: "Glider dive", value: 14 },
      { kind: "charge", label: "Cackles", value: 0 },
      { kind: "heavy", label: "Surge pricing", value: 20 },
    ],
    loot: { common: "fee-bomb", rare: "goblin-glider" },
    taunt: "Fees are up four hundred percent, web-head!",
    defeat: "Gas Goblin is tied to a lamppost. Fees drop back to normal.",
  },
  "sandwich-man": {
    id: "sandwich-man",
    name: "Sandwich Man",
    district: "mempool-market",
    hp: 68,
    moves: [
      { kind: "frontrun", label: "Front-run", value: 9 },
      { kind: "attack", label: "Squeeze", value: 12 },
      { kind: "frontrun", label: "Back-run", value: 9 },
      { kind: "heavy", label: "Double-decker", value: 17 },
    ],
    loot: { common: "crumbs", rare: "sesame-seed" },
    taunt: "I was here before you. I’ll be here after you.",
    defeat: "Sandwich Man is wrapped up to go.",
  },
  "doc-octochain": {
    id: "doc-octochain",
    name: "Doc Octochain",
    district: "bridge-district",
    hp: 104,
    moves: [
      { kind: "grab", label: "Bridge grab", value: 8 },
      { kind: "jam", label: "Chain jam", value: 2 },
      { kind: "attack", label: "Eight-arm flurry", value: 16 },
      { kind: "heavy", label: "Cross-chain slam", value: 21 },
    ],
    loot: { common: "chain-link", rare: "spare-arm" },
    taunt: "Eight arms, eight chains, and every one of them is mine.",
    defeat: "Doc Octochain’s arms are knotted together. The bridge reopens.",
  },
  sybil: {
    id: "sybil",
    name: "The Sybil",
    district: "validator-heights",
    hp: 58,
    moves: [
      { kind: "summon", label: "Duplicate", value: 1 },
      { kind: "swarm", label: "Swarm", value: 6 },
      { kind: "summon", label: "Duplicate", value: 1 },
      { kind: "attack", label: "Fake vote", value: 13 },
    ],
    loot: { common: "sybil-goo", rare: "sybil-goo" },
    taunt: "We vote unanimously that you lose.",
    defeat: "Every last Sybil is webbed. Turns out they were all him.",
  },
};

export interface Item {
  id: ItemId;
  name: string;
  rarity: Rarity;
  blurb: string;
}

export const ITEMS: Record<ItemId, Item> = {
  "fee-bomb": { id: "fee-bomb", name: "Fee bomb", rarity: "common", blurb: "Defused. Mostly." },
  "goblin-glider": { id: "goblin-glider", name: "Goblin glider", rarity: "rare", blurb: "Still smells of exhaust." },
  crumbs: { id: "crumbs", name: "Crumbs", rarity: "common", blurb: "Left behind by Sandwich Man. Always." },
  "sesame-seed": { id: "sesame-seed", name: "Golden sesame seed", rarity: "uncommon", blurb: "From the top bun. Weirdly heavy." },
  "chain-link": { id: "chain-link", name: "Chain link", rarity: "common", blurb: "One of very many." },
  "spare-arm": { id: "spare-arm", name: "Doc’s spare arm", rarity: "rare", blurb: "It still twitches when bridges open." },
  "sybil-goo": { id: "sybil-goo", name: "Sybil goo", rarity: "uncommon", blurb: "There’s always more of it." },
  "press-pass": { id: "press-pass", name: "Press pass", rarity: "uncommon", blurb: "Signed by Bearson, who regrets it." },
};

export interface Suit {
  id: SuitId;
  name: string;
  colors: SuitColors;
  /** Starter suits are free at sign-up; the rest are crafted. */
  starter: boolean;
  recipe: Partial<Record<ItemId, number>>;
  minLevel: number;
  blurb: string;
}

export const SUITS: Record<SuitId, Suit> = {
  classic: { id: "classic", name: "Classic", colors: { suit: "#E5392C", web: "#141414", lens: "#FFFFFF" }, starter: true, recipe: {}, minLevel: 1, blurb: "The original. Red, webbed, recognizable from three blocks." },
  midnight: { id: "midnight", name: "Midnight", colors: { suit: "#2B3A8C", web: "#141414", lens: "#FFFFFF" }, starter: true, recipe: {}, minLevel: 1, blurb: "For heroes who mostly work nights. Which is all of them." },
  mint: { id: "mint", name: "Mainnet mint", colors: { suit: "#1C1C1E", web: "#00EC97", lens: "#00EC97" }, starter: true, recipe: {}, minLevel: 1, blurb: "Black and mint, like a certain blockchain." },
  snow: { id: "snow", name: "Snow", colors: { suit: "#F4F4F2", web: "#B6A2EC", lens: "#FFFFFF" }, starter: true, recipe: {}, minLevel: 1, blurb: "Very clean. Very hard to keep clean." },
  stealth: { id: "stealth", name: "Stealth", colors: { suit: "#2A2A2E", web: "#6B6B70", lens: "#E8E8E8" }, starter: false, recipe: { "sybil-goo": 3 }, minLevel: 2, blurb: "Woven from Sybil goo. Nobody can tell which one is you." },
  glider: { id: "glider", name: "Glider", colors: { suit: "#7A4FD1", web: "#1F6B2A", lens: "#F7D23E" }, starter: false, recipe: { "goblin-glider": 1, "fee-bomb": 2 }, minLevel: 2, blurb: "Stitched from a goblin glider. Comes with a faint cackle." },
  octo: { id: "octo", name: "Octo rig", colors: { suit: "#3E8E4A", web: "#5A3A22", lens: "#FFD95A" }, starter: false, recipe: { "spare-arm": 1, "chain-link": 3 }, minLevel: 3, blurb: "Doc’s spare arm, repurposed. It mostly behaves." },
  sesame: { id: "sesame", name: "Sesame", colors: { suit: "#E8B25C", web: "#7A4A1C", lens: "#FFFFFF" }, starter: false, recipe: { crumbs: 4, "sesame-seed": 1 }, minLevel: 2, blurb: "Smells like the Mempool Market at lunch." },
};

export interface District {
  id: DistrictId;
  name: string;
  blurb: string;
}

export const DISTRICTS: Record<DistrictId, District> = {
  "sector-7": { id: "sector-7", name: "Sector 7", blurb: "Gas stations, glider pads, very high fees." },
  "mempool-market": { id: "mempool-market", name: "Mempool Market", blurb: "Everyone queues. Somebody always cuts in." },
  "bridge-district": { id: "bridge-district", name: "Bridge District", blurb: "Eight bridges, one very bad one." },
  "queens-block": { id: "queens-block", name: "Queens Block", blurb: "Aunt Mainnet’s street. Never goes down." },
  "validator-heights": { id: "validator-heights", name: "Validator Heights", blurb: "Towers full of nodes, and copies of copies." },
};

export interface ErrandChoice {
  id: string;
  label: string;
  /** What happens, shown after choosing. */
  result: string;
  responsibility: number;
  reputation: number;
  xp: number;
  heal?: number;
  fluid?: number;
  item?: ItemId;
  /** Bearson interviews: the quote that ends up in The Daily Rug. */
  quote?: string;
}

export interface Errand {
  id: string;
  ally: AllyId;
  district: DistrictId;
  title: string;
  prompt: string;
  choices: ErrandChoice[];
}

export const ERRANDS: Errand[] = [
  {
    id: "groceries",
    ally: "aunt-mainnet",
    district: "queens-block",
    title: "Aunt Mainnet’s groceries",
    prompt: "Aunt Mainnet is carrying six bags up four flights. She says she’s fine. She is not fine.",
    choices: [
      { id: "carry", label: "Carry them up", result: "She gives you a slice of loaf for the road. Health restored.", responsibility: 3, reputation: 4, xp: 12, heal: 18 },
      { id: "web-lift", label: "Web them up to the window", result: "Efficient. One bag of eggs did not survive.", responsibility: 1, reputation: 1, xp: 16 },
    ],
  },
  {
    id: "the-speech",
    ally: "uncle-gen",
    district: "queens-block",
    title: "Uncle Gen has a thought",
    prompt: "Uncle Gen is on the stoop. He has a thought about power. And, you suspect, responsibility.",
    choices: [
      { id: "listen", label: "Sit and listen", result: "You’ve heard it before. It lands anyway.", responsibility: 4, reputation: 0, xp: 10, fluid: 10 },
      { id: "nod", label: "Nod and swing off", result: "He shouts the end of it after you. Twice.", responsibility: 1, reputation: 0, xp: 6 },
    ],
  },
  {
    id: "selfie",
    ally: "mary-jpeg",
    district: "mempool-market",
    title: "Mary Jpeg wants a selfie",
    prompt: "Mary Jpeg spots you on a rooftop. “One photo. For the timeline.”",
    choices: [
      { id: "pose", label: "Strike a pose", result: "It goes viral. Slightly compressed, but viral.", responsibility: 0, reputation: 8, xp: 10 },
      { id: "decline", label: "No time, there’s a villain", result: "She posts a blurry one anyway. Caption: “rude”.", responsibility: 1, reputation: -2, xp: 8 },
    ],
  },
  {
    id: "interview",
    ally: "bearson",
    district: "bridge-district",
    title: "J. Jonah Bearson wants a quote",
    prompt: "Bearson corners you outside The Daily Rug. “Give me one line. Make it a confession.”",
    choices: [
      { id: "humble", label: "“Just a friendly neighbor.”", result: "He snorts. He prints it, in very small type.", responsibility: 2, reputation: 5, xp: 10, quote: "Just a friendly neighbor." },
      { id: "brag", label: "“The city would be lost without me.”", result: "He beams. That’s tomorrow’s front page sorted.", responsibility: -2, reputation: -6, xp: 14, quote: "The city would be lost without me." },
      { id: "pass", label: "Grab a press pass and run", result: "He chases you two blocks. You keep the pass.", responsibility: -1, reputation: -3, xp: 8, item: "press-pass", quote: "No comment (stole a press pass)." },
    ],
  },
  {
    id: "team-up",
    ally: "gwei",
    district: "validator-heights",
    title: "Gwei Stacy, on a water tower",
    prompt: "Gwei Stacy is counting something in very small units. “Want backup tonight?”",
    choices: [
      { id: "team", label: "Team up", result: "She’ll swing in once tonight if you call. She’ll invoice in gwei.", responsibility: 2, reputation: 2, xp: 10 },
      { id: "solo", label: "Go it alone", result: "She shrugs. “Your funeral, web-head.”", responsibility: 0, reputation: 0, xp: 12 },
    ],
  },
];

export const RARITY_LABEL: Record<Rarity, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare" };

export const XP_TO_NEXT = (level: number) => 100 + (level - 1) * 60;

export const HERO_BASE_HP = 100;
export const HP_PER_LEVEL = 6;
export const MAX_FLUID = 100;
export const MAX_LOADOUT = 4;
export const STOPS_PER_PATROL = 4;
/** The starter suits you didn't pick at sign-up unlock, free, at this level. */
export const STARTER_UNLOCK_LEVEL = 2;

/** Every 6 uses is a power level, up to 5; each level adds 15% to the effect. */
export const powerLevel = (mastery: number) => Math.min(5, 1 + Math.floor(mastery / 6));
export const powerScale = (mastery: number) => 1 + (powerLevel(mastery) - 1) * 0.15;

/** Villains get 12% tougher per level; level rises every two nights. */
export const villainLevel = (night: number) => 1 + Math.floor((night - 1) / 2);
export const levelScale = (level: number) => 1 + (level - 1) * 0.12;
/** Villain hits grow slower than their health, so leveling up keeps up. */
export const damageScale = (level: number) => 1 + (level - 1) * 0.08;

/** Web fluid back per fight turn, and health back on landing at each stop. */
export const FLUID_REGEN = 4;
export const LANDING_HEAL = 0.08;
export const BOSS_HP = 1.05;

/** Real-time play swings dozens of times a night; only this many per stop earn XP. */
export const SIM_SWING_XP_CAP = 3;

export const SWING = {
  perfect: { xp: 6, fluid: -2, hp: 0, combo: 1, label: "Perfect swing" },
  good: { xp: 3, fluid: -4, hp: 0, combo: 0, label: "Good swing" },
  miss: { xp: 0, fluid: -6, hp: -6, combo: -99, label: "Missed the web" },
} as const;

export const ALLY_CAST: Record<AllyId, CastId> = {
  "aunt-mainnet": "aunt-mainnet",
  "uncle-gen": "uncle-gen",
  "mary-jpeg": "mary-jpeg",
  bearson: "bearson",
  gwei: "gwei",
};
