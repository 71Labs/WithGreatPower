/**
 * Case file 001, "Missing: Mary Jpeg": every word and picture the UI shows for it, in The
 * Daily Rug's voice. Sentence case, curly quotes, no prizes or money. The story and its
 * jokes come from the chapter spec (launch/out/chapters/case-001-spec.md).
 */
import { CHAPTERS } from "@wgp/game-core/chapters";

import { SITE_URL } from "@/lib/site";

import { CHAPTER_ID, type ClueId } from "./types";

/** Where the intro lives and where "Start the case" goes. */
export const CASE_PATHS = {
  list: "/play/cases",
  intro: "/play/cases/001",
  play: "/play/patrol?case=001",
} as const;

/** The villain's name and line, from the game's content (game-core rules/chapters.ts). */
export const RIGHT_CLICKER = { name: CHAPTERS["case-001"].villain.name, tagline: CHAPTERS["case-001"].villain.tagline };

export interface ClueCopy {
  id: ClueId;
  /** Short name, for the map and the list. */
  name: string;
  /** Where it was, for the city map. */
  where: string;
  /** The case note that pops up when it's found. */
  note: string;
}

/** In the order the case file lists them (they can be found in any order). */
export const CLUES: readonly ClueCopy[] = [
  { id: "tabs", name: "Torn tabs", where: "On a rooftop", note: "Somebody tore off a tab. Then all of them." },
  { id: "cursor", name: "Cursor scorch", where: "On a billboard", note: "Scorched in the shape of a pointer. Left-click? No. Right." },
  { id: "pixels", name: "Loose pixels", where: "Leading to the bridge", note: "Pixels. Big ones. Someone’s been compressing." },
];

export const clueCopy = (id: ClueId): ClueCopy => CLUES.find((c) => c.id === id) ?? CLUES[0];

export const CASE_001 = {
  id: CHAPTER_ID,
  number: "001",
  title: "Missing: Mary Jpeg",
  district: "Bridge District",
  summary: "Mary Jpeg went quiet after a night in the Bridge District. Somebody right-clicked. Find the clues, stop the thief and bring her back at full quality.",
  /** The case file's facts (the stamp panel and the folder). */
  facts: [
    { label: "Last seen", value: "Being right-click-saved near the Bridge District" },
    { label: "Height", value: "About 1 MB" },
    { label: "Answers to", value: "“gm”" },
  ],
  steps: ["Find three clues in the Bridge District.", "Stop the Right-Clicker on the bridge deck.", "Restore Mary to full quality."],
  poster: {
    alt: "A MISSING poster for Mary Jpeg, taped to a brick wall: last seen being right-click-saved near the Bridge District, height about 1 MB, answers to “gm”. Her photo is slightly compressed.",
  },
  /** The intro's front page. */
  gone: {
    headline: "JPEG gone",
    dek: "Local ally Mary Jpeg hasn’t said “gm” in two days. Witnesses heard a click. Then nothing.",
    caption: "Last known photo. Already compressed.",
  },
  bearsonLine: "Find her before the other papers do.",
  bearsonAside: "And get me pictures. Uncompressed ones.",
  /** The ending's front page, and the Rug's lead after a clear. */
  found: {
    headline: "JPEG found. Slightly more compressed.",
    dek: "Mary Jpeg is back, at roughly 94% quality.",
    story: (hero: string) => [
      `She turned up on the Bridge District deck, saved into the Downloads folder of a hooded nuisance who calls himself the Right-Clicker. ${hero} webbed him to a lamppost, where he is now trying to screenshot the lamppost.`,
      "Mary’s first word was “gm.” This paper’s first word is “exclusive.”",
    ],
    caption: "Pictured: Mary Jpeg, restored. Mostly.",
  },
} as const;

/** The cases still in Bearson’s drafts. */
export const LOCKED_CASES = [{ number: "003", line: "Bearson is still writing." }] as const;

/** The X post a player sends about their clear: their words, from their own account. */
export function caseShareText(link = `${SITE_URL}${CASE_PATHS.intro}`): string {
  return `I found Mary Jpeg in With Great Power. Case file 001: closed 🕸️ ${link}`;
}

/** The poster and Mary's photos in public/media/chapters (AVIF and WebP, a JPEG fallback). */
export const CASE_MEDIA = {
  poster: { width: 480, height: 640, base: "/media/chapters/case-001-poster" },
  compressed: { width: 520, height: 440, base: "/media/chapters/case-001-mary-compressed" },
  restored: { width: 720, height: 720, src: "/media/cast/mary-jpeg.webp" },
} as const;
