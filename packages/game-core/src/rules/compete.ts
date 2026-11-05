/**
 * Competitive modes: the Daily Run and time trials. Pure rules and content, shared by the
 * browser and the server verifier; the clock always comes in as an argument.
 *
 * - The Daily Run (mode "daily") is a patrol night on the existing ruleset-4 sim, unchanged:
 *   everyone plays the same seed each UTC day (the server derives it from the date and a
 *   secret) on the same standard hero, dailySave(day). Only the seed source and the board
 *   differ from a ranked night: verified like one, never on the Season boards, never banked.
 *   The day's kit (dailyKit) rotates the hero's powers, so each day plays a little differently.
 * - Time trials (mode "trial", TRIAL_RULESET "trial-1"): a short course of gates through a
 *   fixed city (sim3d/trial.ts), on a hero with no powers. Medals by time; a per-course board.
 * - Duels: a ranked night raced again on its own seed and start save (duelSave), as an
 *   unranked trial run: verified, never on a Season board.
 *
 * Every run is replay-verified, so every run is also a ghost (ghost.ts).
 */
import { HERO_BASE_HP, HP_PER_LEVEL, STARTER_POWERS, SUITS } from "./data";
import { newSave, reduce } from "./engine";
import type { PowerId, Save, SuitId, TrialCourseId } from "./types";
import { RULESET_VERSION, SIM_HZ } from "../sim3d/constants";
import { COURSE_GEOMETRY, isTrialCourse, TRIAL_COURSE_IDS, TRIAL_MAX_SECONDS } from "../sim3d/trial";

export { isTrialCourse, TRIAL_COURSE_IDS, TRIAL_MAX_SECONDS };

/** The run modes these rules add (`runs.mode`). Patrol nights keep "patrol", chapters their id. */
export const DAILY_MODE = "daily";
export const TRIAL_MODE = "trial";
export type CompeteMode = typeof DAILY_MODE | typeof TRIAL_MODE;

/** A Daily Run is a ranked-style patrol night: the patrol's ruleset, unchanged. */
export const DAILY_RULESET = String(RULESET_VERSION);
/** Time trials' rules version (`runs.ruleset`). Bump it with any change to sim3d/trial.ts or the medal times. */
export const TRIAL_RULESET = "trial-1";
/** `runs.course` of a duel: a ranked night raced again (a trial run on the patrol's ruleset). */
export const DUEL_COURSE = "duel";

/** Daily Runs a player may start each UTC day; the best one counts. */
export const DAILY_ATTEMPTS = 3;
/** The night the Daily is set on (villains at level 2) and the standard hero's level. */
export const DAILY_NIGHT = 3;
export const DAILY_LEVEL = 3;

/* ------------------------------------------------------------------ days */

/** "YYYY-MM-DD", a UTC day. */
export const isDayKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** FNV-1a over a string: a public, stable number for a day (never the seed, which is secret). */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A tiny seeded generator (mulberry32), for the day's kit. */
function next(state: number): [number, number] {
  const n = (state + 0x6d2b79f5) | 0;
  let t = n;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, n];
}

const ADVANCED: PowerId[] = ["web-bomb", "gas-refund", "fork", "zk-cloak", "front-run", "validator-slam"];

/** The day's kit: three starter powers and one advanced, the same for everyone, public before the run. */
export function dailyKit(day: string): PowerId[] {
  let s = fnv(`wgp-daily-kit\0${day}`);
  const pool = [...STARTER_POWERS];
  const out: PowerId[] = [];
  for (let k = 0; k < 3; k++) {
    const [r, n] = next(s);
    s = n;
    out.push(pool.splice(Math.floor(r * pool.length), 1)[0]);
  }
  const [r] = next(s);
  out.push(ADVANCED[Math.floor(r * ADVANCED.length)]);
  return out;
}

/** What a player brings to a standard hero: only how they look. */
export interface HeroLook {
  name?: string | null;
  suit?: SuitId | null;
}

const lookName = (look?: HeroLook) => (look?.name ?? "").trim().slice(0, 24).trim() || "The Node";
const lookSuit = (look?: HeroLook): SuitId => (look?.suit && SUITS[look.suit] ? look.suit : "classic");

/**
 * The Daily Run's start save for `day`: the same standard hero for everyone (level
 * DAILY_LEVEL, the day's kit, no mastery) on night DAILY_NIGHT with no quest, so the seed
 * makes the same city and stops for every player. `look` only names and dresses the hero.
 */
export function dailySave(day: string, look?: HeroLook): Save {
  const kit = dailyKit(day);
  const starters = kit.slice(0, 3);
  const base = reduce(newSave(), { type: "create-hero", name: lookName(look), suit: "classic", powers: starters });
  const hero = base.hero!;
  const suit = lookSuit(look);
  return {
    ...base,
    night: DAILY_NIGHT,
    suits: [suit],
    hero: {
      ...hero,
      level: DAILY_LEVEL,
      maxHp: HERO_BASE_HP + HP_PER_LEVEL * (DAILY_LEVEL - 1),
      powers: Object.fromEntries(kit.map((p) => [p, { mastery: 0 }])),
      loadout: kit,
      suit,
      createdNight: DAILY_NIGHT,
    },
  };
}

/** A time trial's start save: a level 1 hero with no powers (trialConfig gives none anyway), dressed as the player. */
export function trialSave(look?: HeroLook): Save {
  const base = reduce(newSave(), { type: "create-hero", name: lookName(look), suit: "classic", powers: ["web-sling", "web-shield", "node-sense"] });
  const suit = lookSuit(look);
  return { ...base, suits: [suit], hero: { ...base.hero!, suit } };
}

/**
 * A duel's start save: the ghost's own run-start save (the same hero, night and quest, so the
 * same city and stops from its seed), named and dressed as the challenger.
 */
export function duelSave(ghostStart: Save, look?: HeroLook): Save {
  if (!ghostStart.hero) return ghostStart;
  const suit = lookSuit(look);
  return { ...ghostStart, hero: { ...ghostStart.hero, name: lookName(look), suit } };
}

/* ------------------------------------------------------------------ courses and medals */

export type Medal = "bronze" | "silver" | "gold" | "dev";
/** Medals from the least to the best; `medalTier` is the index + 1 (0: none). */
export const MEDALS: readonly Medal[] = ["bronze", "silver", "gold", "dev"];
export const MEDAL_LABEL: Record<Medal, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", dev: "Dev time" };

export interface CourseInfo {
  id: TrialCourseId;
  /** "01". */
  number: string;
  name: string;
  /** One line under the name. */
  blurb: string;
  /** Where in the city. */
  district: string;
  /** The course's (and every run's) seed: a course is the same race every time. */
  seed: number;
  gates: number;
  /**
   * The time to beat for each medal, sim ticks (60 a second). "dev" is the course designer's
   * verified run (the golden log, test/golden/trial-<id>.bin); gold, silver and bronze are
   * slower by fixed margins. Pinned by TRIAL_RULESET.
   */
  medals: Record<Medal, number>;
}

/** The medal times from the dev time: gold +15%, silver +40%, bronze +80%, rounded to a tenth of a second. */
function medalsFrom(devTicks: number): Record<Medal, number> {
  const tenth = SIM_HZ / 10;
  const round = (t: number) => Math.ceil(t / tenth) * tenth;
  return { dev: devTicks, gold: round(devTicks * 1.15), silver: round(devTicks * 1.4), bronze: round(devTicks * 1.8) };
}

/** The dev times (ticks): the golden runs' finishes (test/trial-golden.test.ts checks they match). */
// <dev-ticks>
export const DEV_TICKS: Record<TrialCourseId, number> = {
  "rooftop-sprint": 489,
  "bridge-run": 403,
  "canyon-swing": 324,
  "tower-climb": 488,
  "gauntlet": 1116
};
// </dev-ticks>

const course = (id: TrialCourseId, number: string, name: string, blurb: string, district: string): CourseInfo => ({
  id,
  number,
  name,
  blurb,
  district,
  seed: COURSE_GEOMETRY[id].seed,
  gates: COURSE_GEOMETRY[id].gates.length,
  medals: medalsFrom(DEV_TICKS[id]),
});

export const COURSES: Record<TrialCourseId, CourseInfo> = {
  "rooftop-sprint": course("rooftop-sprint", "01", "Rooftop sprint", "Brownstone to brownstone, flat out. Don’t touch the street.", "Queens Block"),
  "bridge-run": course("bridge-run", "02", "Bridge run", "Down Doc’s bridge, tower to tower, before he notices.", "Bridge District"),
  "canyon-swing": course("canyon-swing", "03", "Canyon swing", "Low through the towers of the Heights. Low means low.", "Validator Heights"),
  "tower-climb": course("tower-climb", "04", "Tower climb", "Roof to higher roof to the top of the Heights.", "Validator Heights"),
  gauntlet: course("gauntlet", "05", "The gauntlet", "Roofs, a street dive, the bridge and a climb. All of it.", "Across the city"),
};

/** The medal a finish of `ticks` earns on a course, or null (finished, but slower than bronze). */
export function medalFor(id: TrialCourseId, ticks: number): Medal | null {
  const m = COURSES[id].medals;
  if (ticks <= m.dev) return "dev";
  if (ticks <= m.gold) return "gold";
  if (ticks <= m.silver) return "silver";
  if (ticks <= m.bronze) return "bronze";
  return null;
}

/** A medal as a number for boards: 0 none, 1 bronze … 4 dev time. */
export const medalTier = (m: Medal | null): number => (m ? MEDALS.indexOf(m) + 1 : 0);
export const medalOfTier = (tier: number): Medal | null => MEDALS[tier - 1] ?? null;

/* ------------------------------------------------------------------ comparing runs */

/** A run as a board compares it. A trial ranks finishes by time; a Daily or a duel by score, then time. */
export interface RaceResult {
  score: number;
  ticks: number;
  /** Trials: through the finish. Patrol runs: always true (a knockout still scores). */
  finished: boolean;
}

/** Negative when `a` beats `b`, positive when `b` beats `a`, 0 for a dead heat. */
export function compareRuns(kind: "trial" | "patrol", a: RaceResult, b: RaceResult): number {
  if (kind === "trial") {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return a.ticks - b.ticks;
  }
  if (a.score !== b.score) return b.score - a.score;
  return a.ticks - b.ticks;
}

/** Ticks as "m:ss.t" (a race clock), e.g. 1:04.3. */
export function raceClock(ticks: number): string {
  const tenths = Math.floor((Math.max(0, ticks) * 10) / SIM_HZ);
  const m = Math.floor(tenths / 600);
  const s = Math.floor(tenths / 10) % 60;
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

/** A gap in ticks as a signed "+2.4 s" / "−0.8 s" (positive: behind). */
export function raceGap(ticks: number): string {
  const tenths = Math.round((Math.abs(ticks) * 10) / SIM_HZ);
  const sign = ticks > 0 ? "+" : ticks < 0 ? "−" : "±";
  return `${sign}${Math.floor(tenths / 10)}.${tenths % 10} s`;
}

export const isCourseOrDuel = (v: unknown): v is TrialCourseId | typeof DUEL_COURSE => v === DUEL_COURSE || isTrialCourse(v);
