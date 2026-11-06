/**
 * GET /api/compete → 200 CompeteView (src/server/db/compete.ts): the Compete hub.
 *
 *   { now, signedIn,
 *     daily: { day, resetsAt, kit, seed, attempts: { used, limit }, best, total, streak, podiums, wins, badges, top },
 *     trials: [{ id, best: { ticks, medal, runId, rank } | null, record, total }],
 *     rivals: [{ ghostRunId, handle, heroName, kind, course, theirs, yours, won, races, at }],
 *     races: { used, limit }, active }
 *
 * Public (a guest sees the boards, the day's kit and its seed, to race the Daily unranked);
 * signed in adds your attempts, best, streak, podiums, badges and rivals. Never cached: a
 * verified run changes it. Reading it settles any finished Daily's badges in the background.
 */
import { getSession } from "@/server/auth/session";
import { settleDailiesSoon } from "@/server/background";
import { getDb } from "@/server/db/client";
import { competeView } from "@/server/db/compete";
import { clientIp, handle, json } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const GET = handle("compete", async (request: Request) => {
  rateLimiter.enforce("compete-ip", clientIp(request), RATE_LIMITS.leaderboardPerIp);
  const session = await getSession(request);
  const view = await competeView(await getDb(), session?.playerId ?? null);
  settleDailiesSoon();
  return json(view);
});
