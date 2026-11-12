/**
 * Price history (`market_prices`): written by the trade path (every relayed or simulated
 * trade and fill) and by snapshots (the cron hook, /api/cron/market-snapshot), read back
 * as sparklines and 24-hour changes. Snapshots skip a pool whose last row is recent and
 * at the same price, so an idle market doesn't grow the table.
 */
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";

import { spotMilli, type Pool } from "@/lib/market/math";
import { sparkSteps, type SparkStep } from "@/lib/market/spark";

import type { Db } from "../db/client";
import { marketPrices } from "../db/schema";

export const DAY_MS = 86_400_000;
/** A snapshot is skipped when the pool's last row is younger than this and unchanged. */
export const SNAPSHOT_EVERY_MS = 60 * 60_000;
/** Points a sparkline carries at most. */
export const SPARK_POINTS = 24;

export interface TradeRow {
  item: string;
  kind: "trade" | "fill";
  onChain: boolean;
  /** The pool after the trade. */
  pool: Pool;
  side: "buy" | "sell" | "fill";
  amount: number;
  bits: number;
  fee: number;
  accountId: string;
  txHash?: string | null;
  /** A fill's price per item × 1000 (the vendor's spot price is unchanged by fills). */
  priceMilli?: number;
}

export async function recordTrade(db: Db, row: TradeRow, now = new Date()): Promise<void> {
  await db.insert(marketPrices).values({
    item: row.item,
    at: now,
    kind: row.kind,
    onChain: row.onChain,
    priceMilli: row.priceMilli ?? spotMilli(row.pool),
    stock: row.pool.stock,
    till: row.pool.bits,
    side: row.side,
    amount: row.amount,
    bits: row.bits,
    fee: row.fee,
    accountId: row.accountId,
    txHash: row.txHash ?? null,
  });
}

export interface StakeRow {
  item: string;
  onChain: boolean;
  /** The pool after the move. */
  pool: Pool;
  side: "invest" | "withdraw" | "claim";
  /** Bits invested or withdrawn (0 for a claim). */
  bits: number;
  /** Fee earnings paid to the investor by the move. */
  earned: number;
  accountId: string;
  txHash?: string | null;
}

/**
 * An investment, withdrawal or claim (contract v3's `market_invest`, `market_withdraw`,
 * `market_claim`, or the simulated market's). Kind "stake": it moves no price, so it never
 * counts as a trade (the daily quest and the 24-hour trade count read "trade" and "fill"
 * only), but the row's `till` is how a chart shows a till being funded. `fee` carries the
 * fee earnings paid out.
 */
export async function recordStake(db: Db, row: StakeRow, now = new Date()): Promise<void> {
  await db.insert(marketPrices).values({
    item: row.item,
    at: now,
    kind: "stake",
    onChain: row.onChain,
    priceMilli: spotMilli(row.pool),
    stock: row.pool.stock,
    till: row.pool.bits,
    side: row.side,
    amount: 0,
    bits: row.bits,
    fee: row.earned,
    accountId: row.accountId,
    txHash: row.txHash ?? null,
  });
}

/** Writes a snapshot row for each pool whose price moved or whose last row is old. Returns how many. */
export async function recordSnapshots(db: Db, onChain: boolean, pools: Pool[], now = new Date()): Promise<number> {
  let written = 0;
  for (const pool of pools) {
    const price = spotMilli(pool);
    const [last] = await db
      .select({ at: marketPrices.at, priceMilli: marketPrices.priceMilli })
      .from(marketPrices)
      .where(and(eq(marketPrices.item, pool.item), eq(marketPrices.onChain, onChain), sql`${marketPrices.kind} <> 'fill'`))
      .orderBy(desc(marketPrices.at))
      .limit(1);
    if (last && last.priceMilli === price && now.getTime() - last.at.getTime() < SNAPSHOT_EVERY_MS) continue;
    await db.insert(marketPrices).values({ item: pool.item, at: now, kind: "snapshot", onChain, priceMilli: price, stock: pool.stock, till: pool.bits });
    written += 1;
  }
  return written;
}

export interface PriceStats {
  /** Spot × 1000, oldest first, ending at the current price: one point per row, evenly spaced (no times). */
  spark: number[];
  /** The same day as steps at their real times (src/lib/market/spark.ts): what the market's sparklines draw. */
  steps: SparkStep[];
  /** Fractional change over the last 24 hours (0.12 = +12%), or null without history. */
  change24h: number | null;
  /** Trades and fills in the last 24 hours. */
  trades24h: number;
}

/** Evenly thins `points` to at most `max`, keeping the first and last. Pure. */
export function thin(points: number[], max = SPARK_POINTS): number[] {
  if (points.length <= max) return points;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]!);
  return out;
}

/**
 * Sparklines and 24-hour changes for `pools` (current state), from the rows of the last
 * day plus the last row before it as the opening price. `window` is the day the rows
 * cover (epoch ms); it defaults to the 24 hours ending at the newest row. Pure over the
 * rows given.
 */
export function priceStats(
  pools: Pool[],
  rows: { item: string; kind: string; priceMilli: number; at: Date }[],
  opening: Map<string, number>,
  window?: { from: number; to: number },
): Map<string, PriceStats> {
  const newest = rows.reduce((t, r) => Math.max(t, r.at.getTime()), 0);
  const span = window ?? { from: newest - DAY_MS, to: newest };
  const out = new Map<string, PriceStats>();
  for (const pool of pools) {
    const now = spotMilli(pool);
    const mine = rows.filter((r) => r.item === pool.item);
    const curve = mine.filter((r) => r.kind !== "fill").map((r) => r.priceMilli);
    const open = opening.get(pool.item) ?? curve[0];
    const points = thin([...(open !== undefined ? [open] : []), ...curve, now]);
    out.set(pool.item, {
      spark: points.length > 1 ? points : [now, now],
      steps: sparkSteps(mine, opening.get(pool.item), now, span),
      change24h: open !== undefined && open > 0 ? (now - open) / open : null,
      // Trades and fills only: a snapshot or an investment moves no price.
      trades24h: mine.filter((r) => r.kind === "trade" || r.kind === "fill").length,
    });
  }
  return out;
}

/** The last day of rows, and each item's last price before it. */
export async function loadHistory(db: Db, onChain: boolean, now = new Date()) {
  const since = new Date(now.getTime() - DAY_MS);
  const rows = await db
    .select({ item: marketPrices.item, kind: marketPrices.kind, priceMilli: marketPrices.priceMilli, at: marketPrices.at })
    .from(marketPrices)
    .where(and(eq(marketPrices.onChain, onChain), gte(marketPrices.at, since)))
    .orderBy(asc(marketPrices.at))
    .limit(5_000);
  const before = await db
    .selectDistinctOn([marketPrices.item], { item: marketPrices.item, priceMilli: marketPrices.priceMilli })
    .from(marketPrices)
    .where(and(eq(marketPrices.onChain, onChain), lt(marketPrices.at, since), sql`${marketPrices.kind} <> 'fill'`))
    .orderBy(marketPrices.item, desc(marketPrices.at));
  return { rows, opening: new Map(before.map((b) => [b.item, b.priceMilli])), window: { from: since.getTime(), to: now.getTime() } };
}
