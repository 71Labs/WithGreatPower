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

export const CHAPTER_IDS: readonly ChapterId[] = [CHAPTER_ID];

export type ClueId = "tabs" | "cursor" | "pixels";

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
};

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
