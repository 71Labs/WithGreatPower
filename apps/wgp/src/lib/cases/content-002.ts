/**
 * Case file 002, "The Sybil Vote": every word and picture the UI shows for it, in The Daily
 * Rug's voice (docs/story/bible.md). Sentence case, curly quotes, no prizes or money. The clue
 * notes and the villain's lines come from the game's content (game-core rules/chapters.ts), so
 * the sim, the HUD and the pages say the same thing.
 */
import { CHAPTERS, clueNote, TELL_BIT, type ClueId, type TellId } from "@wgp/game-core/chapters";

import { SITE_URL } from "@/lib/site";

export const CASE_002_ID = "case-002" as const;

/** Where the intro lives and where "Start the case" goes. */
export const CASE_002_PATHS = {
  list: "/play/cases",
  intro: "/play/cases/002",
  play: "/play/patrol?case=002",
} as const;

const INFO = CHAPTERS[CASE_002_ID];

/** The villain's name and lines (game-core rules/chapters.ts). */
export const SYBIL = { name: INFO.villain.name, tagline: INFO.villain.tagline, taunt: INFO.villain.taunt, defeat: INFO.villain.defeat };

export interface TellCopy {
  id: TellId;
  /** What it's about, for the suspect profile ("Shadow"). */
  label: string;
  /** The real one's look, in words, either way. */
  yes: string;
  no: string;
  /** The clue that reveals it. */
  clue: ClueId;
}

/** The three tells, in the order the suspect profile lists them. */
export const TELLS: readonly TellCopy[] = [
  { id: "shadow", label: "Shadow", yes: "Casts a shadow", no: "No shadow", clue: "footage" },
  { id: "blink", label: "Eyes", yes: "Blinks", no: "Never blinks", clue: "gif" },
  { id: "left", label: "Ballot", yes: "Ballot in his left hand", no: "Ballot in his right hand", clue: "signature" },
];

export interface VoteClueCopy {
  id: ClueId;
  name: string;
  /** Where it was, for the city map. */
  where: string;
  /** What it tells, by the tell's value tonight. */
  note(real: number): string;
  tell: TellId;
}

export const VOTE_CLUES: readonly VoteClueCopy[] = [
  { id: "footage", name: "Booth footage", where: "Taped to a drop box, by a billboard", tell: "shadow", note: (real) => clueNote(CASE_002_ID, "footage", real) },
  { id: "gif", name: "Looping sticker", where: "On a drop box near the polling station", tell: "blink", note: (real) => clueNote(CASE_002_ID, "gif", real) },
  { id: "signature", name: "Smudged signature", where: "Jammed in a rooftop drop box", tell: "left", note: (real) => clueNote(CASE_002_ID, "signature", real) },
];

export const voteClueCopy = (id: ClueId): VoteClueCopy => VOTE_CLUES.find((c) => c.id === id) ?? VOTE_CLUES[0];

/** The real one's look on one tell, in words ("Casts a shadow"). */
export function tellWords(tell: TellCopy, real: number): string {
  return (real & TELL_BIT[tell.id]) !== 0 ? tell.yes : tell.no;
}

export const CASE_002 = {
  id: CASE_002_ID,
  number: "002",
  title: INFO.title,
  district: "Validator Heights",
  summary:
    "The city votes on a new bridge toll tonight, and turnout is ten thousand percent. Every extra voter is the same man. Read the drop boxes, find the real Sybil in the line, and get Uncle Gen’s vote counted.",
  facts: [
    { label: "Turnout", value: "10,000% and rising" },
    { label: "Voters", value: "One man, saved many times" },
    { label: "Wanted", value: "The original" },
  ],
  steps: ["Read three drop boxes in Validator Heights.", "Find the real Sybil in the line and mark him.", "Win the vote, then get Uncle Gen’s ballot counted."],
  /** The intro's front page. */
  gone: {
    headline: "Turnout: 10,000%",
    dek: "Polls in Validator Heights report record numbers. Officials report the numbers all have the same face.",
    caption: "Voters queue for the bridge toll vote. All of them. Him.",
  },
  line: { caption: "The polling station, Validator Heights roof", bubble: "We’re all here to vote.", aside: "Some of us more than others." },
  bearsonLine: "Find the real one. Then find me a headline.",
  bearsonAside: "And make sure your uncle votes. He keeps calling.",
  gen: { line: "With great power comes great gas fees. And one vote. Mine.", name: INFO.captive.name },
  /** The ending's front page, and the Rug's lead after a clear. */
  found: {
    headline: "Toll fails by one vote",
    dek: "The bridge toll is voted down, 1 to 0. Nine thousand nine hundred and ninety-nine other ballots were the same man and didn’t count.",
    story: (hero: string) => [
      `The Sybil stuffed the Validator Heights ballot box with copies of himself, saved from a Downloads folder that should have stayed shut. ${hero} picked the real one out of the line and webbed him to the box.`,
      "The deciding vote was cast by Uncle Gen, who has voted in every election since genesis and would like that noted. This paper notes it. The receipts for ten thousand voters, meanwhile, all point at the bridge.",
    ],
    caption: "Pictured: Uncle Gen, counted. The Sybil, not.",
    byline: "By J. Jonah Bearson, who counted himself",
  },
  /** The Downloads file this case recovers (the season's arc). */
  recovered: "voter_roll_FINAL.csv",
} as const;

/** The X post a player sends about their clear: their words, from their own account. */
export function case002ShareText(link = `${SITE_URL}${CASE_002_PATHS.intro}`): string {
  return `I found the real Sybil in With Great Power. Case file 002: closed 🗳️ ${link}`;
}

/** The cast portraits the case's pages show (public/media/cast). */
export const CASE_002_MEDIA = {
  sybil: { width: 720, height: 720, src: "/media/cast/sybil.webp" },
  gen: { width: 720, height: 720, src: "/media/cast/uncle-gen.webp" },
} as const;
