/**
 * The leaderboard as GET /api/leaderboard and the /play/leaderboard page see it: the
 * cached top of the board plus, for a signed-in viewer, their own row and neighbours.
 * A closed season is read from its frozen standings instead of the live board, with
 * where its on-chain record stands (season-view.ts).
 */
import { eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { canMint } from "@/server/background";
import { chainEnv } from "@/server/near/env";
import { isContractMissing, readSeasonOnChain } from "@/server/near/season-record";

import { getDb } from "./client";
import { BOARDS, LEADERBOARD_TAG, aroundPlayer, boardTag, resolvePeriod, type BoardRow } from "./leaderboard";
import { BOARD_PAGE, cachedBoard } from "./leaderboard-cache";
import { recordSeasonKey, type SeasonStanding } from "./season-close";
import { frozenBoard, seasonView, type SeasonView } from "./season-view";
import { chainOps, seasons, type Board } from "./schema";

export type { SeasonView } from "./season-view";

export const leaderboardQuery = z.object({
  board: z.enum(BOARDS).default("tonight"),
  period: z.string().trim().max(32).optional(),
  around: z.literal("me").optional(),
});

export interface LeaderboardView {
  board: Board;
  /** The period shown: a UTC date, a season id or "all"; null when there's no season yet. */
  period: string | null;
  season: SeasonView | null;
  /** Players on this board. */
  total: number;
  /** The top of the board (up to 50), shared and cached. */
  rows: BoardRow[];
  /** The viewer's row, when asked for and they have one. */
  me: BoardRow | null;
  /** The viewer's row with up to two neighbours either side. */
  around: BoardRow[];
  pageSize: number;
  /** The server's clock when it answered, so a countdown doesn't trust the device's. */
  now: string;
}

/** A season row and its `record_season` outbox row, shared by every viewer for ~15 s. */
async function cachedSeason(id: string) {
  "use cache";
  cacheTag(LEADERBOARD_TAG, boardTag("season", id));
  cacheLife({ stale: 15, revalidate: 15, expire: 60 });
  const db = await getDb();
  const [row] = await db.select().from(seasons).where(eq(seasons.id, id)).limit(1);
  if (!row) return null;
  const { standings, ...season } = row;
  const [op] = season.closedAt
    ? await db.select({ status: chainOps.status, error: chainOps.error, txHash: chainOps.txHash }).from(chainOps).where(eq(chainOps.dedupeKey, recordSeasonKey(id))).limit(1)
    : [];
  return { season, op: op ?? null, standings: (standings ?? []) as SeasonStanding[] };
}

/** Whether the game contract answers on NEAR, checked at most every five minutes. Null when the RPC didn't answer. */
async function cachedContractLive(seasonId: string): Promise<boolean | null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 900 });
  try {
    chainEnv();
  } catch {
    return false;
  }
  try {
    await readSeasonOnChain(seasonId);
    return true;
  } catch (error) {
    return isContractMissing(error) ? false : null;
  }
}

export async function loadLeaderboard(input: { board: Board; period?: string | null; viewerId?: string | null; now: Date }): Promise<LeaderboardView> {
  const db = await getDb();
  const period = await resolvePeriod(db, input.board, input.period, input.now);
  const empty: LeaderboardView = { board: input.board, period, season: null, total: 0, rows: [], me: null, around: [], pageSize: BOARD_PAGE, now: input.now.toISOString() };
  if (!period) return empty;

  if (input.board === "season") {
    const [found, contractLive] = await Promise.all([cachedSeason(period), cachedContractLive(period)]);
    if (found) {
      const view = seasonView({ season: found.season, players: found.standings.length, op: found.op, contractLive, canSend: canMint(), now: input.now });
      if (view.phase === "final") return { ...empty, season: view, ...frozenBoard(found.standings, input.viewerId ?? null, BOARD_PAGE) };
      const [top, mine] = await Promise.all([cachedBoard("season", period), input.viewerId ? aroundPlayer(db, "season", period, input.viewerId) : null]);
      return { ...empty, season: view, total: top.total, rows: top.rows, me: mine?.me ?? null, around: mine?.rows ?? [] };
    }
  }

  const [top, mine] = await Promise.all([cachedBoard(input.board, period), input.viewerId ? aroundPlayer(db, input.board, period, input.viewerId) : Promise.resolve(null)]);
  return { ...empty, total: top.total, rows: top.rows, me: mine?.me ?? null, around: mine?.rows ?? [] };
}
