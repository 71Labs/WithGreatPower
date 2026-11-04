/**
 * The run page's cached read. A verified run is immutable, so it's kept for a day and
 * served stale for a week; a miss (unknown, or not verified yet) is kept a few seconds
 * only, so a run that verifies a moment later gets its page.
 */
import { cacheLife, cacheTag } from "next/cache";

import { getDb } from "../db/client";
import { publicRun, type PublicRun } from "./runs";

export const runTag = (runId: string) => `run:${runId}`;

export async function cachedPublicRun(runId: string): Promise<PublicRun | null> {
  "use cache";
  cacheTag(runTag(runId));
  const run = await publicRun(await getDb(), runId);
  cacheLife(run ? { stale: 3600, revalidate: 86_400, expire: 7 * 86_400 } : { stale: 5, revalidate: 5, expire: 10 });
  return run;
}
