/**
 * The leaderboard as GET /api/leaderboard and the /play/leaderboard page see it: the
 * cached top of the board plus, for a signed-in viewer, their own row and neighbours.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "./client";
import { BOARDS, aroundPlayer, resolvePeriod, type BoardRow } from "./leaderboard";
import { BOARD_PAGE, cachedBoard } from "./leaderboard-cache";
import { seasons, type Board } from "./schema";

export const leaderboardQuery = z.object({
  board: z.enum(BOARDS).default("tonight"),
  period: z.string().trim().max(32).optional(),
  around: z.literal("me").optional(),
});

export interface LeaderboardView {
  board: Board;
  /** The period shown: a UTC date, a season id or "all"; null when there's no season yet. */
  period: string | null;
  season: { id: string; name: string; startsAt: string; endsAt: string; phase: "upcoming" | "live" | "ended" } | null;
  /** Players on this board. */
  total: number;
  /** The top of the board (up to 50), shared and cached. */
  rows: BoardRow[];
  /** The viewer's row, when asked for and they have one. */
  me: BoardRow | null;
  /** The viewer's row with up to two neighbours either side. */
  around: BoardRow[];
  pageSize: number;
}

export async function loadLeaderboard(input: { board: Board; period?: string | null; viewerId?: string | null; now: Date }): Promise<LeaderboardView> {
  const db = await getDb();
  const period = await resolvePeriod(db, input.board, input.period, input.now);
  const empty: LeaderboardView = { board: input.board, period, season: null, total: 0, rows: [], me: null, around: [], pageSize: BOARD_PAGE };
  if (!period) return empty;

  const [top, mine, season] = await Promise.all([
    cachedBoard(input.board, period),
    input.viewerId ? aroundPlayer(db, input.board, period, input.viewerId) : Promise.resolve(null),
    input.board === "season" ? db.select().from(seasons).where(eq(seasons.id, period)).limit(1) : Promise.resolve([]),
  ]);
  const s = season[0];
  return {
    ...empty,
    season: s
      ? {
          id: s.id,
          name: s.name,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          phase: input.now < s.startsAt ? "upcoming" : input.now < s.endsAt ? "live" : "ended",
        }
      : null,
    total: top.total,
    rows: top.rows,
    me: mine?.me ?? null,
    around: mine?.rows ?? [],
  };
}
