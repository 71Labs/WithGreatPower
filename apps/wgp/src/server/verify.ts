/**
 * Run verification: replay the input log with the deterministic sim and check the
 * result is plausible before anything is written. The replay itself is game-core's
 * `replayRun` (packages/game-core/src/replay.ts); it is injected through `Verifier`
 * so tests can use a fake and the server can swap rulesets in one place.
 */
import { CHAPTERS } from "@wgp/game-core/chapters";
import { TRIAL_RULESET } from "@wgp/game-core/compete";
import { reduce } from "@wgp/game-core/engine";
import { replayRun } from "@wgp/game-core/replay";
import { RULESET_VERSION, SIM_HZ } from "@wgp/game-core/sim3d/constants";
import type { ReplayInput, ReplayResult } from "@wgp/game-core/sim3d/contract";
import type { ChapterId, Save, TrialCourseId } from "@wgp/game-core/types";

export interface Verifier {
  /** Pinned in every run at issue; a submit against another ruleset is rejected. */
  ruleset: string;
  /** Sim ticks per second, to turn ticks into game time. */
  tickHz: number;
  replay(input: ReplayInput): ReplayResult | Promise<ReplayResult>;
}

export const VERIFY_RULES = {
  /** A night shorter than this (game time) isn't a real run. */
  minGameSeconds: 20,
  /**
   * Game time may run ahead of the wall clock by at most this. Both ends are the server's clock
   * (the run's issue time and the submit), and the game steps in real time, so a played night is
   * never ahead; the slack only covers rounding. A log computed faster than real time (a bot) is
   * refused until it has waited the night out.
   */
  wallSlackSeconds: 5,
  /** The encoded input log, decoded from base64. */
  maxLogBytes: 64 * 1024,
} as const;

/** game-core's deterministic replay, pinned to its ruleset. */
const defaultVerifier: Verifier = { ruleset: String(RULESET_VERSION), tickHz: SIM_HZ, replay: replayRun };

let current: Verifier = defaultVerifier;

export function getVerifier(): Verifier {
  return current;
}

/** Swaps the verifier (tests), or restores the default with undefined. */
export function setVerifier(verifier: Verifier | undefined): void {
  current = verifier ?? defaultVerifier;
}

/**
 * A story chapter's verifier (Case File 001): game-core's replay as that chapter, pinned to
 * its CHAPTER_RULESET ("c001-1"). A chapter log never replays as a patrol night, nor the
 * reverse (the log's ruleset field says which it is).
 */
const chapterVerifier = (id: ChapterId): Verifier => ({ ruleset: CHAPTERS[id].ruleset, tickHz: SIM_HZ, replay: (input) => replayRun(input, { chapter: id }) });

let chapterOverride: Verifier | undefined;

export function getChapterVerifier(id: ChapterId): Verifier {
  return chapterOverride ?? chapterVerifier(id);
}

/** Swaps every chapter's verifier (tests), or restores the defaults with undefined. */
export function setChapterVerifier(verifier: Verifier | undefined): void {
  chapterOverride = verifier;
}

/**
 * A time trial's verifier: game-core's replay as that course, pinned to TRIAL_RULESET
 * ("trial-1"). A trial log never replays as a patrol night, a case or another course.
 */
const trialVerifier = (course: TrialCourseId): Verifier => ({ ruleset: TRIAL_RULESET, tickHz: SIM_HZ, replay: (input) => replayRun(input, { trial: course }) });

let trialOverride: Verifier | undefined;

export function getTrialVerifier(course: TrialCourseId): Verifier {
  return trialOverride ?? trialVerifier(course);
}

/** Swaps every course's verifier (tests), or restores the defaults with undefined. */
export function setTrialVerifier(verifier: Verifier | undefined): void {
  trialOverride = verifier;
}

/** A trial is short: a course takes seconds, so its floor is lower than a night's. */
export const TRIAL_MIN_SECONDS = 3;

/**
 * A time trial's run: replayed as its course from the save at issue (a trial starts no patrol),
 * under the same plausibility rules but a trial's shorter floor. `stats.finished` (0 or 1) says
 * whether it crossed the finish. Never throws.
 */
export async function verifyTrialRun(
  run: RunToVerify & { course: TrialCourseId },
  log: Uint8Array,
  clientHash: string,
  opts: { now?: Date; verifier?: Verifier } = {},
): Promise<Verdict> {
  return verifyWith(opts.verifier ?? getTrialVerifier(run.course), run, () => run.startSave, log, clientHash, opts.now, TRIAL_MIN_SECONDS);
}

/** The save the replay starts from: the server's copy at run start with tonight's patrol started from the server-issued seed. */
export function startPatrol(save: Save, seed: number): Save {
  return reduce(save, { type: "start-patrol", seed });
}

export interface RunToVerify {
  ruleset: string;
  seed: number;
  /** The save at issue time (runs.start_save). */
  startSave: Save;
  issuedAt: Date;
}

export type Verdict =
  | { ok: true; result: ReplayResult & { save: Save } }
  | { ok: false; reason: string; result?: ReplayResult };

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Replays a submitted log and applies the plausibility rules. Never throws. */
export async function verifyRun(
  run: RunToVerify,
  log: Uint8Array,
  clientHash: string,
  opts: { now?: Date; verifier?: Verifier } = {},
): Promise<Verdict> {
  return verifyWith(opts.verifier ?? current, run, () => startPatrol(run.startSave, run.seed), log, clientHash, opts.now);
}

/**
 * A story chapter's run: replayed as the chapter from the save at issue (a chapter starts no
 * patrol), under the same plausibility rules. A verified chapter run's `stats.cleared` (0 or
 * 1) says whether it closed the case. Never throws.
 */
export async function verifyChapterRun(
  run: RunToVerify & { chapter: ChapterId },
  log: Uint8Array,
  clientHash: string,
  opts: { now?: Date; verifier?: Verifier } = {},
): Promise<Verdict> {
  return verifyWith(opts.verifier ?? getChapterVerifier(run.chapter), run, () => run.startSave, log, clientHash, opts.now);
}

async function verifyWith(verifier: Verifier, run: RunToVerify, startSave: () => Save, log: Uint8Array, clientHash: string, at?: Date, minSeconds: number = VERIFY_RULES.minGameSeconds): Promise<Verdict> {
  const now = at ?? new Date();

  if (run.ruleset !== verifier.ruleset) return { ok: false, reason: "ruleset_mismatch" };
  if (log.byteLength === 0) return { ok: false, reason: "log_empty" };
  if (log.byteLength > VERIFY_RULES.maxLogBytes) return { ok: false, reason: "log_too_large" };

  let result: ReplayResult;
  try {
    result = await verifier.replay({ save: startSave(), seed: run.seed, log });
  } catch (error) {
    return { ok: false, reason: `replay_error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200) };
  }

  if (!result.ok) return { ok: false, reason: (result.reason || "replay_failed").slice(0, 200), result };
  if (!isInt(result.score) || !isInt(result.ticks) || typeof result.hash !== "string" || !isSave(result.save)) {
    return { ok: false, reason: "bad_replay_result", result };
  }

  const gameSeconds = result.ticks / verifier.tickHz;
  const wallSeconds = (now.getTime() - run.issuedAt.getTime()) / 1000;
  if (gameSeconds < minSeconds) return { ok: false, reason: "too_short", result };
  if (gameSeconds > wallSeconds + VERIFY_RULES.wallSlackSeconds) return { ok: false, reason: "faster_than_wall_clock", result };
  if (result.hash !== clientHash) return { ok: false, reason: "hash_mismatch", result };

  return { ok: true, result: { ...result, save: result.save } };
}

function isSave(value: unknown): value is Save {
  return typeof value === "object" && value !== null && (value as { version?: unknown }).version === 1;
}
