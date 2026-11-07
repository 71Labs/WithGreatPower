/**
 * Two kinds of limit:
 *
 * - Burst guards (`rateLimiter`): fixed windows in memory, per key (player, IP). Each
 *   server instance counts on its own, so on serverless these stop floods, not abuse.
 *   `enforce` is synchronous so routes can call it before any await.
 * - Budgets (`reserveBudget`): durable counters in Postgres (`budget_counters`) for
 *   anything that costs money or real CPU: ranked runs a day, mints, relayed gas. One
 *   atomic upsert, so concurrent requests on different instances can't overshoot.
 */
import { and, eq, lt, sql } from "drizzle-orm";

import type { Db } from "./db/client";
import { budgetCounters } from "./db/schema";
import { HttpError } from "./http";

export interface RateLimit {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

/** Limits per route, per key. */
export const RATE_LIMITS = {
  /** POST /api/runs/start, per player and per IP. The daily cap is a budget, below. */
  runStartPerPlayer: { limit: 6, windowMs: 60_000 },
  runStartPerIp: { limit: 30, windowMs: 60_000 },
  /** POST /api/runs/:id/submit: a replay costs CPU. */
  runSubmitPerPlayer: { limit: 10, windowMs: 60_000 },
  runSubmitPerIp: { limit: 60, windowMs: 60_000 },
  /** GET /api/runs/:id/replay (public). */
  replayReadPerIp: { limit: 60, windowMs: 60_000 },
  /** GET /api/leaderboard (public; the board itself is cached). */
  leaderboardPerIp: { limit: 120, windowMs: 60_000 },
  /** POST /api/actions: menu taps. */
  actionsPerPlayer: { limit: 60, windowMs: 60_000 },
  /** GET /api/me. */
  mePerIp: { limit: 120, windowMs: 60_000 },
  /** GET /api/cases (the case files). */
  casesPerIp: { limit: 120, windowMs: 60_000 },
  /** POST /api/migrate: once per player, so a handful of tries is plenty. */
  migratePerPlayer: { limit: 5, windowMs: 10 * 60_000 },
  /** POST /api/auth/dev. */
  devAuthPerIp: { limit: 20, windowMs: 60_000 },
  /** PUT and DELETE /api/me/social: the player's X handle. */
  socialPerPlayer: { limit: 20, windowMs: 60_000 },
  /** GET /api/social/card/run/:id (public; cached by the CDN once drawn). */
  cardPerIp: { limit: 60, windowMs: 60_000 },
  /** GET /api/referrals: the invite page. */
  referralsPerPlayer: { limit: 60, windowMs: 60_000 },
  /** POST /api/referrals/claim: a code is allowed once, so a few tries is plenty (and codes can't be guessed this way). */
  referralClaimPerPlayer: { limit: 8, windowMs: 10 * 60_000 },
  referralClaimPerIp: { limit: 30, windowMs: 10 * 60_000 },
  /** GET /api/invite/:code and …/accept (public). */
  invitePerIp: { limit: 60, windowMs: 60_000 },
} satisfies Record<string, RateLimit>;

const MAX_KEYS = 50_000;

export class RateLimiter {
  readonly #windows = new Map<string, { start: number; count: number }>();

  /** Counts one request; returns the seconds to wait when over the limit, else 0. */
  hit(bucket: string, key: string, rule: RateLimit, now = Date.now()): number {
    const id = `${bucket}:${key}`;
    let window = this.#windows.get(id);
    if (!window || now - window.start >= rule.windowMs) {
      if (this.#windows.size >= MAX_KEYS) this.#sweep(now, rule.windowMs);
      window = { start: now, count: 0 };
      this.#windows.set(id, window);
    }
    window.count += 1;
    if (window.count > rule.limit) return Math.max(1, Math.ceil((window.start + rule.windowMs - now) / 1000));
    return 0;
  }

  /** Throws a 429 when over the limit. */
  enforce(bucket: string, key: string, rule: RateLimit, now = Date.now()): void {
    const wait = this.hit(bucket, key, rule, now);
    if (wait > 0) throw new HttpError(429, "rate_limited", `Too many requests; retry in ${wait} s`, { retryAfterSeconds: wait });
  }

  reset(): void {
    this.#windows.clear();
  }

  #sweep(now: number, windowMs: number): void {
    for (const [id, window] of this.#windows) if (now - window.start >= windowMs) this.#windows.delete(id);
    if (this.#windows.size >= MAX_KEYS) this.#windows.clear();
  }
}

/** One limiter per server process. */
export const rateLimiter = new RateLimiter();

/* ------------------------------------------------------------------ durable budgets */

/** The UTC calendar day, "YYYY-MM-DD": the period for daily budgets and the Tonight board. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export interface BudgetRequest {
  /** What is being counted ("runs:ranked", "chain:mint", "relay:gas"). */
  scope: string;
  /** Whose budget (a player id, an account, "global"). */
  key: string;
  /** The window, usually utcDay(now). */
  period: string;
  limit: number;
  amount?: number;
}

/**
 * Takes `amount` from a budget if it fits under `limit`, atomically. Returns the new
 * count, or `ok: false` (and changes nothing) when it would go over.
 */
export async function reserveBudget(db: Db, req: BudgetRequest, now = new Date()): Promise<{ ok: boolean; count: number }> {
  const amount = req.amount ?? 1;
  if (amount <= 0) throw new Error("Budget amount must be positive");
  if (amount > req.limit) return { ok: false, count: await budgetUsed(db, req) };
  const [row] = await db
    .insert(budgetCounters)
    .values({ scope: req.scope, key: req.key, period: req.period, count: amount, updatedAt: now })
    .onConflictDoUpdate({
      target: [budgetCounters.scope, budgetCounters.key, budgetCounters.period],
      set: { count: sql`${budgetCounters.count} + excluded.count`, updatedAt: now },
      setWhere: sql`${budgetCounters.count} + excluded.count <= ${req.limit}`,
    })
    .returning({ count: budgetCounters.count });
  if (row) return { ok: true, count: Number(row.count) };
  return { ok: false, count: await budgetUsed(db, req) };
}

/** Gives back what a failed operation reserved. Never goes below zero. */
export async function releaseBudget(db: Db, req: Omit<BudgetRequest, "limit">, now = new Date()): Promise<void> {
  const amount = req.amount ?? 1;
  await db
    .update(budgetCounters)
    .set({ count: sql`greatest(${budgetCounters.count} - ${amount}, 0)`, updatedAt: now })
    .where(and(eq(budgetCounters.scope, req.scope), eq(budgetCounters.key, req.key), eq(budgetCounters.period, req.period)));
}

export async function budgetUsed(db: Db, req: Pick<BudgetRequest, "scope" | "key" | "period">): Promise<number> {
  const [row] = await db
    .select({ count: budgetCounters.count })
    .from(budgetCounters)
    .where(and(eq(budgetCounters.scope, req.scope), eq(budgetCounters.key, req.key), eq(budgetCounters.period, req.period)))
    .limit(1);
  return Number(row?.count ?? 0);
}

/** Deletes counters untouched since `before` (the sweep cron keeps a week). */
export async function pruneBudgets(db: Db, before: Date): Promise<number> {
  const rows = await db.delete(budgetCounters).where(lt(budgetCounters.updatedAt, before)).returning({ scope: budgetCounters.scope });
  return rows.length;
}
