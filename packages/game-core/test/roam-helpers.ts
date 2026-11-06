/** Shared helpers for the free-roam tests: play the scripted bot through goals and record what happened. */
import { startRoamRun, stepRoamRun, type RoamRun, type RoamRunEvent } from "../src/roam-run";
import { newRoamBot, roamBotFrame, type RoamBotGoal } from "../src/sim3d/roam/bot";
import { freshStart } from "../src/sim3d/roam/step";
import type { RoamMove, RoamStart } from "../src/sim3d/roam/types";

export interface RoamPlay {
  run: RoamRun;
  events: { tick: number; e: RoamRunEvent }[];
  /** Every move the body went through, in order (repeats collapsed). */
  moves: RoamMove[];
  /** Ticks spent in each move. */
  time: Partial<Record<RoamMove, number>>;
  /** Highest horizontal speed seen in each move. */
  top: Partial<Record<RoamMove, number>>;
  /** Whether the bot reached the end of its goals. */
  finished: boolean;
  /** The hero's health stayed full throughout (nothing hurts in free roam). */
  unhurt: boolean;
}

export const at = (x: number, y: number, z: number, fx = 1, fz = 0, base: Partial<RoamStart> = {}): RoamStart => ({ ...freshStart(), ...base, at: { x, y, z, fx, fz } });

/**
 * Empty the streets of a run (a test of a move that isn't about traffic): every car parked far
 * out of the city, out of its grid's way, and none stepped. The state stays a valid outing's.
 */
export function quiet(run: RoamRun): RoamRun {
  const t = run.sim.roam!.traffic;
  for (const c of t.cars) run.sim.grid.moveSolid(c.box, -1e6, -1e6, -1e6, -1e6 + 1, -1e6 + 1, -1e6 + 1);
  t.cars.length = 0;
  return run;
}

export function playRoam(start: RoamStart, goals: RoamBotGoal[], maxTicks = 60 * 60, opts: { traffic?: boolean } = {}): RoamPlay {
  const run = startRoamRun(start);
  if (opts.traffic === false) quiet(run);
  const mem = newRoamBot(goals);
  const events: RoamPlay["events"] = [];
  const moves: RoamMove[] = [run.sim.roam!.body.move];
  const time: RoamPlay["time"] = {};
  const top: RoamPlay["top"] = {};
  let unhurt = true;
  for (let t = 0; t < maxTicks && mem.i < goals.length; t++) {
    for (const e of stepRoamRun(run, roamBotFrame(run.sim, mem))) events.push({ tick: run.sim.tick, e });
    const m = run.sim.roam!.body.move;
    if (moves[moves.length - 1] !== m) moves.push(m);
    time[m] = (time[m] ?? 0) + 1;
    const h = run.sim.hero;
    const hs = Math.sqrt(h.vx * h.vx + h.vz * h.vz);
    if (hs > (top[m] ?? 0)) top[m] = hs;
    if (run.sim.hp !== run.sim.maxHp) unhurt = false;
  }
  return { run, events, moves, time, top, finished: mem.i >= goals.length, unhurt };
}

/** The moves of a play as one string ("ground>air>roll>ground"), for readable expectations. */
export const chain = (p: RoamPlay) => p.moves.join(">");
