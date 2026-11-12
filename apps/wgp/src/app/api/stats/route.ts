/**
 * GET /api/stats → 200 PublicStats (src/server/db/stats.ts)
 * Public, cached for a minute. The game's numbers as counts only: matches by status and
 * mode, players, City outings, referrals and reward mints. Never a handle, an account, an
 * email or a run id. The /stats page draws exactly this, and `node scripts/stats.mjs`
 * prints it next to the contract's calls counted from NearBlocks.
 */
import { cachedPublicStats, STATS_CACHE_SECONDS } from "@/server/db/stats-cache";
import { clientIp, handle, json } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const GET = handle("stats", async (request: Request) => {
  rateLimiter.enforce("stats-ip", clientIp(request), RATE_LIMITS.statsPerIp);
  return json(await cachedPublicStats(), { cacheSeconds: STATS_CACHE_SECONDS });
});
