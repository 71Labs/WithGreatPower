/**
 * Runs: the one driver that plays a night from a save, a seed and input, for the browser
 * (live, recording), after a reload (resume) and on the server (verify).
 *
 * - startRun(save, seed) starts the patrol from the server's seed and builds the sim.
 * - stepRun(run, frame) steps one tick, records the frame, and dispatches each event's
 *   engine action through `reduce` (bridge3d.actionFor3d).
 * - chooseErrand(run, value) answers an open errand at the current tick and records it.
 * - runLog(run) is the canonical input log so far.
 * - resumeRun(input) replays a partial log back into a live run (reload).
 * - replayRun(input) replays a whole log, finishes the patrol and scores it (verifier).
 *
 * The browser and the server both go through stepRun, so a verified run is exactly the
 * run that was played.
 *
 * Story chapters (Case File 001) are runs too: startChapterRun(save, seed, chapter) plays the
 * chapter's own night on the hero from the save, with no patrol and no engine actions (the
 * save is untouched until the server closes the case: rules/chapters.ts applyCaseClear). Their
 * logs carry chapterLogRuleset(chapter) in the ruleset field, so a chapter log never replays
 * as a patrol night and a patrol log never as a chapter: pass `{ chapter }` to resumeRun and
 * replayRun for a chapter run.
 *
 * Time trials (ruleset "trial-1") are runs the same way: startTrialRun(save, course) races the
 * course on the save's hero (no patrol, no engine actions, the save untouched), and its log
 * carries trialLogRuleset(course): pass `{ trial }` to resumeRun and replayRun.
 */
import { actionFor3d, chapterConfig, currentErrand, errandActions, sessionStart3d, trialConfig } from "./bridge3d";
import { hashState } from "./hash";
import { decodeInputCodes, encodeInputCodes, frameCode, frameFromCode, InputLogError } from "./input/log";
import { isChapterId } from "./rules/chapters";
import { reduce } from "./rules/engine";
import type { ChapterId, Save, Stop, TrialCourseId } from "./rules/types";
import { RULESET_VERSION, scoreRun, type ScoreBreakdown } from "./score";
import { chapterLogRuleset } from "./sim3d/chapter";
import { SIM_HZ } from "./sim3d/constants";
import type { InputEvent, InputFrame, ReplayInput, ReplayResult } from "./sim3d/contract";
import { createSim, resolveErrand, simRunning, stepSim } from "./sim3d/sim";
import { COURSE_GEOMETRY, isTrialCourse, trialLogRuleset } from "./sim3d/trial";
import type { SimEvent, SimState } from "./sim3d/types";

export interface Run {
  /** The save as it stands, every action so far applied. */
  save: Save;
  /** The save at the start of the run (patrol started), what the server stores and replays from. */
  readonly start: Save;
  readonly seed: number;
  sim: SimState;
  /** Recorded frames (frameCode), one per tick stepped. */
  codes: number[];
  /** Recorded errand choices. */
  events: InputEvent[];
  /** State hash each time a stop is left. */
  checkpoints: string[];
  /** The night is over (route finished or knocked out) and every action has been sent. */
  over: boolean;
  /** Set when the engine refused an action or a choice was impossible: the run is dead. */
  error: string | null;
  /** Abilities fired and Gwei calls, for stats. */
  abilities: number;
  gwei: number;
  /** The story chapter this run plays (startChapterRun), or null for a patrol night. */
  readonly chapter: ChapterId | null;
  /** The time trial's course this run races (startTrialRun), or null/absent otherwise. */
  readonly trial?: TrialCourseId | null;
}

/** Whether two stop lists are the same (field by field). */
function sameStops(a: Stop[], b: Stop[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    if (x.kind !== y.kind || x.district !== y.district) return false;
    if (x.kind === "fight" && y.kind === "fight") return x.villain === y.villain && x.level === y.level && x.boss === y.boss && x.quest === y.quest;
    if (x.kind === "errand" && y.kind === "errand") return x.ally === y.ally && x.errand === y.errand;
    return false;
  });
}

/** A run that failed before it began. */
function deadRun(save: Save, seed: number, error: string, chapter: ChapterId | null = null, trial: TrialCourseId | null = null): Run {
  return { save, start: save, seed, sim: null as unknown as SimState, codes: [], events: [], checkpoints: [], over: true, error, abilities: 0, gwei: 0, chapter, ...(trial ? { trial } : {}) };
}

export interface RunOptions {
  /**
   * Tests and tools only: accept an already started patrol without checking it came from
   * `seed` (hand-built stop lists). The server never sets this.
   */
  trustPatrol?: boolean;
  /** resumeRun / replayRun: the log is this story chapter's (startChapterRun), not a patrol night's. */
  chapter?: ChapterId;
  /** resumeRun / replayRun: the log is this time trial's (startTrialRun). */
  trial?: TrialCourseId;
}

/**
 * Start a time trial on the save's hero (rules/compete.ts trialSave): the course's own city
 * and seed, full health and fluid, no powers. The save isn't touched and needs no patrol.
 */
export function startTrialRun(save: Save, course: TrialCourseId): Run {
  if (!isTrialCourse(course)) return deadRun(save, 0, `no course ${String(course)}`);
  const seed = COURSE_GEOMETRY[course].seed;
  if (!save?.hero) return deadRun(save, seed, "no hero", null, course);
  const config = trialConfig(save, course);
  if (!config) return deadRun(save, seed, "no hero", null, course);
  return { save, start: save, seed, sim: createSim(config), codes: [], events: [], checkpoints: [], over: false, error: null, abilities: 0, gwei: 0, chapter: null, trial: course };
}

/**
 * Start a story chapter's night (Case File 001) on the save's hero, from the server's seed (or
 * a local one for guests): full health and fluid, the hero's loadout, one Gwei call. The save
 * isn't touched, and needs no patrol: a chapter can be played on any night.
 */
export function startChapterRun(save: Save, seed: number, chapter: ChapterId): Run {
  if (!isChapterId(chapter)) return deadRun(save, seed, `no chapter ${String(chapter)}`, null);
  if (!save?.hero) return deadRun(save, seed, "no hero", chapter);
  const config = chapterConfig(save, seed, chapter);
  if (!config) return deadRun(save, seed, "no hero", chapter);
  return { save, start: save, seed, sim: createSim(config), codes: [], events: [], checkpoints: [], over: false, error: null, abilities: 0, gwei: 0, chapter };
}

/**
 * Start a run: start the patrol from `seed` (or check an already started one came from it)
 * and build the sim at the first stop. Check `run.error` before using it.
 */
export function startRun(input: Save, seed: number, opts: RunOptions = {}): Run {
  let save = input;
  if (!save?.hero) return deadRun(save, seed, "no hero");
  if (opts.trustPatrol && save.patrol && save.patrol.phase !== "briefing") {
    const p = save.patrol;
    if (p.phase !== "swing" || p.index !== 0 || p.results.length) return deadRun(save, seed, "a run starts at the first stop");
  } else {
    const fresh = reduce({ ...save, patrol: null }, { type: "start-patrol", seed });
    if (!fresh.patrol) return deadRun(save, seed, "the patrol can't start (night already done?)");
    if (!save.patrol || save.patrol.phase === "briefing") {
      save = reduce(save, { type: "start-patrol", seed });
      if (!save.patrol || save.patrol.seed !== fresh.patrol.seed) return deadRun(input, seed, "the patrol wasn't started from this seed");
    } else {
      const p = save.patrol;
      if (p.seed !== fresh.patrol.seed || !sameStops(p.stops, fresh.patrol.stops)) return deadRun(save, seed, "the patrol wasn't started from this seed");
      if (p.phase !== "swing" || p.index !== 0 || p.results.length) return deadRun(save, seed, "a run starts at the first stop");
    }
  }
  const boot = sessionStart3d(save);
  if (boot.kind !== "play") return deadRun(save, seed, `nothing to play (${boot.kind})`);
  return {
    save,
    start: save,
    seed,
    sim: createSim(boot.config),
    codes: [],
    events: [],
    checkpoints: [],
    over: false,
    error: null,
    abilities: 0,
    gwei: 0,
    chapter: null,
  };
}

/** Send each event's engine action. A refused action kills the run (a desync). Chapters send none. */
function dispatch(run: Run, events: SimEvent[]) {
  for (const ev of events) {
    if (ev.type === "ability") run.abilities += 1;
    if (ev.type === "gwei") run.gwei += 1;
    if (run.trial) {
      // A trial's checkpoints: each gate.
      if (ev.type === "trial-gate") run.checkpoints.push(hashState(run.sim));
      if (ev.type === "night-over") run.over = true;
      continue;
    }
    if (run.chapter) {
      // A chapter's checkpoints: each clue, the win, and Mary's release.
      if (ev.type === "clue-found" || ev.type === "fight-won" || ev.type === "captive-freed") run.checkpoints.push(hashState(run.sim));
      if (ev.type === "night-over") run.over = true;
      continue;
    }
    const action = actionFor3d(ev);
    if (action) {
      const next = reduce(run.save, action);
      if (next === run.save) {
        run.error = `the engine refused ${action.type} at tick ${run.sim.tick}`;
        return;
      }
      run.save = next;
      if (action.type === "leave-stop") run.checkpoints.push(hashState(run.sim));
    }
    if (ev.type === "night-over") run.over = true;
  }
}

/** Whether the run is waiting on an errand choice. */
export const needsErrand = (run: Run) => !run.error && !run.over && run.sim.mode === "errand";

/** Whether stepRun would advance (not over, no error, no errand open). */
export const runActive = (run: Run) => !run.error && !run.over && simRunning(run.sim);

/**
 * Step one tick with `frame`, record it and send the engine actions. Returns the step's
 * events (for effects and audio), or an empty list when nothing stepped.
 */
export function stepRun(run: Run, frame: InputFrame): SimEvent[] {
  if (!runActive(run)) return [];
  if (!stepSim(run.sim, frame)) return [];
  run.codes.push(frameCode(run.sim.input));
  const events = run.sim.events.splice(0);
  dispatch(run, events);
  return events;
}

/**
 * Answer the open errand with option `value` (an index into its choices), at the current
 * tick. Returns the events it caused, or null if no errand is open or the option doesn't exist.
 */
export function chooseErrand(run: Run, value: number): SimEvent[] | null {
  if (!needsErrand(run)) return null;
  const p = run.save.patrol;
  if (!p || p.phase !== "stop" || p.results.length > p.index || !currentErrand(run.save)) return null;
  const actions = errandActions(run.save, value);
  if (!actions) return null;
  for (const action of actions) {
    const next = reduce(run.save, action);
    if (next === run.save) {
      run.error = `the engine refused ${action.type} at tick ${run.sim.tick}`;
      return null;
    }
    run.save = next;
  }
  run.events.push({ tick: run.sim.tick, kind: "errand-choice", value });
  const after = run.save.patrol!;
  resolveErrand(run.sim, { hp: after.hp, fluid: after.fluid });
  run.checkpoints.push(hashState(run.sim));
  const events = run.sim.events.splice(0);
  dispatch(run, events);
  return events;
}

/** The ruleset field a run's log carries: RULESET_VERSION, the chapter's (chapterLogRuleset), or the trial course's (trialLogRuleset). */
export const logRuleset = (chapter: ChapterId | null | undefined, trial?: TrialCourseId | null) =>
  trial ? trialLogRuleset(trial) : chapter ? chapterLogRuleset(chapter) : RULESET_VERSION;

/** The canonical input log of everything recorded so far. */
export function runLog(run: Run): Uint8Array {
  return encodeInputCodes(run.codes, run.events, 0, logRuleset(run.chapter, run.trial));
}

/** The state hash right now. */
export const runHash = (run: Run) => hashState(run.sim);

/**
 * Replay a log (from tick 0) into a run, leaving it live: the browser's resume after a
 * reload, and the first half of the verifier. `error` says why a log was refused.
 */
export function resumeRun(input: ReplayInput, opts: RunOptions = {}): Run {
  let decoded: ReturnType<typeof decodeInputCodes>;
  try {
    decoded = decodeInputCodes(input.log);
  } catch (e) {
    return deadRun(input.save as Save, input.seed, e instanceof InputLogError ? `bad log: ${e.message}` : "bad log", opts.chapter ?? null);
  }
  const chapter = opts.chapter ?? null;
  const trial = opts.trial ?? null;
  if (chapter !== null && !isChapterId(chapter)) return deadRun(input.save as Save, input.seed, `no chapter ${String(chapter)}`);
  if (trial !== null && !isTrialCourse(trial)) return deadRun(input.save as Save, input.seed, `no course ${String(trial)}`);
  if (chapter !== null && trial !== null) return deadRun(input.save as Save, input.seed, "a run is a chapter or a trial, not both", chapter, trial);
  const want = logRuleset(chapter, trial);
  if (decoded.ruleset !== want) {
    const what = trial ? `trial ${trial}'s ${want}` : chapter ? `chapter ${chapter}'s ${want}` : String(RULESET_VERSION);
    return deadRun(input.save as Save, input.seed, `ruleset ${decoded.ruleset} is not ${what}`, chapter, trial);
  }
  if (decoded.fromTick !== 0) return deadRun(input.save as Save, input.seed, "a run's log starts at tick 0", chapter, trial);
  const run = trial ? startTrialRun(input.save as Save, trial) : chapter ? startChapterRun(input.save as Save, input.seed, chapter) : startRun(input.save as Save, input.seed, opts);
  if (run.error) return run;
  const { codes, events } = decoded;
  let e = 0;
  const applyDue = (): boolean => {
    while (e < events.length && events[e].tick <= run.sim.tick) {
      const ev = events[e];
      if (ev.tick < run.sim.tick || !chooseErrand(run, ev.value)) {
        run.error = run.error ?? `the errand choice at tick ${ev.tick} doesn't fit the run`;
        return false;
      }
      e += 1;
    }
    return true;
  };
  for (let i = 0; i < codes.length; i++) {
    if (!applyDue()) return run;
    if (run.error) return run;
    if (!runActive(run)) {
      run.error = run.sim.mode === "errand" ? `an errand at tick ${run.sim.tick} was never answered` : `frames after the night ended (tick ${run.sim.tick})`;
      return run;
    }
    stepRun(run, frameFromCode(codes[i]));
    if (run.error) return run;
  }
  if (!applyDue()) return run;
  if (e < events.length) run.error = `the errand choice at tick ${events[e].tick} doesn't fit the run`;
  return run;
}

/** The run's stats, as the server stores them. */
export function runStats(run: Run, score: ScoreBreakdown | null): Record<string, number> {
  const p = run.save.patrol;
  const results = p?.results ?? [];
  const s = run.sim;
  return {
    ticks: s?.tick ?? 0,
    seconds: Math.floor((s?.tick ?? 0) / SIM_HZ),
    fightsWon: results.filter((r) => r.kind === "fight" && r.outcome === "won").length,
    fightsLost: results.filter((r) => r.kind === "fight" && r.outcome === "lost").length,
    errands: results.filter((r) => r.kind === "errand").length,
    perfect: s?.total.perfect ?? 0,
    good: s?.total.good ?? 0,
    miss: s?.total.miss ?? 0,
    maxCombo: s?.maxCombo ?? 0,
    // Ruleset 3: the Bits tokens and boost rings taken, of how many tonight.
    bits: s?.bits ?? 0,
    rings: s?.rings ?? 0,
    pickupsPlaced: s?.pickups.length ?? 0,
    hpLeft: p && !p.knockedOut ? p.hp : 0,
    knockedOut: p?.knockedOut ? 1 : 0,
    abilities: run.abilities,
    gweiUsed: run.gwei,
    ...(score
      ? {
          scoreFights: score.fights,
          scoreErrands: score.errands,
          scorePerfect: score.perfect,
          scoreCombo: score.combo,
          scorePickups: score.pickups,
          scoreHp: score.hp,
          scoreTime: score.time,
        }
      : {}),
  };
}

/** Whether a chapter run closed its case: Mary freed and the night ended on it. */
export function chapterCleared(run: Run): boolean {
  const c = run.sim?.chapter;
  return !!run.chapter && !!c && c.phase === "done" && c.captive.freed && run.over && !run.error && run.sim.mode === "done" && run.sim.hp > 0;
}

/** A chapter run's stats, as the server stores them: `cleared` (0 or 1) decides the case. */
export function chapterStats(run: Run): Record<string, number> {
  const s = run.sim;
  const c = s?.chapter;
  return {
    chapter: 1,
    cleared: chapterCleared(run) ? 1 : 0,
    ticks: s?.tick ?? 0,
    seconds: Math.floor((s?.tick ?? 0) / SIM_HZ),
    cluesFound: c ? c.clues.filter((k) => k.found).length : 0,
    clues: c ? c.clues.length : 0,
    fightsWon: c && (c.phase === "rescue" || c.phase === "done") ? 1 : 0,
    restore: c ? c.captive.restore : 0,
    perfect: s?.total.perfect ?? 0,
    good: s?.total.good ?? 0,
    miss: s?.total.miss ?? 0,
    maxCombo: s?.maxCombo ?? 0,
    bits: s?.bits ?? 0,
    rings: s?.rings ?? 0,
    pickupsPlaced: s?.pickups.length ?? 0,
    hpLeft: s && s.mode !== "ko" ? s.hp : 0,
    knockedOut: s && s.hp <= 0 ? 1 : 0,
    abilities: run.abilities,
    gweiUsed: run.gwei,
  };
}

/** Whether a trial run finished its course: through the finish gate, and the night ended on it. */
export function trialFinished(run: Run): boolean {
  const t = run.sim?.trial;
  return !!run.trial && !!t && t.finished && run.over && !run.error;
}

/**
 * A trial run's stats, as the server stores them: `finished` (0 or 1), `ticks` (the clock at
 * the finish), each gate's split as `split1`…, and the swing stats.
 */
export function trialStats(run: Run): Record<string, number> {
  const s = run.sim;
  const t = s?.trial;
  const splits: Record<string, number> = {};
  (t?.splits ?? []).forEach((tick, i) => (splits[`split${i + 1}`] = tick));
  return {
    trial: 1,
    finished: trialFinished(run) ? 1 : 0,
    ticks: s?.tick ?? 0,
    seconds: Math.floor((s?.tick ?? 0) / SIM_HZ),
    gates: t ? t.next : 0,
    of: s?.pickups.length ?? 0,
    perfect: s?.total.perfect ?? 0,
    good: s?.total.good ?? 0,
    miss: s?.total.miss ?? 0,
    maxCombo: s?.maxCombo ?? 0,
    ...splits,
  };
}

/** The score of a finished run (from the save's results and the sim's swing stats). */
export function runScore(run: Run): ScoreBreakdown {
  const p = run.save.patrol;
  const fights = (p?.results ?? []).flatMap((r, i) => {
    const stop = p!.stops[i];
    return r.kind === "fight" && stop?.kind === "fight" ? [{ level: stop.level, boss: stop.boss, won: r.outcome === "won" }] : [];
  });
  return scoreRun({
    fights,
    errands: (p?.results ?? []).filter((r) => r.kind === "errand").length,
    perfect: run.sim.total.perfect,
    maxCombo: run.sim.maxCombo,
    pickupPoints: run.sim.pickupPoints,
    hpLeft: p && !p.knockedOut ? p.hp : 0,
    ticks: run.sim.tick,
  });
}

/** Finish a run that's over: finish-patrol, score, stats, checkpoints and the final hash. */
export function finishRun(run: Run): ReplayResult {
  const fail = (reason: string): ReplayResult => ({
    ok: false,
    reason,
    save: run.save,
    score: 0,
    ticks: run.sim?.tick ?? 0,
    stats: run.sim ? runStats(run, null) : {},
    checkpoints: run.checkpoints,
    hash: run.sim ? hashState(run.sim) : "",
  });
  if (run.error) return fail(run.error);
  if (!run.over) return fail("the night didn't finish");
  if (run.trial) {
    // A trial is never scored or banked here: the server ranks a finished one by its time.
    return { ok: true, save: run.save, score: 0, ticks: run.sim.tick, stats: trialStats(run), checkpoints: run.checkpoints, hash: hashState(run.sim) };
  }
  if (run.chapter) {
    // A chapter is never scored or banked here: the server closes the case (applyCaseClear) on a clear.
    return { ok: true, save: run.save, score: 0, ticks: run.sim.tick, stats: chapterStats(run), checkpoints: run.checkpoints, hash: hashState(run.sim) };
  }
  const save = reduce(run.save, { type: "finish-patrol" });
  if (!save.nightDone) return fail("finish-patrol refused the night");
  run.save = save;
  const score = runScore(run);
  return {
    ok: true,
    save,
    score: score.total,
    ticks: run.sim.tick,
    stats: runStats(run, score),
    checkpoints: run.checkpoints,
    hash: hashState(run.sim),
  };
}

/** The verifier: replay a whole log from the run-start save and seed, and score it. */
export function replayRun(input: ReplayInput, opts: RunOptions = {}): ReplayResult {
  return finishRun(resumeRun(input, opts));
}
