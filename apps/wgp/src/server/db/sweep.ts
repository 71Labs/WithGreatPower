/**
 * Housekeeping for GET /api/cron/sweep: expire abandoned runs, put failed or stuck
 * outbox rows back in the queue (sending them is Chain's job), and prune old sessions,
 * sign-in nonces and budget counters.
 */
import { and, eq, lt, lte, sql } from "drizzle-orm";

import { pruneNonces } from "@/server/auth/nonces";
import { pruneBudgets } from "@/server/rate-limit";

import type { Db } from "./client";
import { SUBMIT_GRACE_MS } from "./runs";
import { authSessions, chainOps, runs } from "./schema";

export const OUTBOX_MAX_ATTEMPTS = 8;
/** A row left in "sending" this long is assumed lost by a crashed worker. */
export const OUTBOX_STUCK_MS = 10 * 60_000;
export const BUDGET_KEEP_MS = 7 * 24 * 60 * 60_000;

export interface SweepReport {
  expiredRuns: number;
  requeuedOps: number;
  unstuckOps: number;
  deadOps: number;
  prunedSessions: number;
  prunedNonces: number;
  prunedBudgets: number;
}

export async function sweep(db: Db, now = new Date()): Promise<SweepReport> {
  const expiredRuns = await db
    .update(runs)
    .set({ status: "expired", rejectReason: "timeout" })
    .where(and(eq(runs.status, "issued"), lt(runs.expiresAt, new Date(now.getTime() - SUBMIT_GRACE_MS))))
    .returning({ id: runs.id });

  const deadOps = await db
    .update(chainOps)
    .set({ status: "dead", updatedAt: now })
    .where(and(eq(chainOps.status, "failed"), sql`${chainOps.attempts} >= ${OUTBOX_MAX_ATTEMPTS}`))
    .returning({ id: chainOps.id });

  const requeuedOps = await db
    .update(chainOps)
    .set({ status: "pending", updatedAt: now })
    .where(and(eq(chainOps.status, "failed"), sql`${chainOps.attempts} < ${OUTBOX_MAX_ATTEMPTS}`, lte(chainOps.nextAttemptAt, now)))
    .returning({ id: chainOps.id });

  const unstuckOps = await db
    .update(chainOps)
    .set({ status: "pending", error: "requeued: stuck in sending", updatedAt: now })
    .where(and(eq(chainOps.status, "sending"), lt(chainOps.updatedAt, new Date(now.getTime() - OUTBOX_STUCK_MS))))
    .returning({ id: chainOps.id });

  const prunedSessions = await db.delete(authSessions).where(lt(authSessions.expiresAt, now)).returning({ id: authSessions.idHash });
  const prunedNonces = await pruneNonces(db, now);
  const prunedBudgets = await pruneBudgets(db, new Date(now.getTime() - BUDGET_KEEP_MS));

  return {
    expiredRuns: expiredRuns.length,
    requeuedOps: requeuedOps.length,
    unstuckOps: unstuckOps.length,
    deadOps: deadOps.length,
    prunedSessions: prunedSessions.length,
    prunedNonces,
    prunedBudgets,
  };
}
