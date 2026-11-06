/**
 * Between the 3D sim and the engine: how a save becomes a sim config, and which engine
 * action each sim event means (sim-arrive, sim-fight, errand, leave-stop). The replay
 * driver, the server verifier and the browser all go through here, so they play the exact
 * same flow.
 */
import { ERRANDS, HERO_BASE_HP, MAX_FLUID, powerScale } from "./rules/data";
import type { Action } from "./rules/engine";
import type { ChapterId, Save, Stop, TrialCourseId } from "./rules/types";
import { chapterStops } from "./sim3d/chapter";
import { COURSE_GEOMETRY } from "./sim3d/trial";
import type { SimConfig, SimEvent } from "./sim3d/types";

/**
 * A story chapter's sim config from a save (Case File 001): the hero at full health and
 * fluid with their loadout and one Gwei call, on the chapter's own stage. Null without a hero.
 */
export function chapterConfig(save: Save, seed: number, chapter: ChapterId): SimConfig | null {
  const hero = save.hero;
  if (!hero) return null;
  const loadout = hero.loadout.filter((id) => hero.powers[id]).map((id) => ({ id, scale: powerScale(hero.powers[id]?.mastery ?? 0) }));
  return {
    seed: seed >>> 0,
    stops: chapterStops(chapter),
    index: 0,
    entry: "travel",
    hp: hero.maxHp,
    maxHp: hero.maxHp,
    fluid: MAX_FLUID,
    combo: 0,
    gweiCalls: 1,
    heroLevel: hero.level,
    loadout,
    chapter,
  };
}

/**
 * A time trial's sim config from a save (rules/compete.ts trialSave): the hero at full health
 * and fluid on the course's own city, with no powers and no Gwei (a race is movement alone).
 * The course fixes the seed, so every run of a course is the same race. Null without a hero.
 */
export function trialConfig(save: Save, course: TrialCourseId): SimConfig | null {
  if (!save.hero) return null;
  return {
    seed: COURSE_GEOMETRY[course].seed >>> 0,
    stops: [],
    index: 0,
    entry: "travel",
    hp: HERO_BASE_HP,
    maxHp: HERO_BASE_HP,
    fluid: MAX_FLUID,
    combo: 0,
    gweiCalls: 0,
    heroLevel: 1,
    loadout: [],
    trial: course,
  };
}

export type SessionStart3D =
  | { kind: "none" }
  | { kind: "start" }
  | { kind: "leave" }
  | { kind: "summary" }
  | { kind: "play"; config: SimConfig };

/** What to do with a save when the 3D game opens (the 2D bridge's sessionStart). */
export function sessionStart3d(save: Save): SessionStart3D {
  const p = save.patrol;
  const hero = save.hero;
  if (!p || !hero) return { kind: "none" };
  if (p.phase === "briefing") return { kind: "start" };
  if (p.phase === "summary") return { kind: "summary" };
  // The stop was finished before a reload: move on first.
  if (p.phase === "stop" && p.results.length > p.index) return { kind: "leave" };
  const loadout = hero.loadout.filter((id) => hero.powers[id]).map((id) => ({ id, scale: powerScale(hero.powers[id]?.mastery ?? 0) }));
  return {
    kind: "play",
    config: {
      seed: p.seed,
      stops: p.stops,
      index: p.index,
      entry: p.phase === "stop" ? "zone" : "travel",
      hp: p.hp,
      maxHp: p.maxHp,
      fluid: p.fluid,
      combo: p.combo,
      gweiCalls: p.gweiCalls,
      heroLevel: hero.level,
      loadout,
    },
  };
}

/** The engine action a sim event means, if any. Errands are separate: see errandActions. */
export function actionFor3d(ev: SimEvent): Action | null {
  switch (ev.type) {
    case "arrive":
      return {
        type: "sim-arrive",
        hp: ev.hp,
        fluid: ev.fluid,
        perfect: ev.perfect,
        good: ev.good,
        miss: ev.miss,
        combo: ev.combo,
        uses: ev.uses,
      };
    case "fight-won":
      return { type: "sim-fight", won: true, hp: ev.hp, fluid: ev.fluid, uses: ev.uses, gweiCalls: ev.gweiUsed };
    case "ko":
      return { type: "sim-fight", won: false, hp: 0, fluid: ev.fluid, uses: ev.uses, gweiCalls: ev.gweiUsed };
    case "stop-done":
      return { type: "leave-stop" };
    case "night-over":
      // After a knockout the stop still needs leaving; after the route it was left already.
      return ev.reason === "ko" ? { type: "leave-stop" } : null;
    default:
      return null;
  }
}

/** The errand at the patrol's current stop, if it is one. */
export function currentErrand(save: Save) {
  const p = save.patrol;
  const stop = p?.stops[p.index] as Stop | undefined;
  if (!p || stop?.kind !== "errand") return null;
  return ERRANDS.find((e) => e.id === stop.errand) ?? null;
}

/**
 * The engine actions for choosing option `value` at the current errand: the choice, then
 * leaving the stop. Null if the choice doesn't exist.
 */
export function errandActions(save: Save, value: number): Action[] | null {
  const errand = currentErrand(save);
  const choice = errand?.choices[value];
  if (!errand || !choice) return null;
  return [{ type: "errand", choice: choice.id }, { type: "leave-stop" }];
}
