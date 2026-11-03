/**
 * Background work without cron jobs. Scheduled functions cost money whether anyone plays or
 * not, so this project has none: each job runs after a player request has been answered
 * (Next's after(), which keeps the function alive past the response), and only when it's
 * due.
 *
 * - Reward mints: after every verified run, and whenever a player reads their chain status
 *   (so failed sends are retried), at most one pass every 15 s.
 * - The sweep (expired runs, stuck outbox rows, old sessions and nonces): at most once
 *   every 10 minutes, on whichever trigger comes first.
 * - Market price snapshots: when the market is read, at most once every 30 minutes;
 *   recordSnapshots also skips prices that haven't moved.
 *
 * Every job is idempotent, and the windows are rows in budget_counters, so they hold
 * across serverless instances. The /api/cron/* routes stay as manual triggers, guarded by
 * CRON_SECRET, but nothing schedules them.
 */
import { after } from "next/server";

import { getDb, type Db } from "@/server/db/client";
import { sweep } from "@/server/db/sweep";
import { recordSnapshots } from "@/server/market/history";
import { marketSource, poolsOf } from "@/server/market/view";
import { chainEnv, operatorEnv } from "@/server/near/env";
import { drainRewards } from "@/server/near/mint-worker";
import { reserveBudget } from "@/server/rate-limit";

export const WINDOWS = {
  mint: 15_000,
  sweep: 10 * 60_000,
  marketSnapshot: 30 * 60_000,
} as const;

export type BackgroundJob = keyof typeof WINDOWS;

/**
 * True for the first caller in each window of `job` (across every instance), false for the
 * rest. A job that fails still used its window; the next window retries it.
 */
export async function claimWindow(db: Db, job: BackgroundJob, now = new Date()): Promise<boolean> {
  const period = String(Math.floor(now.getTime() / WINDOWS[job]));
  const { ok } = await reserveBudget(db, { scope: `background:${job}`, key: "global", period, limit: 1 }, now);
  return ok;
}

/**
 * Runs `work` after the response, once per window of `job`. Failures are logged, never
 * thrown. Outside a request (unit tests, scripts) there's no response to wait for, so
 * nothing is scheduled.
 */
function whenDue(job: BackgroundJob, work: (db: Db) => Promise<unknown>): void {
  const run = async () => {
    try {
      const db = await getDb();
      if (await claimWindow(db, job)) await work(db);
    } catch (error) {
      console.error(`[background] ${job}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    after(run);
  } catch {
    // Not inside a request scope.
  }
}

/** True when the operator can send mints; without it, claiming rows would strand them. */
function canMint(): boolean {
  try {
    chainEnv();
    operatorEnv();
    return true;
  } catch {
    return false;
  }
}

/** Sends queued reward mints (two batches at most) after this request. */
export function sendMintsSoon(): void {
  if (!canMint()) return;
  whenDue("mint", (db) => drainRewards(db, { maxBatches: 2 }));
}

/** Sweeps expired runs, stuck outbox rows and old sessions after this request, when due. */
export function sweepSoon(): void {
  whenDue("sweep", (db) => sweep(db));
}

/** Records market price snapshots after this request, when due. */
export function snapshotMarketSoon(): void {
  whenDue("marketSnapshot", async (db) => {
    const source = await marketSource();
    await recordSnapshots(db, source.onChain, poolsOf(source).pools);
  });
}
