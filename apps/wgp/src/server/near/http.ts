/**
 * Route glue for the NEAR endpoints: error mapping, rate limits and budgets. Burst
 * limits use the shared in-memory limiter; anything that spends NEAR is also capped by
 * a durable Postgres budget (`budget_counters`), so many instances can't overshoot.
 */
import { DelegateDecodeError } from "@/lib/near/delegate-codec";
import type { Db } from "@/server/db/client";
import { HttpError } from "@/server/http";
import { releaseBudget, reserveBudget, utcDay, type RateLimit } from "@/server/rate-limit";

import { NearConfigError } from "./env";
import { HandleError } from "./factory";
import { JwtError } from "./jwt";

export const NEAR_RATE_LIMITS = {
  relayPerAccount: { limit: 30, windowMs: 60_000 },
  relayPerIp: { limit: 60, windowMs: 60_000 },
  relayPerDevice: { limit: 30, windowMs: 60_000 },
  fastAuthPerAccount: { limit: 5, windowMs: 60_000 },
  fastAuthPerIp: { limit: 10, windowMs: 60_000 },
  signInPerIp: { limit: 20, windowMs: 60_000 },
  signUpPerIp: { limit: 3, windowMs: 60 * 60_000 },
  walletPerIp: { limit: 30, windowMs: 60_000 },
  chainStatusPerPlayer: { limit: 30, windowMs: 60_000 },
} satisfies Record<string, RateLimit>;

/** Daily caps, from the environment where it matters. */
export const NEAR_BUDGETS = {
  accountsPerDay: () => Number(process.env.NEAR_DAILY_ACCOUNTS ?? "500"),
  relayCallsPerAccountPerDay: 400,
  fastAuthSignsPerAccountPerDay: 20,
};

/** Turns NEAR-layer errors into HTTP errors with messages fit for callers. */
export function toHttpError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  if (error instanceof NearConfigError) return new HttpError(503, "near_not_configured", "NEAR is not configured on this server");
  if (error instanceof DelegateDecodeError) return new HttpError(400, "bad_delegate", error.message);
  if (error instanceof HandleError) return new HttpError(error.code === "handle_taken" ? 409 : 400, error.code, error.message);
  if (error instanceof JwtError) return new HttpError(401, "bad_token", `NEAR Auth token rejected: ${error.message}`);
  return error;
}

/** Runs a route body, mapping NEAR errors. Wrap it in `handle()` from server/http. */
export async function nearRoute(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    throw toHttpError(error);
  }
}

/** The /lab/near-auth spike may use the NEAR Auth relay without a session: development only. */
export function labMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && env.ALLOW_NEAR_AUTH_LAB === "1";
}

/** A device id the browser sends for per-device limits (random, not identifying). */
export function deviceId(request: Request): string | null {
  const id = request.headers.get("x-wgp-device");
  return id && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

/** Reserves from a daily budget or answers 503/429. Returns a release function for the unused part. */
export async function spend(
  db: Db,
  scope: string,
  key: string,
  limit: number,
  amount: number,
  status: 429 | 503 = 503,
): Promise<(unused: number) => Promise<void>> {
  const period = utcDay(new Date());
  const r = await reserveBudget(db, { scope, key, period, limit, amount });
  if (!r.ok) {
    throw new HttpError(status, "budget_exhausted", status === 503 ? "The relayer is out of budget for today; try again tomorrow" : "Daily limit reached");
  }
  return async (unused: number) => {
    if (unused > 0) await releaseBudget(db, { scope, key, period, amount: Math.min(unused, amount) });
  };
}
