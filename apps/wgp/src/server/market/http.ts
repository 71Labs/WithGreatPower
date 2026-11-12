/**
 * Route glue for /api/market: rate limits and error mapping. A rule the market refuses
 * (MarketError) answers 422 with its code ("slippage", "daily_cap", …) and the same words
 * the contract uses; NEAR failures map as the relayer's do; an unreachable RPC is a 503.
 */
import { unstable_rethrow } from "next/navigation";

import { MarketError } from "@/lib/market/engine";

import { HttpError } from "../http";
import { toHttpError } from "../near/http";
import type { RateLimit } from "../rate-limit";

export const MARKET_LIMITS = {
  readPerIp: { limit: 120, windowMs: 60_000 },
  mePerPlayer: { limit: 60, windowMs: 60_000 },
  tradePerPlayer: { limit: 30, windowMs: 60_000 },
  tradePerIp: { limit: 60, windowMs: 60_000 },
  /** POST /api/market/invest: the rules cap a day at a handful of investments anyway. */
  investPerPlayer: { limit: 20, windowMs: 60_000 },
  investPerIp: { limit: 40, windowMs: 60_000 },
  snapshotPerIp: { limit: 10, windowMs: 60_000 },
} satisfies Record<string, RateLimit>;

export function toMarketHttpError(error: unknown): unknown {
  if (error instanceof MarketError) return new HttpError(422, error.code, error.message);
  const mapped = toHttpError(error);
  if (mapped !== error) return mapped;
  if (error instanceof HttpError) return error;
  // The market reads the chain; a failed read is the RPC's trouble, not the caller's.
  if (error instanceof Error && /fetch failed|ECONN|ETIMEDOUT|network|rpc/i.test(error.message)) {
    return new HttpError(503, "market_unavailable", "The market can't reach NEAR right now; try again in a moment");
  }
  return error;
}

/** Runs a market route body, mapping errors. Wrap it in `handle()` from server/http. */
export async function marketRoute(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    unstable_rethrow(error);
    throw toMarketHttpError(error);
  }
}
