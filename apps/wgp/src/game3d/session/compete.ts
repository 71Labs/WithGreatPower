/**
 * Starting and ending a race: the Daily Run, a time trial or a duel (game-core
 * rules/compete.ts, src/server/db/compete.ts). A race is a night session like a ranked one,
 * so the patrol's PlaySurface plays it, with three ways in:
 *
 * - Ranked (signed in): POST /api/runs/start with the race; the server answers the seed and the
 *   start save to play from (the Daily's standard hero, a trial's, or a duel's ghost save), and
 *   at the end verifies the log and puts it on its board. Never the player's save.
 * - Guest: the same race on this device: the day's seed (public from the hub), a course's fixed
 *   seed, or a ghost's own seed and save. Nothing is filed; a trial's best is kept here.
 * - Unranked (signed in, but capped or off the server): as a guest, nothing filed.
 *
 * A race records under its own slot (recorder.ts), so a reload during the Daily picks it up
 * (resumeRace) and never touches tonight's patrol recording.
 */
import { compareRuns, dailySave, duelSave, medalFor, trialSave, type HeroLook, type Medal } from "@wgp/game-core/compete";
import { finishRun, resumeRun, runHash, runLog, runScore, startRun, startTrialRun, trialFinished, type Run } from "@wgp/game-core/replay";
import type { Save, TrialCourseId } from "@wgp/game-core/types";

import { refreshAccount } from "@/game/store";
import { submitRankedRun } from "@/lib/api/client";
import { startRace, type CompeteOutcome, type CompeteSubmit, type PublicReplay, type RaceSpec } from "@/lib/compete/api";

import type { NightSession } from "./night";
import { clearRecording, type Recording } from "./recorder";

export type RaceKind = "daily" | "trial" | "duel";

export interface RaceSession extends NightSession {
  race: {
    kind: RaceKind;
    /** The Daily's day, the course, or "duel". */
    course: string;
    /** The trial's course, or null. */
    trial: TrialCourseId | null;
    /** The run raced as a ghost on the server (a duel's, or a chosen one), or null. */
    ghost: string | null;
    /** The recording's slot. */
    slot: string;
  };
}

export type RaceStart =
  | { kind: "ready"; session: RaceSession }
  | { kind: "run-active"; runId: string | null }
  | { kind: "daily-cap"; message: string }
  | { kind: "blocked"; code: string; message: string }
  | { kind: "signed-out" }
  | { kind: "error"; message: string };

const lookOf = (save: Save | null): HeroLook => ({ name: save?.hero?.name ?? null, suit: save?.hero?.suit ?? null });

/** A race's recording slot: one per Daily day, per course, per duel. */
export const raceSlot = (kind: RaceKind, course: string, ghost: string | null) => (kind === "duel" ? `duel:${ghost ?? course}` : `${kind}:${course}`);

function session(mode: NightSession["mode"], run: Run, race: RaceSession["race"], extra: { runId?: string | null; playerId?: string | null; resumed?: boolean } = {}): RaceSession {
  return {
    mode,
    chapter: null,
    run,
    runId: extra.runId ?? null,
    playerId: extra.playerId ?? null,
    before: { level: run.start.hero?.level ?? 1, maxHp: run.start.hero?.maxHp ?? 0 },
    resumed: !!extra.resumed,
    race,
  };
}

/** The run a race plays, from its start save and seed. */
function raceRun(trial: TrialCourseId | null, save: Save, seed: number): Run {
  return trial ? startTrialRun(save, trial) : startRun(save, seed);
}

/** Start a race on the server (signed in). */
export async function beginRace(spec: RaceSpec, opts: { abandon?: boolean } = {}): Promise<RaceStart> {
  const account = await refreshAccount();
  if (account.status !== "signed-in") return { kind: "signed-out" };
  const res = await startRace(spec, !!opts.abandon);
  if (!res.ok) {
    if (res.status === 401) return { kind: "signed-out" };
    if (res.error === "run_active") return { kind: "run-active", runId: typeof res.body?.runId === "string" ? res.body.runId : null };
    if (res.error === "daily_cap") return { kind: "daily-cap", message: res.message ?? "That’s all the races for today." };
    if (res.status === 409 || res.status === 400 || res.status === 404) return { kind: "blocked", code: res.error, message: res.message ?? "This race can’t start." };
    return { kind: "error", message: res.status === 0 ? "You look offline." : (res.message ?? "The server couldn’t start the race.") };
  }
  const s = res.data;
  const c = s.compete;
  const trial = c.kind === "trial" ? (c.course as TrialCourseId) : null;
  const run = raceRun(trial, c.startSave, s.seed);
  if (run.error) return { kind: "error", message: `This race can’t start: ${run.error}.` };
  return { kind: "ready", session: session("ranked", run, { kind: c.kind, course: c.course, trial, ghost: c.ghost, slot: raceSlot(c.kind, c.course, c.ghost) }, { runId: s.runId, playerId: account.me.player.id }) };
}

/**
 * A race on this device (a guest, or signed in but off the server): the Daily on the day's
 * public seed, a course on its own, or a duel on the ghost's own seed and save.
 */
export function beginLocalRace(
  input: { kind: "daily"; day: string; seed: number } | { kind: "trial"; course: TrialCourseId } | { kind: "duel"; ghost: PublicReplay },
  save: Save | null,
  mode: "guest" | "unranked",
  playerId: string | null = null,
): RaceSession | null {
  const look = lookOf(save);
  if (input.kind === "daily") {
    const run = startRun(dailySave(input.day, look), input.seed);
    return run.error ? null : session(mode, run, { kind: "daily", course: input.day, trial: null, ghost: null, slot: raceSlot("daily", input.day, null) }, { playerId });
  }
  if (input.kind === "trial") {
    const run = startTrialRun(trialSave(look), input.course);
    return run.error ? null : session(mode, run, { kind: "trial", course: input.course, trial: input.course, ghost: null, slot: raceSlot("trial", input.course, null) }, { playerId });
  }
  const g = input.ghost;
  const run = startRun(duelSave(g.startSave, look), g.seed);
  return run.error ? null : session(mode, run, { kind: "duel", course: "duel", trial: null, ghost: g.runId, slot: raceSlot("duel", "duel", g.runId) }, { playerId });
}

/** A race in progress from its recording (a reload), or null if it no longer fits. */
export function resumeRace(rec: Recording, race: RaceSession["race"]): RaceSession | null {
  const run = resumeRun({ save: rec.start, seed: rec.seed, log: rec.log }, race.trial ? { trial: race.trial } : {});
  if (run.error) return null;
  return session(rec.mode, run, race, { runId: rec.runId, playerId: rec.playerId, resumed: true });
}

/** How a race ended, as its results show it. */
export interface RaceEnding {
  kind: RaceKind;
  /** "verified" (the server replayed and filed it), "local" (a guest or unranked: kept here only). */
  filed: "verified" | "local";
  score: number;
  ticks: number;
  finished: boolean;
  medal: Medal | null;
  /** The server's word on the board and the ghost (verified only). */
  outcome: CompeteOutcome | null;
  runId: string | null;
}

export type RaceResult = { kind: "done"; ending: RaceEnding } | { kind: "rejected"; reason: string } | { kind: "submit-failed"; message: string };

/** Against a ghost's run on the same race: did this one win? */
export function beatGhost(kind: RaceKind, mine: { score: number; ticks: number; finished: boolean }, theirs: { score: number; ticks: number; finished: boolean }): boolean {
  return compareRuns(kind === "trial" ? "trial" : "patrol", mine, theirs) < 0;
}

/** What the run itself says (before or without the server): score, time, finish, medal. */
export function localEnding(s: RaceSession): RaceEnding {
  const { run, race } = s;
  const ticks = run.sim?.tick ?? 0;
  if (race.trial) {
    const finished = trialFinished(run);
    return { kind: race.kind, filed: "local", score: 0, ticks, finished, medal: finished ? medalFor(race.trial, ticks) : null, outcome: null, runId: null };
  }
  const score = run.over && !run.error ? runScore(run).total : 0;
  return { kind: race.kind, filed: "local", score, ticks, finished: run.over && !run.error, medal: null, outcome: null, runId: null };
}

/** End the race: submit it (ranked) or keep it here (guest, unranked). */
export async function endRace(s: RaceSession): Promise<RaceResult> {
  const local = localEnding(s);
  if (s.mode !== "ranked" || !s.runId) {
    await clearRecording(null, s.race.slot);
    // Finishing the patrol locally checks the night banks (nothing is saved).
    if (!s.race.trial && s.run.over && !s.run.error) finishRun(s.run);
    return { kind: "done", ending: local };
  }
  const res = await submitRankedRun(s.runId, runLog(s.run), runHash(s.run));
  if (res.ok) {
    await clearRecording(null, s.race.slot);
    const data = res.data as CompeteSubmit;
    const c = data.compete ?? null;
    return {
      kind: "done",
      ending: { ...local, filed: "verified", score: data.score, ticks: data.ticks, finished: c?.finished ?? local.finished, medal: c?.medal ?? local.medal, outcome: c, runId: data.runId },
    };
  }
  if (res.status === 0 || res.status >= 500 || res.status === 429) return { kind: "submit-failed", message: res.status === 0 ? "You look offline." : (res.message ?? "The server couldn’t check your race.") };
  await clearRecording(null, s.race.slot);
  return { kind: "rejected", reason: typeof res.body?.reason === "string" ? res.body.reason : res.error };
}
