/**
 * The public numbers, counted at most once a minute per server instance: GET /api/stats
 * and the /stats page share this read, so a burst of visitors costs one set of queries.
 * Call it at request time only (after `connection()` in a page): it reads the database.
 *
 * A count older than a minute is still served, while a fresh one is counted behind it,
 * for up to an hour: a visitor after a quiet spell gets the last numbers at once instead
 * of waiting on the recount. (The page says when its numbers were counted.)
 */
import { cacheLife } from "next/cache";

import { getDb } from "./client";
import { publicStats, type PublicStats } from "./stats";

/** How long a count is served, in seconds: the cache here and the CDN header on the API. */
export const STATS_CACHE_SECONDS = 60;

/** How long a stale count may be served while a new one is counted. */
const STATS_KEEP_SECONDS = 3600;

export async function cachedPublicStats(): Promise<PublicStats> {
  "use cache";
  cacheLife({ stale: STATS_CACHE_SECONDS, revalidate: STATS_CACHE_SECONDS, expire: STATS_KEEP_SECONDS });
  return publicStats(await getDb());
}
