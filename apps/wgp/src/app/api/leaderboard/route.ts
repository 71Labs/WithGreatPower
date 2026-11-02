/**
 * GET /api/leaderboard?board=tonight|season|alltime&period=…&around=me → 200 LeaderboardView
 * (src/server/db/board-view.ts). The top 50 is cached (~15 s, refreshed by verified
 * runs); `around=me` adds the signed-in viewer's row and neighbours, uncached.
 */
import type { NextRequest } from "next/server";

import { getSession } from "@/server/auth/session";
import { leaderboardQuery, loadLeaderboard } from "@/server/db/board-view";
import { badRequest, clientIp, handle, json } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const GET = handle("leaderboard", async (request: NextRequest) => {
  const parsed = leaderboardQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw badRequest("Bad leaderboard query", { issues: parsed.error.issues.map((i) => i.message) });
  rateLimiter.enforce("leaderboard-ip", clientIp(request), RATE_LIMITS.leaderboardPerIp);
  const session = parsed.data.around === "me" ? await getSession(request) : null;
  const view = await loadLeaderboard({ board: parsed.data.board, period: parsed.data.period, viewerId: session?.playerId ?? null, now: new Date() });
  return json({ ...view, signedIn: !!session });
});
