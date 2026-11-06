/**
 * Case file 003, "Fee Strike": every word the UI shows for it, in The Daily Rug's voice.
 * Sentence case, curly quotes, no prizes or money. The story is the season bible's
 * (docs/story/bible.md, "003 Fee Strike") and game-core's (rules/case-003.ts, FEE_STRIKE_INFO
 * and FEE_STRIKE_LINES), read from there where it can be: Gas Goblin bought Aunt Mainnet's
 * recipe book, `recipes_DO_NOT_SHARE (1).pdf`, out of the Right-Clicker's leaked Downloads,
 * read page 41 (the Never-Goes-Down Loaf) as a fee plan, and keyed it into the Mempool
 * Market's fee meter. Fees jammed at +400%, and her oven can't pay its own way.
 */
import { CHAPTERS, FEE_STRIKE_LINES, type FeeClueId } from "@wgp/game-core/chapters";

import { SITE_URL } from "@/lib/site";

/** The case's id (game-core's FEE_STRIKE_ID). */
export const CASE_003_ID = "case-003" as const;

/** Where the intro lives and where "Start the case" goes. */
export const CASE_003_PATHS = {
  list: "/play/cases",
  intro: "/play/cases/003",
  play: "/play/patrol?case=003",
} as const;

const INFO = CHAPTERS[CASE_003_ID];

/** The suspect, from the game's content. */
export const GAS_GOBLIN = { name: INFO.villain.name, tagline: INFO.villain.tagline, taunt: INFO.villain.taunt } as const;

export interface FeeClueCopy {
  id: FeeClueId;
  /** Short name, for the map and the list. */
  name: string;
  /** Where it is, for the city map. */
  where: string;
  /** The case note (what the burns say, or a stuck shopkeeper's line), from game-core. */
  note: string;
}

const note = (id: FeeClueId) => INFO.clues.find((c) => c.id === id)?.note ?? "";

/** In the order the case file lists them (they can be found in any order). */
export const FEE_CLUES: readonly FeeClueCopy[] = [
  { id: "burn", name: "Fee-bomb burns", where: "Green soot on a Market roof, leading off toward the meter", note: note("burn") },
  { id: "pretzel", name: "The pretzel cart", where: "A stuck stall on a Market roof", note: note("pretzel") },
  { id: "florist", name: "The florist", where: "A stuck stall on a Market roof", note: note("florist") },
];

export const feeClueCopy = (id: FeeClueId): FeeClueCopy => FEE_CLUES.find((c) => c.id === id) ?? FEE_CLUES[0];

export const CASE_003 = {
  id: CASE_003_ID,
  number: "003",
  title: INFO.title,
  district: "Mempool Market",
  summary:
    "Every fee in the Mempool Market went up 400% overnight. Aunt Mainnet’s bakery can’t pay for its own oven, Saturday’s loaf is stuck in the pending line, and the city is getting hangry. Somebody is holding the fee meter.",
  /** The case file's facts (the stamp panel and the folder). */
  facts: [
    { label: "Last seen", value: "Over the Mempool Market, on a glider, cackling" },
    { label: "Fees", value: "Up 400%, and climbing" },
    { label: "Stakes", value: "Aunt Mainnet has never missed a Saturday" },
  ],
  steps: [
    "Follow the fee-bomb burns and hear out the stuck shopkeepers.",
    "Find the fee meter.",
    "Chase Gas Goblin across the roofs to the bakery.",
    "Beat him on Aunt Mainnet’s roof.",
    "Hold web on the meter to cool the fees.",
  ],
  /** The meter's note, as the game has it (the season's arc: the recovered Downloads file). */
  meter: FEE_STRIKE_LINES.meter,
  /** The intro's teaser for it, before the meter's found. */
  tip: "Word on the Market: whatever jammed the fee meter came out of the Right-Clicker’s Downloads.",
  /** The Downloads file this case recovers. */
  file: FEE_STRIKE_LINES.file,
  /** What the chase asks of you, for the case file. */
  chaseRule: "Keep up with him. Fall too far behind and you’re sent back to the last rooftop; lose him five times and he’s gone with the meter.",
  /** The intro's front page. */
  gone: {
    headline: "Fees up 400%. Loaf down?",
    dek: "Aunt Mainnet’s oven went dark before dawn. Her Saturday bake is stuck in the pending line behind a fee nobody can pay.",
    caption: "Aunt Mainnet’s window, this morning. The sign is not a joke.",
    photo: "Aunt Mainnet behind her bakery window: bare shelves, and a handwritten sign that reads “Sorry, no bread today. Fees up 400%.”",
  },
  /** The second panel: her dark sign and the queue. */
  queue: {
    caption: "Meanwhile, outside Aunt Mainnet’s…",
    line: "The OPEN sign is dark. The queue waits anyway.",
  },
  bearsonLine: "Find out who’s pricing this city out. I already know. Prove it.",
  bearsonAside: "And bring me a loaf.",
  /** The ending's front page, and the Rug's lead after a clear. */
  found: {
    headline: "Fees fall. Loaf rises.",
    dek: "Aunt Mainnet’s Loaf reopens after a night-long fee strike. The goblin behind it was found first in line.",
    story: (hero: string) => [
      `Gas Goblin spiked every fee in the Mempool Market overnight, leaving the city’s most reliable bakery unable to pay for its own oven. ${hero} chased him across the rooftops to her roof and cooled the fee meter by hand.`,
      `Aunt Mainnet handed out slices to everyone, the Goblin included. “${FEE_STRIKE_LINES.slice}”`,
    ],
    caption: "Pictured: Gas Goblin, webbed to Aunt Mainnet’s chimney, holding a loaf he paid full price for.",
    photo: "Gas Goblin webbed to a brick chimney at dawn, a warm loaf steaming in front of him, Aunt Mainnet beside him and the fee meter back in the green.",
    /** Bearson's small "also found" note: the thread to the next case. */
    thread: FEE_STRIKE_LINES.thread,
  },
  /** When the night ended with him gone, or the hero down. */
  open: "Gas Goblin is still holding the meter. Bearson is holding the front page.",
  byline: "By J. Jonah Bearson, who wants it known he paid for his loaf",
  /** The badge's sticker. */
  badge: FEE_STRIKE_LINES.badge,
} as const;

/** The X post a player sends about their clear: their words, from their own account. */
export function case003ShareText(link = `${SITE_URL}${CASE_003_PATHS.intro}`): string {
  return `I cooled the fees and got the loaf back in With Great Power. Case file 003: closed 🕸️ ${link}`;
}
