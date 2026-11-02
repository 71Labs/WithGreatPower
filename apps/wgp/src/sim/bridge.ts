/**
 * Between the sim and the engine: how a save becomes a sim (including resuming after a
 * reload from `patrol.index` / `phase` / `results`), and which engine action each sim
 * event means. Used by the browser loop and by scripts/sim-check.ts, so the check plays
 * the exact flow the game does.
 */
import { powerScale } from "@wgp/game-core/data";
import type { Action } from "@wgp/game-core/engine";
import type { Save } from "@wgp/game-core/types";

import type { SimConfig, SimEvent } from "./core";

export type SessionStart =
  | { kind: "none" }
  | { kind: "start" }
  | { kind: "leave" }
  | { kind: "summary" }
  | { kind: "play"; config: SimConfig };

/** What to do with a save when the game screen opens. */
export function sessionStart(save: Save): SessionStart {
  const p = save.patrol;
  const hero = save.hero;
  if (!p || !hero) return { kind: "none" };
  if (p.phase === "briefing") return { kind: "start" };
  if (p.phase === "summary") return { kind: "summary" };
  // The stop was finished before the reload: move on first.
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

/** The engine action a sim event means, if any. */
export function actionFor(ev: SimEvent): Action | null {
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
