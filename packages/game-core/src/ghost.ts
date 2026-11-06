/**
 * Ghosts. Every run is replay-verified, so every run is also a ghost: replay its log from its
 * start save and seed (exactly as the server did) and keep, per tick, where its hero was. Played
 * beside a live run on the same seed, the ghost is exactly where that run was at the same tick:
 * the same sim, the same inputs. buildGhost also returns the replay's checkpoint hashes, which
 * must equal the server's stored ones (the proof the ghost is the verified run, frame for frame).
 *
 * - Tracks: positions, facing, the body's action and the web's anchor per tick, in typed arrays
 *   (a few hundred KB for a whole night), so drawing a ghost costs an array read per frame.
 * - Progress: a number that climbs along a run (stops reached, the way to the next one, a
 *   fight's hits; a trial's gates), kept as a running maximum. The live delta ("+2.4 s vs #1")
 *   is how much later the player reached the progress they have now than the ghost did.
 * - Splits: the tick each stop was reached (a patrol's `arrive`) or each gate passed (a trial).
 *
 * Pure and deterministic like the rest of game-core; nothing here is read back by the sim.
 */
import { chooseErrand, finishRun, runActive, startChapterRun, startRun, startTrialRun, stepRun, type Run, type RunOptions } from "./replay";
import { decodeInputCodes, frameFromCode, InputLogError } from "./input/log";
import { heroAction } from "./sim3d/render";
import type { HeroAction, ReplayInput } from "./sim3d/contract";
import { len2 } from "./sim3d/dmath";
import { stopTarget } from "./sim3d/hero";
import { logRuleset } from "./replay";
import type { Save } from "./rules/types";
import type { SimState } from "./sim3d/types";

/** The body actions a ghost track keeps, by index. */
export const GHOST_ACTIONS: readonly HeroAction[] = ["idle", "run", "swing", "air", "climb", "dash", "slam", "held", "hurt", "ko"];

export interface GhostTrack {
  ok: boolean;
  /** Why the log didn't replay (it can't be a ghost then). */
  reason?: string;
  /** The last tick (the run's length); arrays hold ticks 0…ticks. */
  ticks: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Facing, a unit xz vector. */
  fx: Float32Array;
  fz: Float32Array;
  /** GHOST_ACTIONS index. */
  act: Uint8Array;
  /** The web's anchor, NaN when there's none. */
  ax: Float32Array;
  ay: Float32Array;
  az: Float32Array;
  /** raceProgress at each tick, as a running maximum (never goes down). */
  progress: Float64Array;
  /** The tick each split was reached (stops reached, or gates passed), in order. */
  splits: number[];
  /** Hashes at the replay's checkpoints, and at the end: the server's must be the same. */
  checkpoints: string[];
  hash: string;
  /** The replay's score and whether a trial finished (patrol runs: always true). */
  score: number;
  finished: boolean;
}

/** Where a leg starts: the start roof, the last stop, or (a trial) the last gate. */
function legStart(s: SimState): { x: number; z: number } {
  const t = s.trial;
  if (t) return t.next > 0 ? s.pickups[t.next - 1] : s.city.start;
  return s.index > 0 && s.city.zones[s.index - 1] ? s.city.zones[s.index - 1].center : s.city.start;
}

/**
 * How far along a run is, as a number that rises through it: a patrol's stop index plus the
 * way to the next stop (0–0.9) and a fight's hits (0.9–0.99); a trial's gates passed plus the
 * way to the next gate. Comparable between two runs on the same seed (the same stops).
 */
export function raceProgress(s: SimState): number {
  const t = s.trial;
  if (t) {
    if (t.endTick >= 0) return t.finished ? s.pickups.length : t.next;
    const g = s.pickups[t.next];
    if (!g) return t.next;
    const a = legStart(s);
    const leg = len2(g.x - a.x, g.z - a.z) || 1;
    const d = len2(g.x - s.hero.x, g.z - s.hero.z);
    const f = 1 - d / leg;
    return t.next + (f < 0 ? 0 : f > 0.99 ? 0.99 : f);
  }
  const n = s.city.zones.length;
  if (s.mode === "done") return n;
  if (s.mode === "travel") {
    const goal = stopTarget(s);
    if (!goal) return s.index;
    const a = legStart(s);
    const leg = len2(goal.x - a.x, goal.z - a.z) || 1;
    const d = len2(goal.x - s.hero.x, goal.z - s.hero.z);
    const f = 1 - d / leg;
    return s.index + 0.9 * (f < 0 ? 0 : f > 1 ? 1 : f);
  }
  const v = s.villain;
  if ((s.mode === "fight" || s.mode === "intro") && v && v.hitsMax > 0) return s.index + 0.9 + 0.09 * (1 - v.hits / v.hitsMax);
  return s.index + 0.99;
}

/** The run a ghost replays, started as its mode wants. */
function startFor(input: ReplayInput, opts: RunOptions): Run {
  const save = input.save as Save;
  if (opts.trial) return startTrialRun(save, opts.trial);
  if (opts.chapter) return startChapterRun(save, input.seed, opts.chapter);
  return startRun(save, input.seed, opts);
}

const empty = (reason: string): GhostTrack => ({
  ok: false,
  reason,
  ticks: 0,
  x: new Float32Array(0),
  y: new Float32Array(0),
  z: new Float32Array(0),
  fx: new Float32Array(0),
  fz: new Float32Array(0),
  act: new Uint8Array(0),
  ax: new Float32Array(0),
  ay: new Float32Array(0),
  az: new Float32Array(0),
  progress: new Float64Array(0),
  splits: [],
  checkpoints: [],
  hash: "",
  score: 0,
  finished: false,
});

/**
 * Replay a verified run's log into a ghost track: the same start save, seed and log the server
 * replayed (GET /api/runs/:id/replay), through the same driver (stepRun), recording the hero at
 * every tick. `opts` as replayRun's: `{ trial }` for a trial's log, `{ chapter }` for a case's.
 */
export function buildGhost(input: ReplayInput, opts: RunOptions = {}): GhostTrack {
  let decoded: ReturnType<typeof decodeInputCodes>;
  try {
    decoded = decodeInputCodes(input.log);
  } catch (e) {
    return empty(e instanceof InputLogError ? `bad log: ${e.message}` : "bad log");
  }
  if (decoded.ruleset !== logRuleset(opts.chapter ?? null, opts.trial ?? null)) return empty(`ruleset ${decoded.ruleset} doesn't fit this mode`);
  if (decoded.fromTick !== 0) return empty("a run's log starts at tick 0");
  const run = startFor(input, opts);
  if (run.error) return empty(run.error);
  const { codes, events } = decoded;
  const n = codes.length + 1;
  const g: GhostTrack = {
    ok: true,
    ticks: codes.length,
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    fx: new Float32Array(n),
    fz: new Float32Array(n),
    act: new Uint8Array(n),
    ax: new Float32Array(n),
    ay: new Float32Array(n),
    az: new Float32Array(n),
    progress: new Float64Array(n),
    splits: [],
    checkpoints: [],
    hash: "",
    score: 0,
    finished: true,
  };
  let best = 0;
  const record = (tick: number) => {
    const s = run.sim;
    const h = s.hero;
    g.x[tick] = h.x;
    g.y[tick] = h.y;
    g.z[tick] = h.z;
    g.fx[tick] = h.fx;
    g.fz[tick] = h.fz;
    const a = GHOST_ACTIONS.indexOf(heroAction(s));
    g.act[tick] = a < 0 ? 0 : a;
    g.ax[tick] = h.rope ? h.rope.x : NaN;
    g.ay[tick] = h.rope ? h.rope.y : NaN;
    g.az[tick] = h.rope ? h.rope.z : NaN;
    const p = raceProgress(s);
    if (p > best) best = p;
    g.progress[tick] = best;
  };
  record(0);
  let e = 0;
  for (let i = 0; i < codes.length; i++) {
    while (e < events.length && events[e].tick <= run.sim.tick) {
      if (events[e].tick < run.sim.tick || !chooseErrand(run, events[e].value)) return empty(`the errand choice at tick ${events[e].tick} doesn't fit the run`);
      e += 1;
    }
    if (!runActive(run)) return empty(`frames after the night ended (tick ${run.sim.tick})`);
    const evs = stepRun(run, frameFromCode(codes[i]));
    if (run.error) return empty(run.error);
    for (const ev of evs) if (ev.type === "arrive" || ev.type === "trial-gate") g.splits.push(run.sim.tick);
    record(run.sim.tick);
  }
  while (e < events.length && events[e].tick <= run.sim.tick) {
    if (!chooseErrand(run, events[e].value)) return empty("a trailing errand choice doesn't fit the run");
    e += 1;
  }
  const res = finishRun(run);
  if (!res.ok) return empty(res.reason ?? "the run didn't replay");
  g.checkpoints = res.checkpoints;
  g.hash = res.hash;
  g.score = res.score;
  g.finished = run.trial ? (res.stats.finished ?? 0) === 1 : true;
  return g;
}

/** The ghost at a (fractional) tick: its position, facing, action and anchor, clamped to its run. */
export interface GhostPose {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  action: HeroAction;
  anchor: { x: number; y: number; z: number } | null;
  /** Past the end of its run (it waits at its finish). */
  done: boolean;
}

export function ghostPose(g: GhostTrack, tick: number, out?: GhostPose): GhostPose {
  const o: GhostPose = out ?? { x: 0, y: 0, z: 0, fx: 1, fz: 0, action: "idle", anchor: null, done: false };
  if (!g.ok || g.ticks <= 0 && g.x.length === 0) {
    o.done = true;
    return o;
  }
  const t = tick < 0 ? 0 : tick > g.ticks ? g.ticks : tick;
  const i = Math.floor(t);
  const j = i < g.ticks ? i + 1 : i;
  const f = t - i;
  // A jump of a few hundred units in a tick is a teleport (an errand stood him by the ally): no blend.
  const jump = Math.abs(g.x[j] - g.x[i]) + Math.abs(g.z[j] - g.z[i]) > 200;
  const k = jump ? 0 : f;
  o.x = g.x[i] + (g.x[j] - g.x[i]) * k;
  o.y = g.y[i] + (g.y[j] - g.y[i]) * k;
  o.z = g.z[i] + (g.z[j] - g.z[i]) * k;
  o.fx = g.fx[i];
  o.fz = g.fz[i];
  o.action = GHOST_ACTIONS[g.act[i]] ?? "idle";
  const ax = g.ax[i];
  if (ax === ax) {
    o.anchor = o.anchor ?? { x: 0, y: 0, z: 0 };
    o.anchor.x = ax;
    o.anchor.y = g.ay[i];
    o.anchor.z = g.az[i];
  } else o.anchor = null;
  o.done = tick >= g.ticks;
  return o;
}

/**
 * The first tick the ghost's progress reached `p` (a binary search on its running maximum), or
 * null if it never did (it didn't get that far).
 */
export function ghostTickAt(g: GhostTrack, p: number): number | null {
  const pr = g.progress;
  if (!g.ok || pr.length === 0 || pr[pr.length - 1] < p) return null;
  let lo = 0;
  let hi = pr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pr[mid] >= p) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The first tick the ghost's progress went past `p`, or null if it never did. */
export function ghostTickAfter(g: GhostTrack, p: number): number | null {
  const pr = g.progress;
  if (!g.ok || pr.length === 0 || pr[pr.length - 1] <= p) return null;
  let lo = 0;
  let hi = pr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pr[mid] > p) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * The live gap to a ghost, in ticks (positive: behind): how much later the player reached the
 * progress they have now (`reachedAt`, the tick their best `progress` was set) than the ghost
 * did; and while the player stands still there, at least how long ago the ghost moved on (so
 * the gap grows through a stall the ghost didn't have). Null when the ghost never got that far.
 */
export function ghostGap(g: GhostTrack, tick: number, progress: number, reachedAt: number = tick): number | null {
  const at = ghostTickAt(g, progress);
  if (at === null) return null;
  let gap = reachedAt - at;
  const left = ghostTickAfter(g, progress);
  if (left !== null && tick - left > gap) gap = tick - left;
  return gap;
}

/** Keeps the live run's best progress (a running maximum, like a ghost's) and the tick it was set. */
export class ProgressMeter {
  best = 0;
  /** The tick the best was last raised. */
  at = 0;
  /** Progress now (after the run's latest tick). */
  update(s: SimState): number {
    const p = raceProgress(s);
    if (p > this.best) {
      this.best = p;
      this.at = s.tick;
    }
    return this.best;
  }

  /** The gap to a ghost now (ghostGap), or null. */
  gap(g: GhostTrack, tick: number): number | null {
    return ghostGap(g, tick, this.best, this.at);
  }
}
