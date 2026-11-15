/**
 * The ranked-run lifecycle: issue a seed, take a submitted input log, replay it, and on
 * success write the save, the boards and the reward mint in one transaction.
 *
 *   start  → runs row "issued" with seed = HMAC(SEED_SECRET, runId), 45 minutes to finish
 *   submit → verified | rejected (reason stored) | expired
 *
 * Idempotent: resubmitting the same log returns the stored outcome; a different log for
 * a finished run is a 409.
 *
 * Story chapters (Case File 001; cases.ts) go through the same start and submit with
 * `runs.mode` = the chapter id and `runs.ruleset` = its CHAPTER_RULESET. They are replayed as
 * the chapter (verify.ts verifyChapterRun), can be played on any night, have their own daily
 * budget, and are unranked: no board, no Bits. A clear closes the case in the save.
 *
 * Competitive runs (the Daily Run, time trials and duels; compete.ts) are issued by
 * startCompeteRun and submitted here, handed straight to submitCompeteRun by their mode.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";

import { and, eq, lte } from "drizzle-orm";

import { applyCaseClear, caseRecord, CHAPTERS, isChapterId } from "@wgp/game-core/chapters";
import type { ReplayResult } from "@wgp/game-core/sim3d/contract";
import type { ChapterId, Save } from "@wgp/game-core/types";

import { caseAward } from "@/lib/market/new-stock";
import { nightBits } from "@/lib/market/rewards";
import { secret } from "@/server/auth/secrets";
import { HttpError, conflict, notFound } from "@/server/http";
import { reserveBudget, releaseBudget, utcDay } from "@/server/rate-limit";
import { getChapterVerifier, getVerifier, verifyChapterRun, verifyRun, type Verifier } from "@/server/verify";
import { grantNewStockTx, openStockNow } from "@/server/market/new-stock";

import { badgeKey, badgeView, CASE_BUDGET_SCOPE, CASE_RUNS_PER_DAY, type CaseOutcome } from "./cases";
import type { Db } from "./client";
import { isCompeteMode, submitCompete, type CompeteOutcome } from "./compete";
import { recordScore } from "./leaderboard";
import { BITS_TOKEN_ID, enqueueRewardMint, lootDiff, withBits, type MintItem } from "./outbox";
import { plural } from "@/lib/plural";

import { ensureSave, getPlayer, writeSave } from "./players";
import { chainOps, players, runs, saves, type Run } from "./schema";

export const RUN_TTL_MS = 45 * 60_000;
export const RUNS_PER_DAY = 20;
/** Network slack after expires_at before a submit is refused. */
export const SUBMIT_GRACE_MS = 2 * 60_000;
export const RUN_BUDGET_SCOPE = "runs:ranked";

/** The run's seed: the first 32 bits of HMAC-SHA256(SEED_SECRET, runId). Unpredictable to players. */
export function seedFor(runId: string, key = secret("SEED_SECRET")): number {
  return createHmac("sha256", key).update(`run-seed\0${runId}`).digest().readUInt32BE(0);
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** What the reward mint carries on chain: binds the run, its inputs and its result. */
export function runDigest(run: Pick<Run, "id" | "playerId" | "seed" | "ruleset">, log: Uint8Array, hash: string, score: number, ticks: number): string {
  return sha256(["wgp-run-v1", run.id, run.playerId, run.seed, run.ruleset, sha256(log), hash, score, ticks].join("|"));
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/* ------------------------------------------------------------------ start */

export interface StartedRun {
  runId: string;
  seed: number;
  ruleset: string;
  saveRev: number;
  night: number;
  expiresAt: string;
  assist: boolean;
  /** The story chapter this run plays (startChapterRun on the client), or null for a ranked night. */
  chapter: ChapterId | null;
}

export async function startRun(
  db: Db,
  input: { playerId: string; assist?: boolean; abandon?: boolean; chapter?: ChapterId; now?: Date; verifier?: Verifier },
): Promise<StartedRun> {
  const now = input.now ?? new Date();
  const chapter = input.chapter ?? null;
  if (chapter !== null && !isChapterId(chapter)) throw new HttpError(400, "no_chapter", "There’s no such case file");
  const verifier = input.verifier ?? (chapter ? getChapterVerifier(chapter) : getVerifier());
  const { playerId } = input;

  const { save, rev } = await ensureSave(db, playerId);
  if (!save.hero) throw conflict("no_hero", "Create a hero first");
  // A chapter needs no patrol: it can be played on any night, before or after tonight's.
  if (!chapter && save.nightDone) throw conflict("night_done", "Tonight’s patrol is done; sleep first");
  if (!chapter && save.patrol) throw conflict("patrol_in_progress", "A patrol is already under way in this save");

  // Runs past their deadline no longer count as in flight.
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

  const limit = chapter ? CASE_RUNS_PER_DAY : RUNS_PER_DAY;
  const budget = { scope: chapter ? CASE_BUDGET_SCOPE : RUN_BUDGET_SCOPE, key: playerId, period: utcDay(now) };
  const reserved = await reserveBudget(db, { ...budget, limit }, now);
  if (!reserved.ok) {
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const retryAfterSeconds = Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
    const message = chapter ? `That’s ${plural(limit, "try", "tries")} at this case today. Bearson’s door opens again at midnight UTC.` : `That’s ${plural(limit, "run")} today. The city resets at midnight UTC.`;
    throw new HttpError(429, "daily_cap", message, { limit, retryAfterSeconds });
  }

  const runId = randomUUID();
  const seed = seedFor(runId);
  const expiresAt = new Date(now.getTime() + RUN_TTL_MS);
  // Chapter runs are never ranked, so assist (slow motion) changes nothing there.
  const assist = chapter ? false : !!input.assist;
  try {
    await db.insert(runs).values({
      id: runId,
      playerId,
      mode: chapter ?? "patrol",
      night: save.night,
      seed,
      ruleset: verifier.ruleset,
      saveRevAtStart: rev,
      startSave: save,
      status: "issued",
      issuedAt: now,
      expiresAt,
      assist,
    });
  } catch (error) {
    await releaseBudget(db, budget, now);
    if (isUniqueViolation(error)) throw conflict("run_active", "A run is already in progress");
    throw error;
  }

  return { runId, seed, ruleset: verifier.ruleset, saveRev: rev, night: save.night, expiresAt: expiresAt.toISOString(), assist, chapter };
}

/* ------------------------------------------------------------------ submit */

export type SubmitResult =
  | {
      status: "verified";
      runId: string;
      score: number;
      ticks: number;
      digest: string;
      /** Bits minted for the night (src/lib/market/rewards.ts). */
      bits: number;
      /** False for assist runs, which save progress but stay off the boards. */
      ranked: boolean;
      save: Save;
      rev: number;
      /** Cache tags of the boards this run changed; the route revalidates them. */
      tags: string[];
      idempotent: boolean;
      /** A chapter run (never ranked, no Bits): what it did to the case. */
      chapter?: CaseOutcome;
      /** A competitive run (the Daily, a trial or a duel; never ranked, no Bits): its board and its ghost. */
      compete?: CompeteOutcome;
    }
  | { status: "rejected"; runId: string; reason: string; idempotent: boolean };

class Abort extends Error {
  constructor(readonly why: "raced" | "rev_conflict") {
    super(why);
  }
}

const sameBytes = (a: Uint8Array | null, b: Uint8Array) => !!a && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

async function loadRun(db: Db, runId: string): Promise<Run | null> {
  const [row] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  return row ?? null;
}

/** The Bits a verified run's reward mint carries (0 if it queued none). */
async function mintedBitsFor(db: Db, runId: string): Promise<number> {
  const [op] = await db.select({ payload: chainOps.payload }).from(chainOps).where(eq(chainOps.dedupeKey, `mint_reward:${runId}`)).limit(1);
  const items = (op?.payload as { items?: MintItem[] } | undefined)?.items ?? [];
  return items.find((i) => i.tokenId === BITS_TOKEN_ID)?.amount ?? 0;
}

/** The stored outcome of a finished run, for idempotent resubmits. */
async function storedOutcome(db: Db, run: Run, log: Uint8Array, clientHash: string): Promise<SubmitResult> {
  if (!sameBytes(run.inputLog, log) || run.clientHash !== clientHash) {
    throw conflict("already_submitted", "This run was already submitted with a different log");
  }
  if (run.status === "verified") {
    const { save, rev } = await ensureSave(db, run.playerId);
    const chapter = isChapterId(run.mode) ? run.mode : null;
    return {
      status: "verified",
      runId: run.id,
      score: run.verifiedScore ?? 0,
      ticks: run.ticks ?? 0,
      digest: run.digest ?? "",
      bits: chapter ? 0 : await mintedBitsFor(db, run.id),
      ranked: !run.assist && !chapter,
      save,
      rev,
      tags: [],
      idempotent: true,
      ...(chapter ? { chapter: await storedCase(db, run, chapter, save) } : {}),
    };
  }
  return { status: "rejected", runId: run.id, reason: run.rejectReason ?? "rejected", idempotent: true };
}

/** A verified chapter run's case outcome, read back (an idempotent resubmit). */
async function storedCase(db: Db, run: Run, chapter: ChapterId, save: Save): Promise<CaseOutcome> {
  const cleared = (run.stats as Record<string, number> | null)?.cleared === 1;
  const [op] = await db.select({ payload: chainOps.payload }).from(chainOps).where(eq(chainOps.dedupeKey, badgeKey(chapter, run.playerId))).limit(1);
  const firstClear = (op?.payload as { runId?: string } | undefined)?.runId === run.id;
  return { id: chapter, cleared, firstClear, record: caseRecord(save, chapter), badge: await badgeView(db, chapter, run.playerId) };
}

/**
 * A verified chapter run: unranked, no Bits. A clear closes the case in the save as it is now
 * (the case is added to whatever else changed since the run began, so it never conflicts),
 * and the first clear queues the badge (one per player, by its outbox key) and pays the XP.
 */
async function closeCase(
  db: Db,
  run: Run,
  chapter: ChapterId,
  result: ReplayResult,
  ctx: { log: Uint8Array; clientHash: string; now: Date; submitted: Record<string, unknown> },
): Promise<SubmitResult> {
  const { log, clientHash, now, submitted } = ctx;
  const playerId = run.playerId;
  const cleared = (result.stats.cleared ?? 0) === 1;
  const digest = runDigest(run, log, result.hash, result.score, result.ticks);
  const player = await getPlayer(db, playerId);
  if (!player) throw notFound("No such player");
  // Gwei's new stock (src/lib/market/new-stock.ts): a clear earns an evidence bag, once a day, once its pool is open.
  const stockOpen = cleared ? await openStockNow(db) : new Set<string>();
  try {
    const out = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(runs)
        .set({ ...submitted, status: "verified", verifiedScore: result.score, ticks: result.ticks, stats: result.stats, checkpoints: result.checkpoints, digest, assist: false })
        .where(and(eq(runs.id, run.id), eq(runs.status, "issued")))
        .returning({ id: runs.id });
      if (claimed.length === 0) throw new Abort("raced");
      await ensureSave(tx, playerId);
      const [row] = await tx.select({ state: saves.state, rev: saves.rev }).from(saves).where(eq(saves.playerId, playerId)).for("update");
      let save = row!.state as Save;
      let rev = row!.rev;
      let firstClear = false;
      if (cleared) {
        const level = save.hero?.level ?? 0;
        const closed = applyCaseClear(save, chapter, result.ticks, now.toISOString(), true);
        firstClear = closed.firstClear;
        if (JSON.stringify(closed.record) !== JSON.stringify(caseRecord(save, chapter)) || closed.save.hero !== save.hero) {
          const next = await writeSave(tx, playerId, closed.save, rev, now);
          if (next === null) throw new Abort("raced");
          save = closed.save;
          rev = next;
        }
        if (firstClear) {
          const after = save.hero?.level ?? 0;
          await enqueueRewardMint(
            tx,
            {
              kind: "mint_reward",
              dedupeKey: badgeKey(chapter, playerId),
              playerId,
              payload: { runId: run.id, playerId, accountId: player.nearAccountId, items: [], badges: [CHAPTERS[chapter].badge], ...(after > level ? { level: after } : {}), digest },
            },
            now,
          );
        }
        const stock = await grantNewStockTx(tx, { playerId, accountId: player.nearAccountId, awards: caseAward(result.stats), open: stockOpen, day: utcDay(now), runId: run.id, digest, now, save, rev });
        save = stock.save;
        rev = stock.rev;
      }
      return { save, rev, firstClear };
    });
    return {
      status: "verified",
      runId: run.id,
      score: result.score,
      ticks: result.ticks,
      digest,
      bits: 0,
      ranked: false,
      save: out.save,
      rev: out.rev,
      tags: [],
      idempotent: false,
      chapter: { id: chapter, cleared, firstClear: out.firstClear, record: caseRecord(out.save, chapter), badge: await badgeView(db, chapter, playerId) },
    };
  } catch (error) {
    if (!(error instanceof Abort)) throw error;
    return storedOutcome(db, (await loadRun(db, run.id))!, log, clientHash);
  }
}

export async function submitRun(
  db: Db,
  input: { playerId: string; runId: string; log: Uint8Array; clientHash: string; now?: Date; verifier?: Verifier },
): Promise<SubmitResult> {
  const now = input.now ?? new Date();
  const { playerId, log, clientHash } = input;

  const run = await loadRun(db, input.runId);
  if (!run || run.playerId !== playerId) throw notFound("No such run");
  // The Daily, a trial or a duel: its own replay, board and outcome (compete.ts).
  if (isCompeteMode(run.mode)) return submitCompete(db, run, { log, clientHash, now, verifier: input.verifier });
  if (run.status === "verified" || run.status === "rejected") return storedOutcome(db, run, log, clientHash);
  if (run.status === "expired") throw new HttpError(410, "run_expired", "This run expired; start a new one");
  if (now.getTime() > run.expiresAt.getTime() + SUBMIT_GRACE_MS) {
    await db
      .update(runs)
      .set({ status: "expired", rejectReason: "timeout", submittedAt: now })
      .where(and(eq(runs.id, run.id), eq(runs.status, "issued")));
    throw new HttpError(410, "run_expired", "This run expired; start a new one");
  }

  const startSave = run.startSave as Save;
  const chapter = isChapterId(run.mode) ? run.mode : null;
  const toVerify = { ruleset: run.ruleset, seed: run.seed, startSave, issuedAt: run.issuedAt };
  const verdict = chapter
    ? await verifyChapterRun({ ...toVerify, chapter }, log, clientHash, { now, verifier: input.verifier })
    : await verifyRun(toVerify, log, clientHash, { now, verifier: input.verifier });
  const submitted = { inputLog: log, logBytes: log.byteLength, clientHash, submittedAt: now };

  if (!verdict.ok) {
    const r = verdict.result;
    const rows = await db
      .update(runs)
      .set({
        ...submitted,
        status: "rejected",
        rejectReason: verdict.reason,
        ticks: r && Number.isSafeInteger(r.ticks) ? r.ticks : null,
        stats: r?.stats ?? null,
        checkpoints: r?.checkpoints ?? null,
      })
      .where(and(eq(runs.id, run.id), eq(runs.status, "issued")))
      .returning({ id: runs.id });
    if (rows.length === 0) return storedOutcome(db, (await loadRun(db, run.id))!, log, clientHash);
    return { status: "rejected", runId: run.id, reason: verdict.reason, idempotent: false };
  }

  const { result } = verdict;
  // A chapter: no board, no Bits; a clear closes the case.
  if (chapter) return closeCase(db, run, chapter, result, { log, clientHash, now, submitted });
  const assist = run.assist || (result.stats.assist ?? 0) > 0;
  const digest = runDigest(run, log, result.hash, result.score, result.ticks);
  // Bits come from the verified replay alone (its score and, since ruleset 3, the Bits tokens it
  // collected); the results screen shows the number this returns.
  const bits = nightBits({
    score: result.score,
    levelledUp: (result.save.hero?.level ?? 0) > (startSave.hero?.level ?? 0),
    pickups: result.stats.bits ?? 0,
  });
  const player = await getPlayer(db, playerId);
  if (!player) throw notFound("No such player");

  try {
    const out = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(runs)
        .set({
          ...submitted,
          status: "verified",
          verifiedScore: result.score,
          ticks: result.ticks,
          stats: result.stats,
          checkpoints: result.checkpoints,
          digest,
          assist,
        })
        .where(and(eq(runs.id, run.id), eq(runs.status, "issued")))
        .returning({ id: runs.id });
      if (claimed.length === 0) throw new Abort("raced");

      const rev = await writeSave(tx, playerId, result.save, run.saveRevAtStart, now);
      if (rev === null) throw new Abort("rev_conflict");

      const tags = assist ? [] : await recordScore(tx, { playerId, runId: run.id, score: result.score, ticks: result.ticks, issuedAt: run.issuedAt, now });

      // Loot, the night's Bits (from the verified score) and any level-up the contract
      // needs for crafting checks are minted with the player's next reward nonce, taken in
      // this transaction.
      const level = result.save.hero?.level;
      const levelledUp = !!level && level > (startSave.hero?.level ?? 0);
      const items = withBits(lootDiff(startSave.inventory ?? {}, result.save.inventory ?? {}), bits);
      if (items.length > 0 || levelledUp) {
        await enqueueRewardMint(
          tx,
          {
            kind: "mint_reward",
            dedupeKey: `mint_reward:${run.id}`,
            playerId,
            payload: { runId: run.id, playerId, accountId: player.nearAccountId, items, ...(level ? { level } : {}), digest },
          },
          now,
        );
      }
      return { rev, tags };
    });
    return {
      status: "verified",
      runId: run.id,
      score: result.score,
      ticks: result.ticks,
      digest,
      bits,
      ranked: !assist,
      save: result.save,
      rev: out.rev,
      tags: out.tags,
      idempotent: false,
    };
  } catch (error) {
    if (!(error instanceof Abort)) throw error;
    if (error.why === "raced") return storedOutcome(db, (await loadRun(db, run.id))!, log, clientHash);
    // The save moved on since the run started (another tab, a migration): the log no longer applies.
    const rows = await db
      .update(runs)
      .set({ ...submitted, status: "rejected", rejectReason: "rev_conflict", ticks: result.ticks, stats: result.stats, checkpoints: result.checkpoints, digest })
      .where(and(eq(runs.id, run.id), eq(runs.status, "issued")))
      .returning({ id: runs.id });
    if (rows.length === 0) return storedOutcome(db, (await loadRun(db, run.id))!, log, clientHash);
    return { status: "rejected", runId: run.id, reason: "rev_conflict", idempotent: false };
  }
}

/* ------------------------------------------------------------------ reads */

/** The player's run in flight, if any. `chapter`: a story chapter's run (it blocks a ranked night too, one run at a time). */
export async function activeRun(
  db: Db,
  playerId: string,
  now = new Date(),
): Promise<{ runId: string; expiresAt: string; night: number; chapter: ChapterId | null; mode: string; course: string | null } | null> {
  const [row] = await db
    .select({ id: runs.id, expiresAt: runs.expiresAt, night: runs.night, mode: runs.mode, course: runs.course })
    .from(runs)
    .where(and(eq(runs.playerId, playerId), eq(runs.status, "issued")))
    .limit(1);
  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
  // `mode` and `course`: what the run in flight is (a patrol night, a case, the Daily, a trial or a duel).
  return { runId: row.id, expiresAt: row.expiresAt.toISOString(), night: row.night, chapter: isChapterId(row.mode) ? row.mode : null, mode: row.mode, course: row.course };
}

export interface PublicReplay {
  runId: string;
  handle: string;
  nearAccountId: string;
  night: number;
  seed: number;
  ruleset: string;
  /** A story chapter's run: replay it with replayRun(…, { chapter }) from startSave itself (no patrol). */
  chapter: ChapterId | null;
  /**
   * The run's mode ("patrol", a chapter id, "daily" or "trial") and course (the Daily's day, a
   * trial's course, or "duel"). A trial course's run replays with replayRun(…, { trial: course })
   * from startSave itself; the Daily and a duel replay like a patrol night.
   */
  mode: string;
  course: string | null;
  /** The save at run start; replay with startPatrol(startSave, seed) and the log. */
  startSave: Save;
  /** The input log, base64. */
  log: string;
  score: number;
  ticks: number;
  stats: Record<string, number>;
  checkpoints: string[];
  hash: string | null;
  digest: string | null;
  assist: boolean;
  issuedAt: string;
  submittedAt: string | null;
}

/** Everything needed to re-verify a verified run. Other runs aren't public. */
export async function getReplay(db: Db, runId: string): Promise<PublicReplay | null> {
  const [row] = await db
    .select({ run: runs, handle: players.handle, nearAccountId: players.nearAccountId })
    .from(runs)
    .innerJoin(players, eq(players.id, runs.playerId))
    .where(and(eq(runs.id, runId), eq(runs.status, "verified")))
    .limit(1);
  if (!row || !row.run.inputLog) return null;
  const r = row.run;
  return {
    runId: r.id,
    handle: row.handle,
    nearAccountId: row.nearAccountId,
    night: r.night,
    seed: r.seed,
    ruleset: r.ruleset,
    chapter: isChapterId(r.mode) ? r.mode : null,
    mode: r.mode,
    course: r.course,
    startSave: r.startSave as Save,
    log: Buffer.from(r.inputLog!).toString("base64"),
    score: r.verifiedScore ?? 0,
    ticks: r.ticks ?? 0,
    stats: (r.stats as Record<string, number>) ?? {},
    checkpoints: (r.checkpoints as string[]) ?? [],
    hash: r.clientHash,
    digest: r.digest,
    assist: r.assist,
    issuedAt: r.issuedAt.toISOString(),
    submittedAt: r.submittedAt?.toISOString() ?? null,
  };
}
