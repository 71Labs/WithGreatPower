/**
 * Competitive runs on the server: the Daily Run, time trials and duels (game-core
 * rules/compete.ts). Each is a run like any other (issued, submitted, replayed, verified or
 * rejected; runs.ts), with its own mode, ruleset, budget and board, and none of them touches the
 * Season boards or Bits. The save changes only by Gwei's new stock (src/lib/market/new-stock.ts):
 * a verified Daily adds a gas receipt (and a finality flag for a clean one) once a day, and a
 * settled Daily's top three a torn seed phrase, once their pools are open on chain.
 *
 * - Daily (`runs.mode` "daily", ruleset "4", `runs.course` the UTC day): a patrol night on the
 *   day's seed, HMAC(SEED_SECRET, "daily-seed\0" + day), and the standard hero (dailySave), so
 *   everyone plays the same city. DAILY_ATTEMPTS a day; the best counts on the "daily" board
 *   (period: the day). The day's top three earn soulbound badges once the day is settled
 *   (settleDailies: `daily-podium`, and `daily-winner` for first), one of each per player ever.
 * - Trial (`runs.mode` "trial", ruleset "trial-1", `runs.course` the course id): the course's
 *   fixed seed and city on trialSave. A finish ranks on the "trial" board (period: the course id)
 *   by medal, then time.
 * - Duel (`runs.mode` "trial", ruleset "4", `runs.course` "duel"): a ranked night (or a past
 *   Daily) raced again on its own seed and start save (duelSave), verified and never ranked.
 *
 * `runs.ghost_run_id` is the verified run raced as a ghost, if any: a duel's always, a Daily's
 * or a trial's when one was chosen. It makes "rivals": the ghosts you've raced and who won.
 */
import { createHmac, randomUUID } from "node:crypto";

import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";

import {
  COURSES,
  compareRuns,
  DAILY_ATTEMPTS,
  DAILY_RULESET,
  dailyKit,
  dailySave,
  duelSave,
  DUEL_COURSE,
  isDayKey,
  isTrialCourse,
  medalFor,
  medalTier,
  TRIAL_COURSE_IDS,
  TRIAL_RULESET,
  trialSave,
  type HeroLook,
  type Medal,
} from "@wgp/game-core/compete";
import { RULESET_VERSION } from "@wgp/game-core/sim3d/constants";
import type { ReplayResult } from "@wgp/game-core/sim3d/contract";
import type { PowerId, Save, TrialCourseId } from "@wgp/game-core/types";

import { secret } from "@/server/auth/secrets";
import { HttpError, badRequest, conflict, notFound } from "@/server/http";
import { budgetUsed, releaseBudget, reserveBudget, utcDay } from "@/server/rate-limit";
import { getVerifier, verifyRun, verifyTrialRun, type Verifier } from "@/server/verify";
import { dailyAward, podiumAward } from "@/lib/market/new-stock";
import { grantNewStock, openStockNow } from "@/server/market/new-stock";

import type { Db } from "./client";
import { queryRows } from "./client";
import { aroundPlayer, boardTag, countEntries, rankOf, topEntries, type BoardRow } from "./leaderboard";
import { enqueueRewardMint } from "./outbox";
import { ensureSave, getPlayer } from "./players";
import { RUN_TTL_MS, runDigest, SUBMIT_GRACE_MS, type StartedRun, type SubmitResult } from "./runs";
import { chainOps, leaderboardEntries as le, players, runs, type Run } from "./schema";

/* ------------------------------------------------------------------ names and budgets */

export const COMPETE_MODES = ["daily", "trial"] as const;
export type CompeteRunMode = (typeof COMPETE_MODES)[number];
export const isCompeteMode = (v: unknown): v is CompeteRunMode => v === "daily" || v === "trial";

export const DAILY_BUDGET_SCOPE = "runs:daily";
export const TRIAL_BUDGET_SCOPE = "runs:trial";
/** Trial and duel runs a player may start per UTC day (a course takes seconds; a replay costs CPU). */
export const TRIAL_RUNS_PER_DAY = 80;

/** The badges the Daily's top three earn (`trophy:badge:<id>`), one of each per player, ever. */
export const DAILY_BADGES = { podium: "daily-podium", winner: "daily-winner" } as const;
export const dailyBadgeKey = (badge: string, playerId: string) => `badge:${badge}:${playerId}`;

/** The day's seed: the first 32 bits of HMAC-SHA256(SEED_SECRET, "daily-seed\0" + day). The same for everyone, unknowable before the day. */
export function dailySeed(day: string, key = secret("SEED_SECRET")): number {
  return createHmac("sha256", key).update(`daily-seed\0${day}`).digest().readUInt32BE(0);
}

/** When the Daily for `now` ends: the next UTC midnight. */
export function dailyResetAt(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** What a competitive run is: the Daily, a course, or a duel. */
export type CompeteKind = "daily" | "trial" | "duel";

export function competeKind(run: Pick<Run, "mode" | "course">): CompeteKind | null {
  if (run.mode === "daily") return "daily";
  if (run.mode === "trial") return run.course === DUEL_COURSE ? "duel" : "trial";
  return null;
}

/** The look a player brings to a standard hero: their hero's name and suit. */
const lookOf = (save: Save): HeroLook => ({ name: save.hero?.name ?? null, suit: save.hero?.suit ?? null });

/* ------------------------------------------------------------------ start */

export type CompeteSpec = { mode: "daily"; ghost?: string } | { mode: "trial"; course: TrialCourseId; ghost?: string } | { duel: string };

export interface StartedCompeteRun extends StartedRun {
  compete: {
    kind: CompeteKind;
    /** The Daily's day, or a trial's course, or "duel". */
    course: string;
    /** The run raced as a ghost, if any. */
    ghost: string | null;
    /** The save to play from: startRun (Daily, duel) or startTrialRun (trial) on it, with `seed`. */
    startSave: Save;
  };
}

interface GhostRow {
  id: string;
  mode: string;
  course: string | null;
  seed: number;
  ruleset: string;
  night: number;
  startSave: Save;
  issuedAt: Date;
  playerId: string;
}

async function verifiedRun(db: Db, runId: string): Promise<GhostRow | null> {
  const [row] = await db
    .select({ id: runs.id, mode: runs.mode, course: runs.course, seed: runs.seed, ruleset: runs.ruleset, night: runs.night, startSave: runs.startSave, issuedAt: runs.issuedAt, playerId: runs.playerId })
    .from(runs)
    .innerJoin(players, eq(players.id, runs.playerId))
    .where(and(eq(runs.id, runId), eq(runs.status, "verified"), isNull(players.bannedAt)))
    .limit(1);
  return row ? { ...row, startSave: row.startSave as Save } : null;
}

const uuidLike = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

interface Plan {
  kind: CompeteKind;
  mode: CompeteRunMode;
  course: string;
  seed: number;
  ruleset: string;
  night: number;
  startSave: Save;
  ghost: string | null;
  budget: { scope: string; limit: number; message: string };
}

/** Work out what to issue: the day's Daily, a course, or a duel on a verified run's own seed. */
async function plan(db: Db, spec: CompeteSpec, save: Save, now: Date): Promise<Plan> {
  const look = lookOf(save);
  const trialBudget = { scope: TRIAL_BUDGET_SCOPE, limit: TRIAL_RUNS_PER_DAY, message: `That’s ${TRIAL_RUNS_PER_DAY} races today. The track reopens at midnight UTC.` };
  const dailyPlan = (ghost: string | null): Plan => {
    const day = utcDay(now);
    return {
      kind: "daily",
      mode: "daily",
      course: day,
      seed: dailySeed(day),
      ruleset: DAILY_RULESET,
      night: dailySave(day).night,
      startSave: dailySave(day, look),
      ghost,
      budget: { scope: DAILY_BUDGET_SCOPE, limit: DAILY_ATTEMPTS, message: `That’s today’s ${DAILY_ATTEMPTS} Daily Runs. A new city posts at midnight UTC.` },
    };
  };
  const trialPlan = (course: TrialCourseId, ghost: string | null): Plan => ({
    kind: "trial",
    mode: "trial",
    course,
    seed: COURSES[course].seed,
    ruleset: TRIAL_RULESET,
    night: save.night,
    startSave: trialSave(look),
    ghost,
    budget: trialBudget,
  });

  if ("duel" in spec) {
    if (!uuidLike(spec.duel)) throw notFound("No verified run with that id");
    const g = await verifiedRun(db, spec.duel);
    if (!g) throw notFound("No verified run with that id");
    // Today's Daily: the Daily itself, with that ghost. A course: the course, with that ghost.
    if (g.mode === "daily" && g.course === utcDay(now)) return dailyPlan(g.id);
    if (g.mode === "trial" && isTrialCourse(g.course)) return trialPlan(g.course, g.id);
    // A ranked night, an earlier Daily or another duel: raced again on its own seed and save.
    const patrol = g.mode === "patrol" || g.mode === "daily" || (g.mode === "trial" && g.course === DUEL_COURSE);
    if (!patrol || g.ruleset !== String(RULESET_VERSION)) throw new HttpError(400, "not_raceable", "That run can’t be raced");
    return { kind: "duel", mode: "trial", course: DUEL_COURSE, seed: g.seed, ruleset: g.ruleset, night: g.night, startSave: duelSave(g.startSave, look), ghost: g.id, budget: trialBudget };
  }
  const ghostId = spec.ghost ?? null;
  if (spec.mode === "daily") {
    if (ghostId !== null) {
      const g = uuidLike(ghostId) ? await verifiedRun(db, ghostId) : null;
      if (!g || g.mode !== "daily" || g.course !== utcDay(now)) throw badRequest("That ghost isn’t from today’s Daily");
    }
    return dailyPlan(ghostId);
  }
  if (!isTrialCourse(spec.course)) throw new HttpError(400, "no_course", "There’s no such course");
  if (ghostId !== null) {
    const g = uuidLike(ghostId) ? await verifiedRun(db, ghostId) : null;
    if (!g || g.mode !== "trial" || g.course !== spec.course) throw badRequest("That ghost isn’t from this course");
  }
  return trialPlan(spec.course, ghostId);
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/**
 * Issue a competitive run. Like a ranked night: one run in flight per player (409 run_active;
 * `abandon` drops it), a daily budget (429 daily_cap), 45 minutes to finish. Any night, done or
 * not: none of these touch the save.
 */
export async function startCompeteRun(db: Db, input: { playerId: string; spec: CompeteSpec; abandon?: boolean; now?: Date }): Promise<StartedCompeteRun> {
  const now = input.now ?? new Date();
  const { playerId } = input;
  const { save, rev } = await ensureSave(db, playerId);
  if (!save.hero) throw conflict("no_hero", "Create a hero first");
  const p = await plan(db, input.spec, save, now);

  await db
    .update(runs)
    .set({ status: "expired", rejectReason: "timeout" })
    .where(and(eq(runs.playerId, playerId), eq(runs.status, "issued"), lte(runs.expiresAt, now)));
  const [active] = await db
    .select({ id: runs.id, expiresAt: runs.expiresAt })
    .from(runs)
    .where(and(eq(runs.playerId, playerId), eq(runs.status, "issued")))
    .limit(1);
  if (active) {
    if (!input.abandon) throw conflict("run_active", "A run is already in progress", { runId: active.id, expiresAt: active.expiresAt.toISOString() });
    await db
      .update(runs)
      .set({ status: "expired", rejectReason: "abandoned", submittedAt: now })
      .where(and(eq(runs.id, active.id), eq(runs.status, "issued")));
  }

  const budget = { scope: p.budget.scope, key: playerId, period: utcDay(now) };
  const reserved = await reserveBudget(db, { ...budget, limit: p.budget.limit }, now);
  if (!reserved.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil((dailyResetAt(now).getTime() - now.getTime()) / 1000));
    throw new HttpError(429, "daily_cap", p.budget.message, { limit: p.budget.limit, retryAfterSeconds });
  }

  const runId = randomUUID();
  const expiresAt = new Date(now.getTime() + RUN_TTL_MS);
  try {
    await db.insert(runs).values({
      id: runId,
      playerId,
      mode: p.mode,
      night: p.night,
      seed: p.seed,
      ruleset: p.ruleset,
      saveRevAtStart: rev,
      startSave: p.startSave,
      status: "issued",
      issuedAt: now,
      expiresAt,
      assist: false,
      course: p.course,
      ghostRunId: p.ghost,
    });
  } catch (error) {
    await releaseBudget(db, budget, now);
    if (isUniqueViolation(error)) throw conflict("run_active", "A run is already in progress");
    throw error;
  }
  return {
    runId,
    seed: p.seed,
    ruleset: p.ruleset,
    saveRev: rev,
    night: p.night,
    expiresAt: expiresAt.toISOString(),
    assist: false,
    chapter: null,
    compete: { kind: p.kind, course: p.course, ghost: p.ghost, startSave: p.startSave },
  };
}

/* ------------------------------------------------------------------ submit */

/** The ghost a run raced, as its results compare: who, and how their run went. */
export interface GhostSummary {
  runId: string;
  handle: string;
  heroName: string | null;
  score: number;
  ticks: number;
  finished: boolean;
}

/** What a submitted competitive run did: its result, its board, and the ghost it raced. */
export interface CompeteOutcome {
  kind: CompeteKind;
  /** The Daily's day, the course id, or "duel". */
  course: string;
  score: number;
  ticks: number;
  /** A trial crossed the finish; a patrol run (Daily, duel) always counts as finished. */
  finished: boolean;
  /** A trial's medal, or null. */
  medal: Medal | null;
  /** This run beat the player's best on its board (and is now their best). */
  improved: boolean;
  /** The player's best on the board after this run, its rank and the board's size (none for a duel). */
  best: { score: number; ticks: number; runId: string | null; medal: Medal | null } | null;
  rank: number | null;
  total: number;
  ghost: GhostSummary | null;
  /** Against the ghost: true when this run beat it, false when it didn't, null without one. */
  won: boolean | null;
  /** The Daily: days in a row with a verified Daily, today included. */
  streak?: number;
}

const finishedOf = (kind: CompeteKind, stats: Record<string, number> | null | undefined) => (kind === "trial" ? (stats?.finished ?? 0) === 1 : true);

async function ghostSummary(db: Db, runId: string | null): Promise<GhostSummary | null> {
  if (!runId) return null;
  const [row] = await db
    .select({ id: runs.id, score: runs.verifiedScore, ticks: runs.ticks, stats: runs.stats, mode: runs.mode, course: runs.course, startSave: runs.startSave, handle: players.handle })
    .from(runs)
    .innerJoin(players, eq(players.id, runs.playerId))
    .where(and(eq(runs.id, runId), eq(runs.status, "verified")))
    .limit(1);
  if (!row) return null;
  const kind = competeKind(row) ?? "duel";
  return {
    runId: row.id,
    handle: row.handle,
    heroName: (row.startSave as Save | null)?.hero?.name ?? null,
    score: row.score ?? 0,
    ticks: row.ticks ?? 0,
    finished: finishedOf(kind, row.stats as Record<string, number> | null),
  };
}

/** The board a competitive run lands on: the Daily's (by day) or a course's; a duel has none. */
function boardOf(kind: CompeteKind, course: string): { board: "daily" | "trial"; period: string } | null {
  if (kind === "daily") return { board: "daily", period: course };
  if (kind === "trial") return { board: "trial", period: course };
  return null;
}

/** A run's board score: the Daily's patrol score, or a trial's medal tier (0 for a finish slower than bronze). */
function boardScore(kind: CompeteKind, course: string, result: { score: number; ticks: number }): number {
  return kind === "trial" && isTrialCourse(course) ? medalTier(medalFor(course, result.ticks)) : result.score;
}

/** Puts a verified run on its board if it's the player's best there. Returns the board's tag when it moved. */
async function recordCompete(tx: Db, board: { board: "daily" | "trial"; period: string }, entry: { playerId: string; runId: string; score: number; ticks: number; now: Date }): Promise<boolean> {
  const { playerId, runId, score, ticks, now } = entry;
  const improved = await tx
    .insert(le)
    .values({ board: board.board, periodKey: board.period, playerId, bestScore: score, ticks, runId, updatedAt: now })
    .onConflictDoUpdate({
      target: [le.board, le.periodKey, le.playerId],
      set: { bestScore: score, ticks, runId, updatedAt: now },
      setWhere: sql`${le.bestScore} < ${score} or (${le.bestScore} = ${score} and ${le.ticks} > ${ticks})`,
    })
    .returning({ playerId: le.playerId });
  return improved.length > 0;
}

/** The player's entry on a board, if any. */
async function entryOf(db: Db, board: { board: "daily" | "trial"; period: string }, playerId: string) {
  const [row] = await db
    .select({ score: le.bestScore, ticks: le.ticks, runId: le.runId })
    .from(le)
    .where(and(eq(le.board, board.board), eq(le.periodKey, board.period), eq(le.playerId, playerId)))
    .limit(1);
  return row ?? null;
}

/** The whole outcome of a verified competitive run (also for an idempotent resubmit). */
async function outcomeOf(db: Db, run: Run, result: { score: number; ticks: number; stats: Record<string, number> }, improved: boolean, now: Date): Promise<CompeteOutcome> {
  const kind = competeKind(run)!;
  const course = run.course ?? "";
  const finished = finishedOf(kind, result.stats);
  const medal = kind === "trial" && finished && isTrialCourse(course) ? medalFor(course, result.ticks) : null;
  const board = boardOf(kind, course);
  const mine = board ? await entryOf(db, board, run.playerId) : null;
  const [rank, total] = board ? await Promise.all([rankOf(db, board.board, board.period, run.playerId), countEntries(db, board.board, board.period)]) : [null, 0];
  const ghost = await ghostSummary(db, run.ghostRunId);
  const race = (score: number, ticks: number, fin: boolean) => ({ score, ticks, finished: fin });
  const won = ghost ? compareRuns(kind === "trial" ? "trial" : "patrol", race(result.score, result.ticks, finished), race(ghost.score, ghost.ticks, ghost.finished)) < 0 : null;
  return {
    kind,
    course,
    score: result.score,
    ticks: result.ticks,
    finished,
    medal,
    improved,
    best: mine ? { score: mine.score, ticks: mine.ticks, runId: mine.runId, medal: kind === "trial" && isTrialCourse(course) ? medalFor(course, mine.ticks) : null } : null,
    rank,
    total,
    ghost,
    won,
    ...(kind === "daily" ? { streak: await dailyStreak(db, run.playerId, now) } : {}),
  };
}

/** A verified competitive run's stored outcome, for an idempotent resubmit. */
export async function storedCompete(db: Db, run: Run, now = new Date()): Promise<CompeteOutcome> {
  const stats = (run.stats as Record<string, number> | null) ?? {};
  const kind = competeKind(run)!;
  const board = boardOf(kind, run.course ?? "");
  const mine = board ? await entryOf(db, board, run.playerId) : null;
  return outcomeOf(db, run, { score: run.verifiedScore ?? 0, ticks: run.ticks ?? 0, stats }, mine?.runId === run.id, now);
}

/**
 * Submit a competitive run: replay it as its mode wants (the Daily and a duel as patrol nights
 * from their start save and seed; a trial as its course), then, verified, put it on its board
 * (none for a duel). Nothing is written to the save; no Bits, no Season board.
 */
export async function submitCompeteRun(
  db: Db,
  run: Run,
  input: { log: Uint8Array; clientHash: string; now: Date; verifier?: Verifier },
): Promise<SubmitResult & { compete?: CompeteOutcome }> {
  const { log, clientHash, now } = input;
  const kind = competeKind(run);
  if (!kind) throw new Error(`run ${run.id} isn't a competitive run`);
  const startSave = run.startSave as Save;
  const toVerify = { ruleset: run.ruleset, seed: run.seed, startSave, issuedAt: run.issuedAt };
  const course = run.course ?? "";
  const verdict =
    kind === "trial" && isTrialCourse(course)
      ? await verifyTrialRun({ ...toVerify, course }, log, clientHash, { now, verifier: input.verifier })
      : await verifyRun(toVerify, log, clientHash, { now, verifier: input.verifier ?? getVerifier() });
  const submitted = { inputLog: log, logBytes: log.byteLength, clientHash, submittedAt: now };
  const loadRun = async () => (await db.select().from(runs).where(eq(runs.id, run.id)).limit(1))[0]!;

  if (!verdict.ok) {
    const r = verdict.result;
    const rows = await db
      .update(runs)
      .set({ ...submitted, status: "rejected", rejectReason: verdict.reason, ticks: r && Number.isSafeInteger(r.ticks) ? r.ticks : null, stats: r?.stats ?? null, checkpoints: r?.checkpoints ?? null })
      .where(and(eq(runs.id, run.id), eq(runs.status, "issued")))
      .returning({ id: runs.id });
    if (rows.length === 0) return storedResult(db, await loadRun(), log, clientHash, now);
    return { status: "rejected", runId: run.id, reason: verdict.reason, idempotent: false };
  }

  const result: ReplayResult = verdict.result;
  const digest = runDigest(run, log, result.hash, result.score, result.ticks);
  const finished = finishedOf(kind, result.stats);
  const board = boardOf(kind, course);
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(runs)
      .set({ ...submitted, status: "verified", verifiedScore: result.score, ticks: result.ticks, stats: result.stats, checkpoints: result.checkpoints, digest, assist: false })
      .where(and(eq(runs.id, run.id), eq(runs.status, "issued")))
      .returning({ id: runs.id });
    if (rows.length === 0) return null;
    // A trial goes on the board only through the finish.
    const improved = board && finished ? await recordCompete(tx, board, { playerId: run.playerId, runId: run.id, score: boardScore(kind, course, result), ticks: result.ticks, now }) : false;
    return { improved };
  });
  if (!claimed) return storedResult(db, await loadRun(), log, clientHash, now);
  // Gwei's new stock (src/lib/market/new-stock.ts): a verified Daily earns a gas receipt, and a
  // clean one a finality flag, once a day each, once their pools are open.
  if (kind === "daily") {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(course) ? course : utcDay(now);
    await grantNewStock(db, { playerId: run.playerId, awards: dailyAward(result.stats), open: await openStockNow(db), day, runId: run.id, digest, now }).catch((error: unknown) => {
      console.error(`[new-stock] daily award for run ${run.id}: ${(error as Error).message}`);
    });
  }
  const verified = { ...run, status: "verified" as const, verifiedScore: result.score, ticks: result.ticks, stats: result.stats };
  const { save, rev } = await ensureSave(db, run.playerId);
  return {
    status: "verified",
    runId: run.id,
    score: result.score,
    ticks: result.ticks,
    digest,
    bits: 0,
    ranked: false,
    save,
    rev,
    tags: claimed.improved && board ? [boardTag(board.board, board.period)] : [],
    idempotent: false,
    compete: await outcomeOf(db, verified, { score: result.score, ticks: result.ticks, stats: result.stats }, claimed.improved, now),
  };
}

/** A finished competitive run's stored outcome (resubmitting the same log). */
async function storedResult(db: Db, run: Run, log: Uint8Array, clientHash: string, now: Date): Promise<SubmitResult & { compete?: CompeteOutcome }> {
  const same = !!run.inputLog && Buffer.compare(Buffer.from(run.inputLog), Buffer.from(log)) === 0 && run.clientHash === clientHash;
  if (!same) throw conflict("already_submitted", "This run was already submitted with a different log");
  if (run.status !== "verified") return { status: "rejected", runId: run.id, reason: run.rejectReason ?? "rejected", idempotent: true };
  const { save, rev } = await ensureSave(db, run.playerId);
  return {
    status: "verified",
    runId: run.id,
    score: run.verifiedScore ?? 0,
    ticks: run.ticks ?? 0,
    digest: run.digest ?? "",
    bits: 0,
    ranked: false,
    save,
    rev,
    tags: [],
    idempotent: true,
    compete: await storedCompete(db, run, now),
  };
}

/**
 * POST /api/runs/:id/submit for a competitive run (runs.ts submitRun hands it here by mode): the
 * stored outcome of a finished run (idempotent), 410 for an expired one, else the replay.
 */
export async function submitCompete(
  db: Db,
  run: Run,
  input: { log: Uint8Array; clientHash: string; now: Date; verifier?: Verifier },
): Promise<SubmitResult & { compete?: CompeteOutcome }> {
  const { now } = input;
  if (run.status === "verified" || run.status === "rejected") return storedResult(db, run, input.log, input.clientHash, now);
  if (run.status === "expired") throw new HttpError(410, "run_expired", "This run expired; start a new one");
  if (now.getTime() > run.expiresAt.getTime() + SUBMIT_GRACE_MS) {
    await db
      .update(runs)
      .set({ status: "expired", rejectReason: "timeout", submittedAt: now })
      .where(and(eq(runs.id, run.id), eq(runs.status, "issued")));
    throw new HttpError(410, "run_expired", "This run expired; start a new one");
  }
  return submitCompeteRun(db, run, input);
}

/* ------------------------------------------------------------------ streaks and podiums */

const dayBefore = (day: string) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000));

/** Days in a row, up to today (or yesterday, if today isn't played yet), with a verified Daily. */
export async function dailyStreak(db: Db, playerId: string, now = new Date()): Promise<number> {
  const today = utcDay(now);
  const since = utcDay(new Date(now.getTime() - 120 * 86_400_000));
  const rows = await db
    .select({ day: le.periodKey })
    .from(le)
    .where(and(eq(le.board, "daily"), eq(le.playerId, playerId), gte(le.periodKey, since), lte(le.periodKey, today)))
    .orderBy(desc(le.periodKey));
  const days = new Set(rows.map((r) => r.day));
  let day = days.has(today) ? today : dayBefore(today);
  let n = 0;
  while (days.has(day)) {
    n += 1;
    day = dayBefore(day);
  }
  return n;
}

/** The player's finishes in the top three of a settled Daily (days before today), in the last 120 days. */
export async function dailyPodiums(db: Db, playerId: string, now = new Date()): Promise<{ podiums: number; wins: number }> {
  const today = utcDay(now);
  const since = utcDay(new Date(now.getTime() - 120 * 86_400_000));
  const rows = await queryRows<{ r: number }>(
    db,
    sql`
      select r from (
        select e.player_id, rank() over (partition by e.period_key order by e.best_score desc, e.ticks asc, e.updated_at asc, e.player_id asc)::int as r
        from ${le} e join ${players} p on p.id = e.player_id
        where e.board = 'daily' and e.period_key >= ${since} and e.period_key < ${today} and p.banned_at is null
          and e.period_key in (select period_key from ${le} where board = 'daily' and player_id = ${playerId})
      ) ranked
      where player_id = ${playerId}
    `,
  );
  return { podiums: rows.filter((r) => Number(r.r) <= 3).length, wins: rows.filter((r) => Number(r.r) === 1).length };
}

/* ------------------------------------------------------------------ settling a day (badges) */

/** A day's board is final once its last run could no longer be submitted: midnight, plus a run's time and the grace. */
export const dailySettlesAt = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000 + RUN_TTL_MS + SUBMIT_GRACE_MS);

/**
 * Award the badges of every finished Daily from the last few days: `daily-podium` to its top
 * three and `daily-winner` to its first, each queued once per player ever (its outbox key), with
 * the player's next reward nonce, through `mint_rewards`' `badges` (as Case File 001's badge).
 * Idempotent. Returns what it queued.
 */
export async function settleDailies(db: Db, now = new Date(), days = 3): Promise<{ day: string; playerId: string; badge: string }[]> {
  const queued: { day: string; playerId: string; badge: string }[] = [];
  let open: Set<string> | null = null;
  let day = dayBefore(utcDay(now));
  for (let i = 0; i < days; i++, day = dayBefore(day)) {
    if (dailySettlesAt(day).getTime() > now.getTime()) continue;
    const top = await topEntries(db, "daily", day, 3);
    for (const row of top) {
      if (!row.runId) continue;
      const badges = row.rank === 1 ? [DAILY_BADGES.winner, DAILY_BADGES.podium] : [DAILY_BADGES.podium];
      for (const badge of badges) {
        const done = await db.transaction(async (tx) => {
          const [run] = await tx.select({ digest: runs.digest }).from(runs).where(eq(runs.id, row.runId!)).limit(1);
          const player = await getPlayer(tx, row.playerId);
          if (!run?.digest || !player) return false;
          const res = await enqueueRewardMint(
            tx,
            {
              kind: "mint_reward",
              dedupeKey: dailyBadgeKey(badge, row.playerId),
              playerId: row.playerId,
              payload: { runId: row.runId, playerId: row.playerId, accountId: player.nearAccountId, items: [], badges: [badge], digest: run.digest, day },
            },
            now,
          );
          return res.queued;
        });
        if (done) queued.push({ day, playerId: row.playerId, badge });
      }
      // Gwei's new stock: a torn seed phrase for each day placed, once its pool is open.
      open ??= await openStockNow(db);
      if (open.size > 0) {
        const [placed] = await db.select({ digest: runs.digest }).from(runs).where(eq(runs.id, row.runId)).limit(1);
        if (placed?.digest) await grantNewStock(db, { playerId: row.playerId, awards: podiumAward(row.rank), open, day, runId: row.runId, digest: placed.digest, now, waitForRun: true });
      }
    }
  }
  return queued;
}

/** Where a player's Daily badges stand (none, queued or minted), by badge. */
export async function dailyBadges(db: Db, playerId: string): Promise<Record<string, { status: "none" | "queued" | "minted"; tokenId: string; tx: string | null }>> {
  const ids = Object.values(DAILY_BADGES);
  const ops = await db
    .select({ key: chainOps.dedupeKey, status: chainOps.status, tx: chainOps.txHash })
    .from(chainOps)
    .where(inArray(chainOps.dedupeKey, ids.map((b) => dailyBadgeKey(b, playerId))));
  const out: Record<string, { status: "none" | "queued" | "minted"; tokenId: string; tx: string | null }> = {};
  for (const b of ids) {
    const op = ops.find((o) => o.key === dailyBadgeKey(b, playerId));
    const minted = op?.status === "sent";
    out[b] = { status: !op ? "none" : minted ? "minted" : "queued", tokenId: `trophy:badge:${b}`, tx: minted ? (op.tx ?? null) : null };
  }
  return out;
}

/* ------------------------------------------------------------------ the hub */

export interface CompeteRivalView {
  /** Their run you raced. */
  ghostRunId: string;
  handle: string;
  heroName: string | null;
  kind: CompeteKind;
  course: string;
  theirs: { score: number; ticks: number };
  /** Your best race against them. */
  yours: { runId: string; score: number; ticks: number };
  won: boolean;
  races: number;
  at: string;
}

export interface CompeteView {
  now: string;
  signedIn: boolean;
  daily: {
    day: string;
    resetsAt: string;
    kit: PowerId[];
    /** The day's seed: public once the day has begun (every verified run's replay shows it). */
    seed: number;
    attempts: { used: number; limit: number };
    best: { score: number; ticks: number; runId: string | null; rank: number | null } | null;
    total: number;
    streak: number;
    podiums: number;
    wins: number;
    badges: Awaited<ReturnType<typeof dailyBadges>> | null;
    top: BoardRow[];
  };
  trials: {
    id: TrialCourseId;
    best: { ticks: number; medal: Medal | null; runId: string | null; rank: number | null } | null;
    record: { ticks: number; handle: string; heroName: string | null; runId: string | null } | null;
    total: number;
  }[];
  rivals: CompeteRivalView[];
  races: { used: number; limit: number };
  /** A run in flight (any mode), to resume or abandon. */
  active: { runId: string; expiresAt: string; mode: string; course: string | null } | null;
}

/** The ghosts a player has raced: each rival's latest run you raced, and how your best race against them went. */
export async function rivalsOf(db: Db, playerId: string, limit = 8): Promise<CompeteRivalView[]> {
  const rows = await db
    .select({
      runId: runs.id,
      score: runs.verifiedScore,
      ticks: runs.ticks,
      stats: runs.stats,
      mode: runs.mode,
      course: runs.course,
      ghostRunId: runs.ghostRunId,
      at: runs.submittedAt,
    })
    .from(runs)
    .where(and(eq(runs.playerId, playerId), eq(runs.status, "verified"), isNotNull(runs.ghostRunId)))
    .orderBy(desc(runs.submittedAt))
    .limit(60);
  const byGhost = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.ghostRunId!;
    byGhost.set(k, [...(byGhost.get(k) ?? []), r]);
  }
  const out: CompeteRivalView[] = [];
  for (const [ghostRunId, races] of byGhost) {
    if (out.length >= limit) break;
    const g = await ghostSummary(db, ghostRunId);
    if (!g) continue;
    const kind = competeKind(races[0]) ?? "duel";
    const cmp = kind === "trial" ? "trial" : "patrol";
    const best = [...races].sort((a, b) => compareRuns(cmp, { score: a.score ?? 0, ticks: a.ticks ?? 0, finished: finishedOf(kind, a.stats as Record<string, number>) }, { score: b.score ?? 0, ticks: b.ticks ?? 0, finished: finishedOf(kind, b.stats as Record<string, number>) }))[0];
    const won = compareRuns(cmp, { score: best.score ?? 0, ticks: best.ticks ?? 0, finished: finishedOf(kind, best.stats as Record<string, number>) }, { score: g.score, ticks: g.ticks, finished: g.finished }) < 0;
    out.push({
      ghostRunId,
      handle: g.handle,
      heroName: g.heroName,
      kind,
      course: races[0].course ?? "",
      theirs: { score: g.score, ticks: g.ticks },
      yours: { runId: best.runId, score: best.score ?? 0, ticks: best.ticks ?? 0 },
      won,
      races: races.length,
      at: (races[0].at ?? new Date()).toISOString(),
    });
  }
  return out;
}

/** Everything the Compete hub shows: today's Daily, the trials, your rivals. */
export async function competeView(db: Db, playerId: string | null, now = new Date()): Promise<CompeteView> {
  const day = utcDay(now);
  const [top, total] = await Promise.all([topEntries(db, "daily", day, 5), countEntries(db, "daily", day)]);
  const mine = playerId ? await aroundPlayer(db, "daily", day, playerId, 0) : null;
  const trials = await Promise.all(
    TRIAL_COURSE_IDS.map(async (id) => {
      const [[first], n, me] = await Promise.all([topEntries(db, "trial", id, 1), countEntries(db, "trial", id), playerId ? aroundPlayer(db, "trial", id, playerId, 0) : null]);
      return {
        id,
        best: me ? { ticks: me.me.ticks, medal: medalFor(id, me.me.ticks), runId: me.me.runId, rank: me.me.rank } : null,
        record: first ? { ticks: first.ticks, handle: first.handle, heroName: first.heroName, runId: first.runId } : null,
        total: n,
      };
    }),
  );
  let active: CompeteView["active"] = null;
  if (playerId) {
    const [row] = await db
      .select({ id: runs.id, expiresAt: runs.expiresAt, mode: runs.mode, course: runs.course })
      .from(runs)
      .where(and(eq(runs.playerId, playerId), eq(runs.status, "issued")))
      .limit(1);
    if (row && row.expiresAt.getTime() > now.getTime()) active = { runId: row.id, expiresAt: row.expiresAt.toISOString(), mode: row.mode, course: row.course };
  }
  const [used, races, streak, podiums, badges, rivals] = playerId
    ? await Promise.all([
        budgetUsed(db, { scope: DAILY_BUDGET_SCOPE, key: playerId, period: day }),
        budgetUsed(db, { scope: TRIAL_BUDGET_SCOPE, key: playerId, period: day }),
        dailyStreak(db, playerId, now),
        dailyPodiums(db, playerId, now),
        dailyBadges(db, playerId),
        rivalsOf(db, playerId),
      ])
    : [0, 0, 0, { podiums: 0, wins: 0 }, null, []];
  return {
    now: now.toISOString(),
    signedIn: !!playerId,
    daily: {
      day,
      resetsAt: dailyResetAt(now).toISOString(),
      kit: dailyKit(day),
      seed: dailySeed(day),
      attempts: { used, limit: DAILY_ATTEMPTS },
      best: mine ? { score: mine.me.score, ticks: mine.me.ticks, runId: mine.me.runId, rank: mine.me.rank } : null,
      total,
      streak,
      podiums: podiums.podiums,
      wins: podiums.wins,
      badges,
      top,
    },
    trials,
    rivals,
    races: { used: races, limit: TRIAL_RUNS_PER_DAY },
    active,
  };
}

/* ------------------------------------------------------------------ ghosts to race */

/** A ghost the client can fetch (GET /api/runs/:id/replay) and race. */
export interface GhostEntry {
  runId: string;
  handle: string;
  heroName: string | null;
  suit: string | null;
  /** On its board (1 = first), or null for a chosen ghost off the top. */
  rank: number | null;
  score: number;
  ticks: number;
  /** "#1", "#2", "You", or the rival's handle. */
  label: string;
  mine: boolean;
}

/**
 * The ghosts to race: the board's top three (the Daily's today, or a course's), the player's own
 * best, and a chosen run (by id) if it fits. Deduplicated, at most four.
 */
export async function ghostsFor(db: Db, input: { mode: "daily" | "trial"; course?: string; ghost?: string | null; playerId: string | null; now?: Date }): Promise<GhostEntry[]> {
  const now = input.now ?? new Date();
  const board = input.mode === "daily" ? { board: "daily" as const, period: utcDay(now) } : isTrialCourse(input.course) ? { board: "trial" as const, period: input.course } : null;
  if (!board) throw new HttpError(400, "no_course", "There’s no such course");
  const out: GhostEntry[] = [];
  const add = (e: GhostEntry) => {
    if (out.length < 4 && !out.some((o) => o.runId === e.runId)) out.push(e);
  };
  if (input.ghost && uuidLike(input.ghost)) {
    const g = await ghostSummary(db, input.ghost);
    const row = await verifiedRun(db, input.ghost);
    if (g && row && (input.mode === "daily" ? row.mode === "daily" && row.course === board.period : row.mode === "trial" && row.course === board.period)) {
      add({ runId: g.runId, handle: g.handle, heroName: g.heroName, suit: (row.startSave.hero?.suit as string) ?? null, rank: null, score: g.score, ticks: g.ticks, label: g.handle, mine: row.playerId === input.playerId });
    }
  }
  const top = await topEntries(db, board.board, board.period, 4);
  for (const r of top) {
    if (!r.runId || r.playerId === input.playerId) continue;
    if (out.filter((o) => o.rank !== null && !o.mine).length >= 3) break;
    add({ runId: r.runId, handle: r.handle, heroName: r.heroName, suit: r.suit, rank: r.rank, score: r.score, ticks: r.ticks, label: `#${r.rank}`, mine: false });
  }
  if (input.playerId) {
    const me = await aroundPlayer(db, board.board, board.period, input.playerId, 0);
    if (me?.me.runId) add({ runId: me.me.runId, handle: me.me.handle, heroName: me.me.heroName, suit: me.me.suit, rank: me.me.rank, score: me.me.score, ticks: me.me.ticks, label: "You", mine: true });
  }
  return out;
}

/** What a challenge link (/play/compete/race/<runId>) opens: the run, and how it can be raced. */
export interface RaceTarget {
  runId: string;
  handle: string;
  heroName: string | null;
  kind: "daily" | "trial" | "night";
  /** The Daily's day, or the course. */
  course: string | null;
  score: number;
  ticks: number;
  finished: boolean;
  /** "daily": today's Daily with this ghost; "trial": the course with this ghost; "duel": the run's own night again. */
  opens: "daily" | "trial" | "duel";
}

export async function raceTarget(db: Db, runId: string, now = new Date()): Promise<RaceTarget | null> {
  if (!uuidLike(runId)) return null;
  const row = await verifiedRun(db, runId);
  const g = row ? await ghostSummary(db, runId) : null;
  if (!row || !g) return null;
  const base = { runId, handle: g.handle, heroName: g.heroName, score: g.score, ticks: g.ticks, finished: g.finished };
  if (row.mode === "daily") return { ...base, kind: "daily", course: row.course, opens: row.course === utcDay(now) ? "daily" : "duel" };
  if (row.mode === "trial" && isTrialCourse(row.course)) return { ...base, kind: "trial", course: row.course, opens: "trial" };
  if ((row.mode === "patrol" || (row.mode === "trial" && row.course === DUEL_COURSE)) && row.ruleset === String(RULESET_VERSION)) return { ...base, kind: "night", course: null, opens: "duel" };
  return null;
}

/* ------------------------------------------------------------------ boards */

/** "daily" or "trial:<course>" → the board and its period (today's Daily by default). */
export function competeBoard(board: string, period: string | null | undefined, now: Date): { board: "daily" | "trial"; period: string } | null {
  if (board === "daily") return { board: "daily", period: isDayKey(period) && !Number.isNaN(Date.parse(period)) ? period : utcDay(now) };
  const course = board === "trial" ? period : board.startsWith("trial:") ? board.slice("trial:".length) : null;
  return isTrialCourse(course) ? { board: "trial", period: course } : null;
}
