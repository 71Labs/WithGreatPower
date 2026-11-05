/**
 * The bot's Case File 003 (bot.ts calls these only when `state.fee` is set): what its progress
 * watchdog measures through the case, and the cooling at the meter. The clues, the meter and
 * the chase are steered like any travel, at stopTarget (fee-strike.ts feeTarget: a clue, the
 * meter, then Gas Goblin); the bakery fight is any Gas Goblin fight.
 */
import type { InputFrame } from "./contract";
import { dirIndex, len2 } from "./dmath";
import { besideMeter, METER_REACH } from "./fee-strike";
import { SPIKE_REACH } from "./fee-strike-step";
import type { SimState } from "./types";

/** The goal the watchdog measures: a key that changes with each clue, phase and checkpoint. */
export function feeGoalKey(s: SimState): number {
  const f = s.fee!;
  const phase = ["investigate", "meter", "chase", "showdown", "cool", "done"].indexOf(f.phase);
  return 1000 + phase * 100 + f.clues.filter((k) => k.found).length * 10 + (f.phase === "chase" ? f.checkpoint + f.losses * 37 : 0);
}

/** The distance the watchdog wants falling: the route left through the chase (Gas Goblin himself keeps moving), else null (the stop's own). */
export function feeGoalDist(s: SimState): number | null {
  const f = s.fee!;
  if (f.phase !== "chase") return null;
  const end = f.route[f.route.length - 1];
  return (end?.at ?? 0) - f.progress;
}

/** Cooling: to the meter and hold the web; step out of a fee spike's ring as it winds up, then back. */
export function coolFrame(s: SimState, shot: InputFrame["shot"], dodge = true): InputFrame {
  const h = s.hero;
  const f = s.fee!;
  const m = f.meter;
  const frame: InputFrame = { dir: 0, mag: 0, web: false, shot };
  const dx = m.x - h.x;
  const dz = m.z - h.z;
  const d = len2(dx, dz);
  if (dodge && f.spikeWind > 0 && d < SPIKE_REACH + 40) {
    frame.dir = dirIndex(-dx || 1, -dz);
    frame.mag = 3;
    return frame;
  }
  if (d > METER_REACH * 0.5) {
    frame.dir = dirIndex(dx, dz);
    frame.mag = 3;
  }
  frame.web = besideMeter(s);
  return frame;
}
