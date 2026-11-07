/**
 * Free roam's content and what an outing does to the save: who's in the city and what they
 * say, the side tasks, the Daily Rug's torn pages (the season arc, "The Downloads"), the
 * viewpoints, and the save's CityRecord with the XP its first completions pay.
 *
 * Rewards are XP only: free roam is never ranked, never a Bits mint. Every task, page and
 * viewpoint pays once, ever (TASK_XP, PAGE_XP, VIEW_XP in sim3d/roam/constants.ts).
 *
 * Pure: the clock comes in as an argument. The sim (sim3d/roam/tasks.ts) picks lines by index
 * through talkLine, so the browser and the verifier agree on every word.
 */
import { PAGE_XP, TASK_XP, VIEW_XP } from "../sim3d/roam/constants";
import { TASK_DONE, TASK_IDS, type RoamStart, type TaskId } from "../sim3d/roam/types";
import { HP_PER_LEVEL, POWERS, XP_TO_NEXT } from "./data";
import type { DistrictId, Hero, Save } from "./types";

export { TASK_DONE, TASK_IDS, type TaskId };

/* ------------------------------------------------------------------ people */

export interface FolkInfo {
  name: string;
  /** Who they are, in a few words (the HUD's prompt and the map). */
  who: string;
  lines: string[];
  /** Their task's line at each stage they're talked to in (TASK_DONE: after it's finished). */
  byStage?: Partial<Record<number, number>>;
  /** What they say otherwise, in turn. */
  chatter: number[];
}

/**
 * Everyone free roam lets you talk to, by key (sim3d/roam/world.ts places them). `{left}` in a
 * line is filled with what's still to find.
 */
export const FOLKS: Record<string, FolkInfo> = {
  aunt: {
    name: "Aunt Mainnet",
    who: "never goes down",
    lines: [
      "You’re up! I baked. Take this loaf to your Uncle Gen, over the river. And don’t you dare web it.",
      "Still warm? Then why are you standing here talking to me?",
      "He ate the whole thing, didn’t he. I’ll bake another on the weekend.",
      "Uptime’s a habit, dear. So is a good sourdough.",
      "Wear a scarf up there. Validators catch colds.",
    ],
    byStage: { 0: 0, 1: 1, [TASK_DONE]: 2 },
    chatter: [3, 4],
  },
  uncle: {
    name: "Uncle Gen",
    who: "gives speeches",
    lines: [
      "With great power comes great gas fees. Also, I’m starving.",
      "Your aunt’s sourdough! Still warm. You know, with great power comes great crumbs.",
      "Cold, but it’s hers. With great power comes great patience with the oven.",
      "Fully finalized. Not a crumb left.",
      "In my day we swung on dial-up. Uphill. Both ways.",
    ],
    byStage: { 0: 0, [TASK_DONE]: 3 },
    chatter: [4, 0],
  },
  mary: {
    name: "Mary Jpeg",
    who: "online, slightly compressed",
    lines: [
      "Hey, tiger. The Right-Clicker dropped eight of my pixels on the roofs round here. I’m feeling a bit lossy. Find them?",
      "Still {left} out there. I can feel my left ear coming back.",
      "That’s all eight! Hold still, I’m uncompressing.",
      "Lossless. Thank you. gm.",
      "If you see a cursor, run. Or don’t. You’re you.",
    ],
    byStage: { 0: 0, 1: 1, 2: 2, [TASK_DONE]: 3 },
    chatter: [4, 3],
  },
  bearson: {
    name: "J. Jonah Bearson",
    who: "editor, the Daily Rug",
    lines: [
      "You! The menace! Never mind that. Gas Goblin’s tagging my city. Four tags round here. Get me pictures. In focus, this time!",
      "{left} more tags. Do I look like I pay by the hour? I don’t pay at all!",
      "These are actually good. I’m running them. Small. Page twelve.",
      "Get off my roof. And send more pictures.",
      "Menace sells papers. Heroes sell… less papers.",
    ],
    byStage: { 0: 0, 1: 1, 2: 2, [TASK_DONE]: 3 },
    chatter: [4, 3],
  },
  dev: {
    name: "Dev",
    who: "a jogger, short one wallet",
    lines: [
      "A bot just lifted my wallet! It’s up on the roofs, and it runs faster than my seed-phrase recovery!",
      "It went up there! Roofs! Go!",
      "You got it back? Every token’s still there. Not your keys… no, these are my keys. Thank you!",
      "Jogging is safer than trading anyway.",
      "I run five kilometres a day. The bot runs ten. On roofs.",
    ],
    byStage: { 0: 0, 1: 1, 2: 2, [TASK_DONE]: 3 },
    chatter: [4, 3],
  },
  notary: {
    name: "Ms Stamp",
    who: "a notary",
    lines: ["I notarize everything twice. Once for me, once for the Sybil.", "Did you sign that? Sign it again.", "Forty years of paperwork and the chain still wants a timestamp."],
    chatter: [0, 1, 2],
  },
  influencer: {
    name: "Kai",
    who: "an influencer",
    lines: ["Swing past me again? The lighting was off.", "Smash that subscribe. Or just smash. You’re the hero.", "I’m not lost, I’m creating content."],
    chatter: [0, 1, 2],
  },
  landlord: {
    name: "Mrs Ledger",
    who: "a landlord",
    lines: ["Rent’s due on block one.", "I charge gas just to knock.", "No pets, no villains, no Sybils. Especially not all of them."],
    chatter: [0, 1, 2],
  },
  miner: {
    name: "Rig",
    who: "a miner",
    lines: ["My rig runs hotter than the Goblin’s fee spikes.", "Proof of work? I’ve worked. Here’s the proof: I’m tired.", "I mined a block once. Then a bigger block fell on it."],
    chatter: [0, 1, 2],
  },
  intern: {
    name: "The intern",
    who: "the Daily Rug’s",
    lines: ["Day three at the Rug. Bearson calls everyone ‘the intern’. Even Bearson.", "I fact-check. Mostly I check whether there are facts.", "He wants a photo of you being a menace. Could you knock over a bin? A small one?"],
    chatter: [0, 1, 2],
  },
  kid: {
    name: "Tiny",
    who: "a kid",
    lines: ["Do a flip! Do another flip!", "My mom says you’re a menace. My mom also reads the Rug.", "When I grow up I want to be a validator. Or a dinosaur."],
    chatter: [0, 1, 2],
  },
  auditor: {
    name: "Mr Byte",
    who: "a contract auditor",
    lines: ["I audit smart contracts. Most are only smart-ish.", "Found a reentrancy bug in my coffee order. It keeps refilling.", "Trust, but verify. Then verify the verifier."],
    chatter: [0, 1, 2],
  },
  hodler: {
    name: "Grandpa Hodl",
    who: "never sells",
    lines: ["Never selling. Never sold. Never bought either, it was all airdrops.", "Diamond hands. Also arthritis.", "My grandson says this is the bottom. He said that last year."],
    chatter: [0, 1, 2],
  },
  maxi: {
    name: "Max",
    who: "a one-chain maxi",
    lines: ["There’s only one chain. The one I’m on.", "Bridges? Doc Octochain holds the bridge. I hold my breath.", "Cross-chain? Cross my heart."],
    chatter: [0, 1, 2],
  },
  barista: {
    name: "Bea",
    who: "a barista",
    lines: ["One oat latte, sharded. That’s four cups.", "Tips go in the mempool. They get picked up eventually.", "Aunt Mainnet’s bread sells out by nine, every weekend."],
    chatter: [0, 1, 2],
  },
  gardener: {
    name: "Rosa",
    who: "a rooftop gardener",
    lines: ["Rooftop tomatoes. Off-chain. Organic.", "The pigeons front-run my seeds. Sandwich Man taught them.", "Mind the basil, hero."],
    chatter: [0, 1, 2],
  },
  pigeon: {
    name: "Pip",
    who: "feeds the pigeons",
    lines: ["The pigeons up here run nodes. Don’t ask how.", "Coo. That’s pigeon for gm.", "The Right-Clicker downloaded a whole flock once. They came back as GIFs."],
    chatter: [0, 1, 2],
  },
  // roam-3: Front-run (sim3d/roam/task-frontrun.ts picks Gwei's lines by the race: GWEI_LINE).
  gwei: {
    name: "Gwei Stacy",
    who: "runs the Mempool Market stall",
    lines: [
      "Order up! A buyer in Validator Heights wants this parcel, through six gates, in order. Sandwich Man saw it in the mempool. Beat him there and it fills at zero slippage. Go!",
      "Same order, same buyer, same sandwich. This time, front-run the front-runner. Go!",
      "Why are you still here? Every second costs about four billion gwei. Run!",
      "He got there first. I’ve been sandwiched out of 21 gwei. It’s not the gwei, it’s the principle. Again?",
      "You dropped it in the river. The fish now hold a mempool order. Dry off and go again.",
      "Filled at zero slippage! That’s forty billion gwei of respect, easy. I’d tip you, but the Right-Clicker saved my tip jar to his Downloads.",
      "Fresh fruit, priced in gwei. That banana’s three billion. No, I don’t take bananas.",
      "I swung in from another chain for this stall. Rent’s 900 million gwei. A day.",
    ],
    byStage: { 0: 0, 1: 1, [TASK_DONE]: 5 },
    chatter: [6, 7],
  },
  buyer: {
    name: "Moby",
    who: "a buyer, waiting on an order",
    lines: [
      "I’ve got a buy order sitting in the mempool. It’s been sitting there since Tuesday.",
      "Is that my order? Don’t let the man made of bread get here first.",
      "Order filled! Gwei says you’re worth forty billion gwei. Her words. I’d have said thirty.",
      "I buy high, then I hold. Mostly I hold.",
      "Whales don’t swim. We wait on roofs. It’s cheaper.",
    ],
    byStage: { 0: 0, 1: 1, [TASK_DONE]: 2 },
    chatter: [3, 4],
  },
};

/** Uncle Gen's line when the bread's handed over: warm within this many seconds of leaving the oven. */
export const BREAD_WARM_SECONDS = 90;

/**
 * The line a folk says, as an index into FOLKS[key].lines: their task's line for its stage, or
 * the next of their chatter. `delivering` (Uncle Gen, the bread in hand) picks the warm or cold
 * thanks.
 */
export function talkLine(key: string, stage: number, talks: number, delivering?: { warm: boolean }): number {
  const f = FOLKS[key];
  if (!f) return 0;
  if (delivering) return delivering.warm ? 1 : 2;
  const byStage = f.byStage?.[stage];
  if (byStage !== undefined) return byStage;
  return f.chatter[talks % f.chatter.length] ?? 0;
}

/** A line's text, with `{left}` filled in. */
export function lineText(key: string, line: number, left = 0): string {
  const text = FOLKS[key]?.lines[line] ?? "…";
  return text.replace("{left}", String(left));
}

/* ------------------------------------------------------------------ tasks */

export interface TaskInfo {
  id: TaskId;
  title: string;
  /** One line for the map and the tracker. */
  blurb: string;
  /** Who hands it out (a FOLKS key). */
  giver: string;
  /** What's next at each stage (TASK_DONE: finished); `{got}` and `{of}` are filled in. */
  steps: Partial<Record<number, string>>;
  /** Items to find (pixels, photos), or 0. */
  items: number;
}

export const TASKS: Record<TaskId, TaskInfo> = {
  bread: {
    id: "bread",
    title: "Still warm",
    blurb: "Take Aunt Mainnet’s loaf across the river to Uncle Gen.",
    giver: "aunt",
    steps: { 0: "Talk to Aunt Mainnet on her roof", 1: "Take the loaf to Uncle Gen", [TASK_DONE]: "Delivered" },
    items: 0,
  },
  pickpocket: {
    id: "pickpocket",
    title: "Stop, thief.exe",
    blurb: "Catch the pickpocket bot on the roofs and bring Dev’s wallet back.",
    giver: "dev",
    steps: { 0: "Talk to Dev, the jogger", 1: "Catch the pickpocket bot", 2: "Bring the wallet back to Dev", [TASK_DONE]: "Wallet returned" },
    items: 0,
  },
  pixels: {
    id: "pixels",
    title: "Lossless",
    blurb: "Find Mary Jpeg’s eight lost pixels and bring them back.",
    giver: "mary",
    steps: { 0: "Talk to Mary Jpeg", 1: "Find Mary’s pixels ({got} of {of})", 2: "Bring the pixels back to Mary", [TASK_DONE]: "Mary’s whole again" },
    items: 8,
  },
  graffiti: {
    id: "graffiti",
    title: "Front page",
    blurb: "Photograph Gas Goblin’s four tags for Bearson.",
    giver: "bearson",
    steps: { 0: "Talk to Bearson", 1: "Photograph Gas Goblin’s tags ({got} of {of})", 2: "Bring the photos to Bearson", [TASK_DONE]: "On page twelve" },
    items: 4,
  },
  frontrun: {
    id: "frontrun",
    title: "Front-run",
    blurb: "Race Gwei Stacy’s order over the roofs to the buyer, through six gates, before Sandwich Man gets there.",
    giver: "gwei",
    steps: { 0: "Talk to Gwei Stacy at her stall", 1: "Beat Sandwich Man to the buyer (gate {got} of {of})", [TASK_DONE]: "Order filled" },
    items: 6,
  },
};

/** The tracker's line for a task at a stage. */
export function taskStep(id: TaskId, stage: number, got = 0): string {
  const t = TASKS[id];
  return (t.steps[stage] ?? t.blurb).replace("{got}", String(got)).replace("{of}", String(t.items));
}

/* ------------------------------------------------------------------ the Daily Rug's torn pages */

/**
 * Twelve torn pages of the Daily Rug, blown across the roofs: what the city lost to the
 * Right-Clicker's Downloads folder (the season arc). Index = the page's place in the world.
 */
export const PAGES: readonly { headline: string; body: string }[] = [
  { headline: "Market stall vanishes overnight", body: "Gwei Stacy counted 41,000 gwei of fruit, gone. The owner: “It was right-clicked. I heard the click.”" },
  { headline: "Bridge lamp ‘saved as’", body: "Bridge District residents report a lamp post replaced by a little file icon. It still sort of glows." },
  { headline: "Who is the Right-Clicker?", body: "Sources say he owns nothing. Also everything. Mostly in .png." },
  { headline: "Downloads folder ‘full’, says source", body: "“If it’s full,” asks this editor, “where is my parking space?”" },
  { headline: "Validator Heights loses a floor", body: "Tenants on the thirteenth report a loading bar where the fourteenth used to be." },
  { headline: "Aunt Mainnet: “I never go down”", body: "The bakery’s uptime remains perfect. The Right-Clicker tried. Twice. She gave him a scone." },
  { headline: "The Sybil, the Sybil and the Sybil deny involvement", body: "All of them were somewhere else at the time. All at once." },
  { headline: "Menace saves cat", body: "The cat was returned to its owner, who says it now looks “slightly compressed”." },
  { headline: "Mempool Market queue reaches the river", body: "Someone always cuts in. Police suspect a man made of bread." },
  { headline: "Gas Goblin tags Sector 7", body: "Fees in the district are up 300 percent. Paint, this paper notes, is free." },
  { headline: "The city’s missing pieces: a list", body: "A bench. A pigeon. Doc’s spare arm. Half of the Queens Block skyline. A Tuesday." },
  { headline: "Editor’s note", body: "The Daily Rug does not apologize. The Daily Rug does, however, want these pages back." },
];

/* ------------------------------------------------------------------ viewpoints */

export const VIEW_NAMES: Record<DistrictId, string> = {
  "sector-7": "Sector 7 mast",
  "mempool-market": "Mempool Market mast",
  "bridge-district": "Bridge District mast",
  "queens-block": "Queens Block mast",
  "validator-heights": "Validator Heights mast",
};

/* ------------------------------------------------------------------ the save's record */

/** Where an outing ended, feet position and facing. */
export interface CitySpot {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
}

/**
 * Free roam's progress in the save (`save.city`). Absent until the first outing. The server
 * keeps a signed-in player's (from verified outings); a guest's lives in the browser's save.
 */
export interface CityRecord {
  /** Per task: its stage (0 not started, then the task's own steps, TASK_DONE finished). */
  tasks: Partial<Record<TaskId, number>>;
  /** Per task: the items found so far, as bits (pixels, photos). */
  items: Partial<Record<TaskId, number>>;
  /** Pages found and viewpoints synced, as bits (by their index in the world). */
  pages: number;
  views: number;
  /** XP the city has paid so far. */
  xp: number;
  /** Where the last outing ended, or null (the spawn roof). */
  at: CitySpot | null;
  /** Outings filed. */
  outings: number;
  /**
   * Signed in: the outing the server last filed and the base it started from, so the same
   * outing filed again as it grows replays from where it began (src/server/db/city.ts).
   */
  outing?: { id: string; base: CityBase } | null;
}

export const emptyCity = (): CityRecord => ({ tasks: {}, items: {}, pages: 0, views: 0, xp: 0, at: null, outings: 0 });

/** The save's city record, or an empty one. */
export const cityRecord = (save: Pick<Save, "city"> | null | undefined): CityRecord => {
  const c = save?.city;
  return c ? { ...emptyCity(), ...c, tasks: { ...c.tasks }, items: { ...c.items } } : emptyCity();
};

const bitCount = (n: number) => {
  let c = 0;
  for (let v = n >>> 0; v; v &= v - 1) c += 1;
  return c;
};

const finiteSpot = (a: CitySpot | null | undefined): a is CitySpot => !!a && [a.x, a.y, a.z, a.fx, a.fz].every((v) => typeof v === "number" && Number.isFinite(v));

/** Where an outing starts from a record (or its base): its progress and spot (an outing's talks always start fresh). */
export function roamStartFrom(rec: CityBase): RoamStart {
  return {
    stage: TASK_IDS.map((id) => {
      const v = rec.tasks[id] ?? 0;
      return Number.isInteger(v) && v >= 0 && v <= TASK_DONE ? v : 0;
    }),
    items: TASK_IDS.map((id) => (rec.items[id] ?? 0) >>> 0),
    pages: rec.pages >>> 0,
    views: rec.views >>> 0,
    talks: [],
    at: finiteSpot(rec.at) ? { ...rec.at } : null,
  };
}

/**
 * What an outing starts from: the record's progress and spot. The server files an outing only
 * from its own record's base (the first filing of an outing must match it exactly).
 */
export interface CityBase {
  tasks: Partial<Record<TaskId, number>>;
  items: Partial<Record<TaskId, number>>;
  pages: number;
  views: number;
  at: CitySpot | null;
}

export const cityBase = (rec: CityRecord): CityBase => ({ tasks: { ...rec.tasks }, items: { ...rec.items }, pages: rec.pages, views: rec.views, at: rec.at ? { ...rec.at } : null });

/** Whether two bases are the same start (every task's stage and items, pages, views and the spot). */
export function sameBase(a: CityBase, b: CityBase): boolean {
  for (const id of TASK_IDS) {
    if ((a.tasks[id] ?? 0) !== (b.tasks[id] ?? 0) || (a.items[id] ?? 0) !== (b.items[id] ?? 0)) return false;
  }
  if (a.pages >>> 0 !== b.pages >>> 0 || a.views >>> 0 !== b.views >>> 0) return false;
  if (!a.at || !b.at) return !a.at && !b.at;
  return a.at.x === b.at.x && a.at.y === b.at.y && a.at.z === b.at.z && a.at.fx === b.at.fx && a.at.fz === b.at.fz;
}

/** What an outing ended with (sim3d/roam's final progress and spot). */
export interface CityOuting {
  stage: number[];
  items: number[];
  pages: number;
  views: number;
  at: CitySpot | null;
}

export interface CityGains {
  /** Tasks finished for the first time, pages and viewpoints found for the first time. */
  tasks: TaskId[];
  pages: number;
  views: number;
  xp: number;
}

/** XP on the hero, levelling up as a night does (more health, a power to pick). */
function addXp(hero: Hero, xp: number): Hero {
  let h: Hero = { ...hero, xp: hero.xp + xp };
  const owned = Object.keys(h.powers).length;
  const total = Object.keys(POWERS).length;
  while (h.xp >= XP_TO_NEXT(h.level)) {
    h = { ...h, xp: h.xp - XP_TO_NEXT(h.level), level: h.level + 1, maxHp: h.maxHp + HP_PER_LEVEL };
    if (owned + h.pendingPicks < total) h = { ...h, pendingPicks: h.pendingPicks + 1 };
  }
  return h;
}

/**
 * File an outing into a save: stages only move on, items, pages and viewpoints are kept once
 * found, the spot moves to where it ended, and every first finish pays its XP (once, ever).
 * Pure; the same on the server (from a verified replay) and for a guest (the browser's run).
 */
export function applyOuting(save: Save, out: CityOuting): { save: Save; record: CityRecord; gains: CityGains } {
  const before = cityRecord(save);
  const tasks: CityRecord["tasks"] = { ...before.tasks };
  const items: CityRecord["items"] = { ...before.items };
  const doneTasks: TaskId[] = [];
  TASK_IDS.forEach((id, i) => {
    const was = before.tasks[id] ?? 0;
    const now = out.stage[i] ?? 0;
    const next = Math.max(was, Number.isInteger(now) && now >= 0 && now <= TASK_DONE ? now : 0);
    if (next !== 0 || was !== 0) tasks[id] = next;
    if (next === TASK_DONE && was !== TASK_DONE) doneTasks.push(id);
    const bits = ((before.items[id] ?? 0) | (out.items[i] ?? 0)) >>> 0;
    if (bits) items[id] = bits;
  });
  const pages = (before.pages | out.pages) >>> 0;
  const views = (before.views | out.views) >>> 0;
  const newPages = bitCount(pages & ~before.pages);
  const newViews = bitCount(views & ~before.views);
  const xp = doneTasks.length * TASK_XP + newPages * PAGE_XP + newViews * VIEW_XP;
  const record: CityRecord = { tasks, items, pages, views, xp: before.xp + xp, at: finiteSpot(out.at) ? out.at : before.at, outings: before.outings + 1 };
  const hero = xp > 0 && save.hero ? addXp(save.hero, xp) : save.hero;
  return { save: { ...save, hero, city: record }, record, gains: { tasks: doneTasks, pages: newPages, views: newViews, xp } };
}

/** The city's totals for the map and the lobby: found of all. */
export function cityTotals(rec: CityRecord, counts: { pages: number; views: number }): { tasks: number; pages: number; views: number } {
  return {
    tasks: TASK_IDS.filter((id) => rec.tasks[id] === TASK_DONE).length,
    pages: bitCount(rec.pages & ((1 << counts.pages) - 1)),
    views: bitCount(rec.views & ((1 << counts.views) - 1)),
  };
}
