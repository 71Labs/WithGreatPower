/**
 * The three boards, kept as one row per (board, period, player):
 *
 * - Tonight: the best verified run per UTC day (the day the run was issued).
 * - Season: the sum of a player's nightly bests inside the season.
 * - All time: the best single run.
 *
 * Ranking: higher score, then fewer ticks (the faster run), then whoever got there
 * first. Banned players are hidden. Assist runs never reach these tables.
 *
 * Pure data access; the cached reads and tag invalidation live in leaderboard-cache.ts.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { SuitId } from "@wgp/game-core/types";

import { utcDay } from "@/server/rate-limit";

import { queryRows, type Db } from "./client";
import { leaderboardEntries as le, players, saves, type Board } from "./schema";
import { defaultSeason, seasonAt } from "./seasons";

export const BOARDS = ["tonight", "season", "alltime"] as const satisfies readonly Board[];
export const ALLTIME_PERIOD = "all";

/** Every cached board read carries this tag, plus its own board tag. */
export const LEADERBOARD_TAG = "leaderboard";
export const boardTag = (board: Board, period: string) => `leaderboard:${board}:${period}`;

export interface BoardRow {
  rank: number;
  playerId: string;
  handle: string;
  nearAccountId: string;
  heroName: string | null;
  suit: SuitId | null;
  score: number;
  ticks: number;
  runId: string | null;
  /** ISO time the entry last improved. */
  updatedAt: string;
}

const better = (score: number, ticks: number, oldScore: number, oldTicks: number) =>
  score > oldScore || (score === oldScore && ticks < oldTicks);

/**
 * Records a verified run on every board it can improve. Call inside the accept
 * transaction. Returns the tags of the boards that changed.
 */
export async function recordScore(
  tx: Db,
  input: { playerId: string; runId: string; score: number; ticks: number; issuedAt: Date; now: Date },
): Promise<string[]> {
  const { playerId, runId, score, ticks, now } = input;
  const tags: string[] = [];
  const target = [le.board, le.periodKey, le.playerId];

  // Tonight, and the season total that sums nightly bests.
  const day = utcDay(input.issuedAt);
  const [old] = await tx
    .select({ bestScore: le.bestScore, ticks: le.ticks })
    .from(le)
    .where(and(eq(le.board, "tonight"), eq(le.periodKey, day), eq(le.playerId, playerId)))
    .for("update")
    .limit(1);
  if (!old || better(score, ticks, old.bestScore, old.ticks)) {
    await tx
      .insert(le)
      .values({ board: "tonight", periodKey: day, playerId, bestScore: score, ticks, runId, updatedAt: now })
      .onConflictDoUpdate({ target, set: { bestScore: score, ticks, runId, updatedAt: now } });
    tags.push(boardTag("tonight", day));

    const season = await seasonAt(tx, input.issuedAt);
    if (season) {
      const dScore = score - (old?.bestScore ?? 0);
      const dTicks = ticks - (old?.ticks ?? 0);
      await tx
        .insert(le)
        .values({ board: "season", periodKey: season.id, playerId, bestScore: score, ticks, runId, updatedAt: now })
        .onConflictDoUpdate({
          target,
          set: { bestScore: sql`${le.bestScore} + ${dScore}`, ticks: sql`${le.ticks} + ${dTicks}`, runId, updatedAt: now },
        });
      tags.push(boardTag("season", season.id));
    }
  }

  // All time: the best single run.
  const improved = await tx
    .insert(le)
    .values({ board: "alltime", periodKey: ALLTIME_PERIOD, playerId, bestScore: score, ticks, runId, updatedAt: now })
    .onConflictDoUpdate({
      target,
      set: { bestScore: score, ticks, runId, updatedAt: now },
      setWhere: sql`${le.bestScore} < ${score} or (${le.bestScore} = ${score} and ${le.ticks} > ${ticks})`,
    })
    .returning({ playerId: le.playerId });
  if (improved.length > 0) tags.push(boardTag("alltime", ALLTIME_PERIOD));

  return tags;
}

/* ------------------------------------------------------------------ reads */

const rowFields = {
  playerId: le.playerId,
  score: le.bestScore,
  ticks: le.ticks,
  runId: le.runId,
  updatedAt: le.updatedAt,
  handle: players.handle,
  nearAccountId: players.nearAccountId,
  heroName: sql<string | null>`${saves.state} -> 'hero' ->> 'name'`,
  suit: sql<string | null>`${saves.state} -> 'hero' ->> 'suit'`,
};

type RawRow = Awaited<ReturnType<typeof boardQuery>>[number];

const toRow = (r: RawRow, rank: number): BoardRow => ({
  rank,
  playerId: r.playerId,
  handle: r.handle,
  nearAccountId: r.nearAccountId,
  heroName: r.heroName,
  suit: r.suit as SuitId | null,
  score: r.score,
  ticks: r.ticks,
  runId: r.runId,
  updatedAt: new Date(r.updatedAt).toISOString(),
});

function boardQuery(db: Db, board: Board, period: string) {
  return db
    .select(rowFields)
    .from(le)
    .innerJoin(players, eq(players.id, le.playerId))
    .leftJoin(saves, eq(saves.playerId, le.playerId))
    .where(and(eq(le.board, board), eq(le.periodKey, period), isNull(players.bannedAt)))
    .orderBy(desc(le.bestScore), asc(le.ticks), asc(le.updatedAt), asc(le.playerId));
}

/** A page of the board, ranked from `offset + 1`. */
export async function topEntries(db: Db, board: Board, period: string, limit = 50, offset = 0): Promise<BoardRow[]> {
  const rows = await boardQuery(db, board, period).limit(limit).offset(offset);
  return rows.map((r, i) => toRow(r, offset + i + 1));
}

export async function countEntries(db: Db, board: Board, period: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(le)
    .innerJoin(players, eq(players.id, le.playerId))
    .where(and(eq(le.board, board), eq(le.periodKey, period), isNull(players.bannedAt)));
  return Number(row?.n ?? 0);
}

/** A player's rank on a board (1-based), or null if they have no entry. Compared in SQL, so timestamps keep full precision. */
export async function rankOf(db: Db, board: Board, period: string, playerId: string): Promise<number | null> {
  const rows = await queryRows<{ ahead: number }>(
    db,
    sql`
      with me as (
        select e.best_score, e.ticks, e.updated_at, e.player_id
        from ${le} e join ${players} p on p.id = e.player_id
        where e.board = ${board} and e.period_key = ${period} and e.player_id = ${playerId} and p.banned_at is null
      )
      select (
        select count(*)::int
        from ${le} o join ${players} op on op.id = o.player_id
        where o.board = ${board} and o.period_key = ${period} and op.banned_at is null and (
          o.best_score > me.best_score
          or (o.best_score = me.best_score and o.ticks < me.ticks)
          or (o.best_score = me.best_score and o.ticks = me.ticks and o.updated_at < me.updated_at)
          or (o.best_score = me.best_score and o.ticks = me.ticks and o.updated_at = me.updated_at and o.player_id < me.player_id)
        )
      ) as ahead
      from me
    `,
  );
  return rows[0] ? Number(rows[0].ahead) + 1 : null;
}

/** The player's row and up to `radius` neighbours either side, or null if they aren't on the board. */
export async function aroundPlayer(
  db: Db,
  board: Board,
  period: string,
  playerId: string,
  radius = 2,
): Promise<{ me: BoardRow; rows: BoardRow[] } | null> {
  const rank = await rankOf(db, board, period, playerId);
  if (rank === null) return null;
  const offset = Math.max(0, rank - 1 - radius);
  const rows = await topEntries(db, board, period, radius * 2 + 1, offset);
  const me = rows.find((r) => r.playerId === playerId);
  if (!me) return null;
  return { me, rows };
}

/**
 * The period a board query means: a UTC date for Tonight (default today), a season id
 * for Season (default the live or latest season; null if there are none), "all" for All time.
 */
export async function resolvePeriod(db: Db, board: Board, period: string | null | undefined, now: Date): Promise<string | null> {
  if (board === "alltime") return ALLTIME_PERIOD;
  if (board === "tonight") return period && /^\d{4}-\d{2}-\d{2}$/.test(period) && !Number.isNaN(Date.parse(period)) ? period : utcDay(now);
  if (period && /^[a-z0-9-]{1,32}$/.test(period)) return period;
  return (await defaultSeason(db, now))?.id ?? null;
}
