/**
 * The public numbers, counted at most once a minute per server instance: GET /api/stats
 * and the /stats page share this read, so a burst of visitors costs one set of queries.
 * Call it at request time only (after `connection()` in a page): it reads the database.
 */
import { cacheLife } from "next/cache";

import { getDb } from "./client";
import { publicStats, type PublicStats } from "./stats";

/** How long a count is served, in seconds: the cache here and the CDN header on the API. */
export const STATS_CACHE_SECONDS = 60;

export async function cachedPublicStats(): Promise<PublicStats> {
  "use cache";
  cacheLife({ stale: STATS_CACHE_SECONDS, revalidate: STATS_CACHE_SECONDS, expire: 300 });
  return publicStats(await getDb());
}
