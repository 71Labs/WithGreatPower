/**
 * The run page's cached read. A verified run is immutable, so it's kept for a day and
 * served stale for a week; a miss (unknown, or not verified yet) is kept a few seconds
 * only, so a run that verifies a moment later gets its page.
 */
import { cacheLife, cacheTag } from "next/cache";

import { getDb } from "../db/client";
import { raceTarget } from "../db/compete";
import { publicRun, type PublicRun } from "./runs";

export const runTag = (runId: string) => `run:${runId}`;

/** The run, read through the cache. Opens the database first, outside the cache scope: PGlite (local dev) can't start inside one. */
export async function loadPublicRun(runId: string): Promise<PublicRun | null> {
  await getDb();
  return cachedPublicRun(runId);
}

async function cachedPublicRun(runId: string): Promise<PublicRun | null> {
  "use cache";
  cacheTag(runTag(runId));
  const run = await publicRun(await getDb(), runId);
  cacheLife(run ? { stale: 3600, revalidate: 86_400, expire: 7 * 86_400 } : { stale: 5, revalidate: 5, expire: 10 });
  return run;
}

/**
 * Whether the run's page can offer "Race this run" (src/server/db/compete.ts raceTarget): a
 * patrol night under the current ruleset, a Daily or a time trial can; a case file or a night
 * from an older ruleset can't. That never changes for a verified run, so it's cached like the run.
 */
export async function loadRunRaceable(runId: string): Promise<boolean> {
  await getDb();
  return cachedRunRaceable(runId);
}

async function cachedRunRaceable(runId: string): Promise<boolean> {
  "use cache";
  cacheTag(runTag(runId));
  cacheLife({ stale: 3600, revalidate: 86_400, expire: 7 * 86_400 });
  return (await raceTarget(await getDb(), runId)) !== null;
}
