/**
 * The ranked-run lifecycle: issue a seed, take a submitted input log, replay it, and on
 * success write the save, the boards and the reward mint in one transaction.
 *
 *   start  → runs row "issued" with seed = HMAC(SEED_SECRET, runId), 45 minutes to finish
 *   submit → verified | rejected (reason stored) | expired
 *
 * Idempotent: resubmitting the same log returns the stored outcome; a different log for
 * a finished run is a 409.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";

import { and, eq, lte } from "drizzle-orm";

import type { Save } from "@wgp/game-core/types";

import { nightBits } from "@/lib/market/rewards";
import { secret } from "@/server/auth/secrets";
import { HttpError, conflict, notFound } from "@/server/http";
import { reserveBudget, releaseBudget, utcDay } from "@/server/rate-limit";
import { getVerifier, verifyRun, type Verifier } from "@/server/verify";

import type { Db } from "./client";
import { recordScore } from "./leaderboard";
import { BITS_TOKEN_ID, enqueueRewardMint, lootDiff, withBits, type MintItem } from "./outbox";
import { ensureSave, getPlayer, writeSave } from "./players";
import { chainOps, players, runs, type Run } from "./schema";

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
}

export async function startRun(
  db: Db,
  input: { playerId: string; assist?: boolean; abandon?: boolean; now?: Date; verifier?: Verifier },
): Promise<StartedRun> {
  const now = input.now ?? new Date();
  const verifier = input.verifier ?? getVerifier();
  const { playerId } = input;

  const { save, rev } = await ensureSave(db, playerId);
  if (!save.hero) throw conflict("no_hero", "Create a hero first");
  if (save.nightDone) throw conflict("night_done", "Tonight’s patrol is done; sleep first");
  if (save.patrol) throw conflict("patrol_in_progress", "A patrol is already under way in this save");

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

  const budget = { scope: RUN_BUDGET_SCOPE, key: playerId, period: utcDay(now) };
  const reserved = await reserveBudget(db, { ...budget, limit: RUNS_PER_DAY }, now);
  if (!reserved.ok) {
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const retryAfterSeconds = Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
    throw new HttpError(429, "daily_cap", `That’s ${RUNS_PER_DAY} runs today. The city resets at midnight UTC.`, { limit: RUNS_PER_DAY, retryAfterSeconds });
  }

  const runId = randomUUID();
  const seed = seedFor(runId);
  const expiresAt = new Date(now.getTime() + RUN_TTL_MS);
  const assist = !!input.assist;
  try {
    await db.insert(runs).values({
      id: runId,
      playerId,
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

  return { runId, seed, ruleset: verifier.ruleset, saveRev: rev, night: save.night, expiresAt: expiresAt.toISOString(), assist };
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
    return {
      status: "verified",
      runId: run.id,
      score: run.verifiedScore ?? 0,
      ticks: run.ticks ?? 0,
      digest: run.digest ?? "",
      bits: await mintedBitsFor(db, run.id),
      ranked: !run.assist,
      save,
      rev,
      tags: [],
      idempotent: true,
    };
  }
  return { status: "rejected", runId: run.id, reason: run.rejectReason ?? "rejected", idempotent: true };
}

export async function submitRun(
  db: Db,
  input: { playerId: string; runId: string; log: Uint8Array; clientHash: string; now?: Date; verifier?: Verifier },
): Promise<SubmitResult> {
  const now = input.now ?? new Date();
  const { playerId, log, clientHash } = input;

  const run = await loadRun(db, input.runId);
  if (!run || run.playerId !== playerId) throw notFound("No such run");
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
  const verdict = await verifyRun({ ruleset: run.ruleset, seed: run.seed, startSave, issuedAt: run.issuedAt }, log, clientHash, {
    now,
    verifier: input.verifier,
  });
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

/** The player's run in flight, if any. */
export async function activeRun(db: Db, playerId: string, now = new Date()): Promise<{ runId: string; expiresAt: string; night: number } | null> {
  const [row] = await db
    .select({ id: runs.id, expiresAt: runs.expiresAt, night: runs.night })
    .from(runs)
    .where(and(eq(runs.playerId, playerId), eq(runs.status, "issued")))
    .limit(1);
  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
  return { runId: row.id, expiresAt: row.expiresAt.toISOString(), night: row.night };
}

export interface PublicReplay {
  runId: string;
  handle: string;
  nearAccountId: string;
  night: number;
  seed: number;
  ruleset: string;
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
