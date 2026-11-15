/**
 * GET /api/leaderboard?board=tonight|season|alltime&period=…&around=me → 200 LeaderboardView
 * (src/server/db/board-view.ts). The top 50 is cached (~15 s, refreshed by verified
 * runs); `around=me` adds the signed-in viewer's row and neighbours, uncached. A closed
 * season answers its frozen standings and where its on-chain record stands.
 *
 * The competitive boards (src/server/db/compete-board.ts) answer the same shape:
 * `board=daily[&period=YYYY-MM-DD]` (today's Daily by default) and `board=trial:<course>` (or
 * `board=trial&period=<course>`). They never feed Tonight, Season or All time.
 */
import type { NextRequest } from "next/server";

import { closeSeasonsSoon, npcVisitSoon, settleDailiesSoon } from "@/server/background";
import { getSession } from "@/server/auth/session";
import { leaderboardQuery, loadLeaderboard } from "@/server/db/board-view";
import { competeBoard } from "@/server/db/compete";
import { loadCompeteBoard } from "@/server/db/compete-board";
import { badRequest, clientIp, handle, json } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const GET = handle("leaderboard", async (request: NextRequest) => {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const now = new Date();
  const compete = typeof params.board === "string" ? competeBoard(params.board, params.period, now) : null;
  npcVisitSoon();
  if (compete) {
    rateLimiter.enforce("leaderboard-ip", clientIp(request), RATE_LIMITS.leaderboardPerIp);
    if (compete.board === "daily") settleDailiesSoon();
    const session = params.around === "me" ? await getSession(request) : null;
    const view = await loadCompeteBoard({ ...compete, viewerId: session?.playerId ?? null, now });
    return json({ ...view, signedIn: !!session });
  }
  const parsed = leaderboardQuery.safeParse(params);
  if (!parsed.success) throw badRequest("Bad leaderboard query", { issues: parsed.error.issues.map((i) => i.message) });
  rateLimiter.enforce("leaderboard-ip", clientIp(request), RATE_LIMITS.leaderboardPerIp);
  // Players check the board as a season ends: a good moment to close it.
  closeSeasonsSoon();
  const session = parsed.data.around === "me" ? await getSession(request) : null;
  const view = await loadLeaderboard({ board: parsed.data.board, period: parsed.data.period, viewerId: session?.playerId ?? null, now });
  return json({ ...view, signedIn: !!session });
});
