/**
 * Free roam's runs ("outings"): the one driver that plays the City mode from where the save's
 * city record left off, for the browser (live, recording) and the server (verify).
 *
 * - startRoamRun(start) builds an outing; stepRoamRun(run, frame) steps a tick and records it.
 * - roamLog(run) is the canonical input log: the same format as a night's (input/log.ts), its
 *   ruleset field ROAM_LOG_RULESET, so it never replays as a night or a chapter and neither of
 *   those replays as an outing. An outing's log has no events (nothing pauses the city).
 * - replayRoam({ start, log }) replays a whole log from the start the server issued and says
 *   what the outing found (roamOuting): the verifier. resumeRoamRun leaves the run live.
 *
 * The browser and the server both go through stepRoamRun, so a verified outing is exactly the
 * outing that was played. Free roam is never ranked and never mints Bits: what an outing found
 * pays XP once, through rules/city.ts applyOuting.
 */
import { decodeInputCodes, encodeInputCodes, frameCode, frameFromCode, InputLogError } from "./input/log";
import type { CityOuting, CitySpot } from "./rules/city";
import { MAX_TICKS, SIM_HZ } from "./sim3d/constants";
import type { InputFrame } from "./sim3d/contract";
import { ROAM_LOG_RULESET, ROAM_LOG_RULESETS_PAST, ROAM_RULESET } from "./sim3d/roam/constants";
import { roamHashState } from "./sim3d/roam/hash";
import { createRoamSim, stepRoam } from "./sim3d/roam/step";
import { TASK_DONE, TASK_IDS, type RoamEvent, type RoamStart } from "./sim3d/roam/types";
import type { SimEvent, SimState } from "./sim3d/types";
import { HERO_RADIUS } from "./sim3d/constants";

export { ROAM_LOG_RULESET, ROAM_LOG_RULESETS_PAST, ROAM_RULESET };

/**
 * Whether a log is an outing played under older roam rules (roam-1's or roam-2's log field):
 * it can't replay under these, so the server refuses it as stale (start a fresh outing) rather
 * than as a bad log.
 */
export function roamLogStale(log: Uint8Array): boolean {
  try {
    return ROAM_LOG_RULESETS_PAST.includes(decodeInputCodes(log).ruleset);
  } catch {
    return false;
  }
}

export type RoamRunEvent = SimEvent | RoamEvent;

export interface RoamRun {
  /** Where the outing began (the server's copy, for a verified one). */
  readonly start: RoamStart;
  sim: SimState;
  /** Recorded frames (frameCode), one per tick. */
  codes: number[];
  /** State hashes at each find (a task moving on, a page, a viewpoint), to localise a desync. */
  checkpoints: string[];
  /** The last spot he stood on something (where the next outing starts). */
  spot: CitySpot;
  /** Set when a log can't be replayed: the run is dead. */
  error: string | null;
}

const feetSpot = (s: SimState): CitySpot => ({ x: s.hero.x, y: s.hero.y - HERO_RADIUS, z: s.hero.z, fx: s.hero.fx, fz: s.hero.fz });

export function startRoamRun(start: RoamStart): RoamRun {
  const sim = createRoamSim(start);
  return { start, sim, codes: [], checkpoints: [], spot: feetSpot(sim), error: null };
}

/** Whether the outing can take more ticks (its log has room). */
export const roamActive = (run: RoamRun) => !run.error && run.codes.length < MAX_TICKS;

/** Step one tick with `frame` and record it. Returns the tick's events (the night-style web events, then roam's). */
export function stepRoamRun(run: RoamRun, frame: InputFrame): RoamRunEvent[] {
  if (!roamActive(run)) return [];
  const s = run.sim;
  stepRoam(s, frame);
  run.codes.push(frameCode(s.input));
  const events: RoamRunEvent[] = s.events.splice(0);
  const roam = s.roam!.events.splice(0);
  for (const e of roam) {
    if (e.type === "roam-task" || e.type === "roam-page" || e.type === "roam-sync") run.checkpoints.push(roamHashState(s));
    events.push(e);
  }
  const m = s.roam!.body.move;
  if (m === "ground") run.spot = feetSpot(s);
  return events;
}

/** The canonical input log of everything recorded so far. */
export const roamLog = (run: RoamRun): Uint8Array => encodeInputCodes(run.codes, [], 0, ROAM_LOG_RULESET);

export const roamRunHash = (run: RoamRun) => roamHashState(run.sim);

/** What the outing has found so far, as rules/city.ts applyOuting files it. */
export function roamOuting(run: RoamRun): CityOuting {
  const p = run.sim.roam!.progress;
  return { stage: [...p.stage], items: [...p.items], pages: p.pages, views: p.views, at: { ...run.spot } };
}

export interface RoamReplayInput {
  start: RoamStart;
  log: Uint8Array;
}

/** Replay a log (from tick 0) into an outing, leaving it live. `error` says why a log was refused. */
export function resumeRoamRun(input: RoamReplayInput): RoamRun {
  let decoded: ReturnType<typeof decodeInputCodes>;
  const run = startRoamRun(input.start);
  try {
    decoded = decodeInputCodes(input.log);
  } catch (e) {
    run.error = e instanceof InputLogError ? `bad log: ${e.message}` : "bad log";
    return run;
  }
  if (decoded.ruleset !== ROAM_LOG_RULESET) {
    run.error = ROAM_LOG_RULESETS_PAST.includes(decoded.ruleset) ? `ruleset ${decoded.ruleset} is an older free roam's (stale), not ${ROAM_LOG_RULESET}` : `ruleset ${decoded.ruleset} is not free roam's ${ROAM_LOG_RULESET}`;
    return run;
  }
  if (decoded.fromTick !== 0) {
    run.error = "an outing's log starts at tick 0";
    return run;
  }
  if (decoded.events.length) {
    run.error = "an outing's log has no events";
    return run;
  }
  for (let i = 0; i < decoded.codes.length; i++) {
    stepRoamRun(run, frameFromCode(decoded.codes[i]));
    if (run.error) return run;
  }
  return run;
}

export interface RoamReplayResult {
  ok: boolean;
  reason?: string;
  ticks: number;
  hash: string;
  checkpoints: string[];
  /** What it found (stages, items, pages, viewpoints) and where it ended. */
  outing: CityOuting;
  stats: Record<string, number>;
}

/** The verifier: replay a whole outing from its start and report what it found. */
export function replayRoam(input: RoamReplayInput): RoamReplayResult {
  const run = resumeRoamRun(input);
  const s = run.sim;
  const outing = roamOuting(run);
  const result: RoamReplayResult = { ok: !run.error, ticks: s.tick, hash: roamHashState(s), checkpoints: run.checkpoints, outing, stats: roamStats(run) };
  if (run.error) result.reason = run.error;
  return result;
}

/** An outing's stats, as the server stores them. */
export function roamStats(run: RoamRun): Record<string, number> {
  const s = run.sim;
  const p = s.roam!.progress;
  const bits = (n: number) => {
    let c = 0;
    for (let v = n >>> 0; v; v &= v - 1) c += 1;
    return c;
  };
  return {
    roam: 1,
    ticks: s.tick,
    seconds: Math.floor(s.tick / SIM_HZ),
    tasksDone: p.stage.filter((v) => v === TASK_DONE).length,
    tasks: TASK_IDS.length,
    pages: bits(p.pages),
    views: bits(p.views),
    perfect: s.total.perfect,
    good: s.total.good,
  };
}
