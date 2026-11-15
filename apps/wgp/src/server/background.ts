/**
 * Background work without cron jobs. Scheduled functions cost money whether anyone plays or
 * not, so this project has none: each job runs after a player request has been answered
 * (Next's after(), which keeps the function alive past the response), and only when it's
 * due.
 *
 * - Reward mints and season records: after every verified run, and whenever a player
 *   reads their chain status (so failed sends are retried), at most one pass every 15 s.
 * - The sweep (expired runs, stuck outbox rows, old sessions and nonces): at most once
 *   every 10 minutes, on whichever trigger comes first.
 * - Market price snapshots: when the market is read, at most once every 30 minutes;
 *   recordSnapshots also skips prices that haven't moved.
 * - Seasons (src/server/db/season-close.ts): every trigger above, plus leaderboard and
 *   season reads, may run the season pass, at most once a minute and only once a start
 *   or a freeze is due. The first one after a season's freeze time closes it.
 * - Social drafts (src/server/social/queue.ts): after a verified ranked run, at most once
 *   every 2 minutes; an admin opening the queue also drafts, in its own request. Drafts
 *   only: nothing is ever posted from the server.
 * - The Daily Run's badges (src/server/db/compete.ts settleDailies): when the Compete hub or a
 *   Daily board is read, at most once every 10 minutes; a finished day's top three are queued
 *   their badges once (idempotent by outbox key), then sent with the mints.
 * - Referrals (src/server/db/referrals.ts): after a run is submitted, an X handle is saved or an
 *   invite code is claimed, the player's referrer (or the named referrer) is counted again and
 *   granted the "Invite 3 friends" reward once they reach it. Per player, so every trigger
 *   runs (no window); the grant is idempotent by its table's primary key.
 * - Sandwich Man, the market's NPC trader (src/server/npc/runner.ts): takes one look at the
 *   market after a player's trade or listing lands, and when the market is read, at most
 *   once every 5 minutes. Any visit to a busy route (/api/stats, the leaderboards, seasons,
 *   /api/me, /api/market/*) also gives him a turn if his last one started 15 minutes ago or
 *   more: with no visitors there is no turn; with visitors he takes at most one turn every
 *   15 minutes this way, still capped at 10 actions a day. A look is at most one action; his
 *   own lock keeps looks at least 20 seconds apart and never overlapping.
 *
 * Every job is idempotent, and the windows are rows in budget_counters, so they hold
 * across serverless instances. The /api/cron/* routes stay as manual triggers, guarded by
 * CRON_SECRET, but nothing schedules them.
 */
import { after } from "next/server";

import { getDb, type Db } from "@/server/db/client";
import { settleDailies } from "@/server/db/compete";
import { evaluateReferrals } from "@/server/db/referrals";
import { runSeasonPass } from "@/server/db/season-close";
import { sweep } from "@/server/db/sweep";
import { recordSnapshots } from "@/server/market/history";
import { marketSource, poolsOf } from "@/server/market/view";
import { chainEnv, operatorEnv } from "@/server/near/env";
import { drainRewards } from "@/server/near/mint-worker";
import { runNpcTrader } from "@/server/npc/runner";
import { sendSeasonRecords } from "@/server/near/season-record";
import { reserveBudget } from "@/server/rate-limit";
import { syncDrafts } from "@/server/social/queue";

export const WINDOWS = {
  mint: 15_000,
  sweep: 10 * 60_000,
  marketSnapshot: 30 * 60_000,
  seasons: 60_000,
  social: 2 * 60_000,
  dailies: 10 * 60_000,
  npcTrader: 5 * 60_000,
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

/** Runs `work` after the response, every time (per-player work with no shared window). Failures are logged, never thrown. */
function afterResponse(job: string, work: (db: Db) => Promise<unknown>): void {
  const run = async () => {
    try {
      await work(await getDb());
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

/** True when the operator can send mints and season records; without it, claiming rows would strand them. */
export function canMint(): boolean {
  try {
    chainEnv();
    operatorEnv();
    return true;
  } catch {
    return false;
  }
}

/** Sends queued reward mints (two batches at most), then any due season record, after this request. */
export function sendMintsSoon(): void {
  closeSeasonsSoon();
  if (!canMint()) return;
  whenDue("mint", async (db) => {
    await drainRewards(db, { maxBatches: 2 });
    await sendSeasonRecords(db, { limit: 1 });
  });
}

/** Sweeps expired runs, stuck outbox rows and old sessions after this request, when due. */
export function sweepSoon(): void {
  closeSeasonsSoon();
  whenDue("sweep", (db) => sweep(db));
}

/** Records market price snapshots after this request, when due. */
export function snapshotMarketSoon(): void {
  closeSeasonsSoon();
  whenDue("marketSnapshot", async (db) => {
    const source = await marketSource();
    await recordSnapshots(db, source.onChain, poolsOf(source).pools);
  });
}

/** Drafts any social posts the last run made true (a new #1, last night's top 3), after this request, when due. */
export function draftSocialSoon(): void {
  whenDue("social", async (db) => {
    const report = await syncDrafts(db);
    for (const e of report.errors) console.error(`[background] social: ${e}`);
  });
}

/** Queues the badges of any finished Daily Run's top three after this request, when due, and sends them if it can. */
export function settleDailiesSoon(): void {
  whenDue("dailies", async (db) => {
    const queued = await settleDailies(db);
    if (queued.length > 0 && canMint()) await drainRewards(db, { maxBatches: 1 });
  });
}

/**
 * Counts referrals again after this request (src/server/db/referrals.ts `evaluateReferrals`):
 * `friend` may now count (a verified run, an X handle saved), so their referrer is evaluated;
 * `referrer` is evaluated as is (a claim named them, or their own run ended, which frees a
 * grant held back while it was in flight). A grant's Recruiter badge is sent straight away if
 * it can be.
 */
export function checkReferralsSoon(input: { friend?: string; referrer?: string }): void {
  if (!input.friend && !input.referrer) return;
  afterResponse("referrals", async (db) => {
    const granted = await evaluateReferrals(db, input);
    if (granted && canMint()) await drainRewards(db, { maxBatches: 1 });
  });
}

/**
 * Lets Sandwich Man take one look at the market after this request (at most one action).
 * "activity": a player's trade or listing just landed, so he looks now. "read": someone
 * opened the market, so he looks if he hasn't in five minutes. Off on chain unless his
 * account is configured; the runner's own lock makes extra calls harmless.
 */
export function npcTraderSoon(trigger: "activity" | "read"): void {
  if (trigger === "read") whenDue("npcTrader", (db) => runNpcTrader(db));
  else afterResponse("npcTrader", (db) => runNpcTrader(db));
}

/** A visit gives Sandwich Man a turn when his last one started at least this long ago. */
export const NPC_VISIT_GAP_MS = 15 * 60_000;
/** Per instance: after a visit asked for a turn, the next visit on this instance asks again only after this long. */
export const NPC_VISIT_RECHECK_MS = 60_000;

const npcVisitClock: { nextAt: number } = ((globalThis as typeof globalThis & { __wgpNpcVisitClock?: { nextAt: number } }).__wgpNpcVisitClock ??= {
  nextAt: 0,
});

/**
 * One visit's turn for Sandwich Man: a look at the market if his last one, whatever
 * triggered it, started at least NPC_VISIT_GAP_MS ago. The gap is checked by his lock
 * (src/server/npc/store.ts `claimRun`, a row lock in one transaction), so visits arriving
 * together on several instances still give one turn. His caps don't change: at most one
 * action a look, 10 a UTC day, 10 LLM calls a UTC day.
 */
export function npcVisitTurn(db: Db, now = new Date()) {
  return runNpcTrader(db, { now, minGapMs: NPC_VISIT_GAP_MS });
}

/**
 * Lets any visit give Sandwich Man a turn, after the response: call it from a busy route.
 * Most calls cost nothing: an instance asks at most once every NPC_VISIT_RECHECK_MS, and
 * the turn itself happens only if 15 minutes have passed since his last one. No visitors,
 * no turn: nothing is scheduled.
 */
export function npcVisitSoon(now = Date.now()): void {
  if (now < npcVisitClock.nextAt) return;
  npcVisitClock.nextAt = now + NPC_VISIT_RECHECK_MS;
  afterResponse("npcVisit", (db) => npcVisitTurn(db));
}

/** Seasons are dated weeks ahead; with nothing due, an instance looks again after this long at most. */
const SEASON_RECHECK_MS = 10 * 60_000;

/**
 * Per instance: no season pass before this time. Each pass moves it to the next start or
 * freeze, so between those moments a request costs nothing, not even the window claim.
 */
const seasonClock: { nextAt: number } = ((globalThis as typeof globalThis & { __wgpSeasonClock?: { nextAt: number } }).__wgpSeasonClock ??= {
  nextAt: 0,
});

/**
 * Opens started seasons and closes ended ones after this request, when one is due (see
 * season-close.ts). A close that queued a record sends it straight away if it can.
 */
export function closeSeasonsSoon(now = Date.now()): void {
  if (now < seasonClock.nextAt) return;
  seasonClock.nextAt = now + WINDOWS.seasons;
  whenDue("seasons", async (db) => {
    const pass = await runSeasonPass(db);
    const next = Math.min(pass.nextDueAt?.getTime() ?? Number.POSITIVE_INFINITY, Date.now() + SEASON_RECHECK_MS);
    seasonClock.nextAt = Math.max(seasonClock.nextAt, next);
    if (pass.closed.some((c) => c.queued) && canMint()) await sendSeasonRecords(db, { limit: 1 });
  });
}
