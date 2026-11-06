/**
 * Story chapters ("case files"): content, and what a clear does to the save. A chapter is
 * its own deterministic night (sim3d/chapter.ts), pinned by CHAPTER_RULESET and played,
 * verified and recorded apart from patrols: never on a board, never a Bits mint. The first
 * verified clear closes the case in the save, pays CASE_XP and queues a soulbound badge
 * (`trophy:badge:<id>`); later clears only improve the best time.
 *
 * Pure: the clock comes in as an argument.
 */
import { HP_PER_LEVEL, POWERS, VILLAINS, XP_TO_NEXT } from "./data";
import type { CaseRecord, ChapterId, Hero, Save, VillainId } from "./types";

/** Case File 001, "Missing: Mary Jpeg". */
export const CHAPTER_ID = "case-001" satisfies ChapterId;
/** The chapter's rules version, recorded with every chapter run (`runs.ruleset`). Bump it with any change to the chapter's sim. */
export const CHAPTER_RULESET = "c001-1";

/** Case File 002, "The Sybil Vote". */
export const CASE_002_ID = "case-002" satisfies ChapterId;
/** Case File 002's rules version (`runs.ruleset`). Bump it with any change to its sim (sim3d/vote.ts, sybil-vote.ts). */
export const CASE_002_RULESET = "c002-1";

export const CHAPTER_IDS: readonly ChapterId[] = [CHAPTER_ID, CASE_002_ID];

/**
 * A clue's id. Case File 001's: torn tabs, a cursor scorch, loose pixels. Case File 002's: the
 * three drop boxes' finds, each revealing one of the real Sybil's tells (TELL_OF_CLUE).
 */
export type ClueId = "tabs" | "cursor" | "pixels" | "footage" | "gif" | "signature";

/** Case File 002: the real Sybil's tells, each one bit of a voter's look (sim3d/vote.ts). */
export type TellId = "shadow" | "blink" | "left";
/** Which tell each of Case File 002's clues reveals. */
export const TELL_OF_CLUE: Partial<Record<ClueId, TellId>> = { footage: "shadow", gif: "blink", signature: "left" };
/** A voter's tells as bits: shadow 1 (casts one), blink 2 (blinks), left 4 (holds his ballot in his left hand). */
export const TELL_BIT: Record<TellId, number> = { shadow: 1, blink: 2, left: 4 };

export interface ChapterInfo {
  id: ChapterId;
  /** "001". */
  number: string;
  title: string;
  ruleset: string;
  /** The badge the first verified clear mints, as `trophy:badge:<badge>`. */
  badge: string;
  villain: { name: string; tagline: string; taunt: string; defeat: string };
  captive: { name: string; freed: string };
  /** Each clue's case note, in the order the city places them (any order to find). */
  clues: { id: ClueId; name: string; note: string }[];
  /**
   * Case File 002: what each clue says about the real Sybil, by the tell's value tonight (the
   * seed sets it): `yes` when he has it (casts a shadow, blinks, holds his ballot left-handed).
   */
  tells?: Partial<Record<ClueId, { tell: TellId; yes: string; no: string }>>;
}

export const CHAPTERS: Record<ChapterId, ChapterInfo> = {
  "case-001": {
    id: "case-001",
    number: "001",
    title: "Missing: Mary Jpeg",
    ruleset: CHAPTER_RULESET,
    badge: "case-001",
    villain: {
      name: "The Right-Clicker",
      tagline: "Saves everything. Owns nothing.",
      taunt: "Nice suit. Mind if I save it?",
      defeat: "The Right-Clicker is webbed to the railing. His Downloads folder is emptied.",
    },
    captive: { name: "Mary Jpeg", freed: "gm" },
    clues: [
      { id: "tabs", name: "Torn tabs", note: "Somebody tore off a tab. Then all of them." },
      { id: "cursor", name: "Cursor scorch", note: "Scorched in the shape of a pointer. Left-click? No. Right." },
      { id: "pixels", name: "Loose pixels", note: "Pixels. Big ones. Someone's been compressing." },
    ],
  },
  "case-002": {
    id: "case-002",
    number: "002",
    title: "The Sybil Vote",
    ruleset: CASE_002_RULESET,
    badge: "case-002",
    villain: {
      name: "The Sybil",
      tagline: "One man. Ten thousand votes.",
      taunt: "All in favour? All of me.",
      defeat: "The Sybil is webbed to the ballot box. Every copy of him votes to go home.",
    },
    captive: { name: "Uncle Gen", freed: "Counted." },
    clues: [
      { id: "signature", name: "Smudged signature", note: "Ten thousand ballots, one signature. Same pen, same slant." },
      { id: "footage", name: "Booth footage", note: "A CCTV still from the booth. Somebody stuffed this box in person." },
      { id: "gif", name: "Looping sticker", note: "An “I voted” sticker that loops. Some of his copies were saved as GIFs." },
    ],
    tells: {
      signature: { tell: "left", yes: "Every signature slants left. The real one holds his ballot in his left hand.", no: "Every signature slants right. The real one holds his ballot in his right hand." },
      footage: { tell: "shadow", yes: "In the footage he casts a shadow. Most of his copies are flat files: they don’t.", no: "In the footage he casts no shadow: he stood in the booth’s shade. Some copies have shadows baked in." },
      gif: { tell: "blink", yes: "The GIF copies blink on a loop, and so does he: the real one blinks.", no: "The real one hasn’t blinked since the polls opened. Only the GIF copies blink." },
    },
  },
};

/** Case File 002's Sybil: his moves and their damage at level 1 (scaled by damageScale like every villain's). */
export const SYBIL_VOTE_MOVES: readonly { label: string; value: number }[] = [
  { label: "Fake vote", value: 15 },
  { label: "Swarm", value: 7 },
  { label: "Fork vote", value: 24 },
  { label: "Duplicate", value: 0 },
  { label: "Paper cut", value: 5 },
];

/** A clue's note for tonight: Case File 002's say what they reveal about the real Sybil (`tells`, his bits). */
export function clueNote(id: ChapterId, clue: ClueId, tells = 0): string {
  const info = CHAPTERS[id];
  const t = info.tells?.[clue];
  if (t) return (tells & TELL_BIT[t.tell]) !== 0 ? t.yes : t.no;
  return info.clues.find((c) => c.id === clue)?.note ?? "";
}

/** The Right-Clicker's moves and their damage at level 1 (scaled by damageScale like every villain's). */
export const RIGHT_CLICKER_MOVES: readonly { label: string; value: number }[] = [
  { label: "Screenshot", value: 12 },
  { label: "Ctrl+C", value: 0 },
  { label: "Drag", value: 7 },
  { label: "Paper cut", value: 5 },
];

/** XP for closing a case the first time (a level-1 hero needs 100 for level 2). */
export const CASE_XP = 100;

export const isChapterId = (v: unknown): v is ChapterId => typeof v === "string" && (CHAPTER_IDS as readonly string[]).includes(v);

/** A villain's name and lines: a patrol villain's, or a chapter's (the Right-Clicker, who isn't in VILLAINS). */
export function villainCard(id: VillainId | "right-clicker"): { name: string; taunt: string; defeat: string } {
  const v = id === "right-clicker" ? CHAPTERS["case-001"].villain : VILLAINS[id];
  return { name: v.name, taunt: v.taunt, defeat: v.defeat };
}

/** The save's record of a case, or an open one. */
export function caseRecord(save: Pick<Save, "cases">, id: ChapterId): CaseRecord {
  return save.cases?.[id] ?? { cleared: false, clearedAt: null, bestTicks: null, verified: false };
}

/** XP on the hero, levelling up as finish-patrol does (more health, a power to pick). */
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

export interface CaseClear {
  save: Save;
  /** The case wasn't closed before (in this save, verified or not, as `verified` asks). */
  firstClear: boolean;
  record: CaseRecord;
}

/**
 * Close a case in a save after a clear of `ticks` at `at` (ISO). The first clear of its kind
 * pays CASE_XP; a later one only lowers `bestTicks`. `verified`: the server replayed it. A
 * guest's local clear (`verified: false`) never pays XP twice either, and a verified clear on
 * a save holding only a local one counts as the first.
 */
export function applyCaseClear(save: Save, id: ChapterId, ticks: number, at: string, verified: boolean): CaseClear {
  const before = caseRecord(save, id);
  const whole = Math.max(0, Math.floor(ticks));
  const first = verified ? !before.verified : !before.cleared;
  const record: CaseRecord = {
    cleared: true,
    clearedAt: first || !before.clearedAt ? at : before.clearedAt,
    bestTicks: before.bestTicks === null || first ? whole : Math.min(before.bestTicks, whole),
    verified: verified || before.verified,
  };
  const hero = first && save.hero ? addXp(save.hero, CASE_XP) : save.hero;
  return { save: { ...save, hero, cases: { ...save.cases, [id]: record } }, firstClear: first, record };
}
