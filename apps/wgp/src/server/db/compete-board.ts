/**
 * The competitive boards as GET /api/leaderboard answers them (the LeaderboardView shape):
 * `board=daily[&period=YYYY-MM-DD]` (today's by default) and `board=trial:<course>` (or
 * `board=trial&period=<course>`). The top is cached like every board (leaderboard-cache.ts,
 * tagged per board and period, refreshed by a verified run); the viewer's row isn't.
 */
import type { LeaderboardView } from "./board-view";
import { getDb } from "./client";
import { aroundPlayer } from "./leaderboard";
import { BOARD_PAGE, cachedBoard } from "./leaderboard-cache";

export async function loadCompeteBoard(input: { board: "daily" | "trial"; period: string; viewerId?: string | null; now: Date }): Promise<LeaderboardView> {
  const db = await getDb();
  const [top, mine] = await Promise.all([cachedBoard(input.board, input.period), input.viewerId ? aroundPlayer(db, input.board, input.period, input.viewerId) : Promise.resolve(null)]);
  return {
    board: input.board,
    period: input.period,
    season: null,
    total: top.total,
    rows: top.rows,
    me: mine?.me ?? null,
    around: mine?.rows ?? [],
    pageSize: BOARD_PAGE,
    now: input.now.toISOString(),
  };
}
