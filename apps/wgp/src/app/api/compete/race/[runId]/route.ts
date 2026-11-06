/**
 * GET /api/compete/race/:runId → 200 RaceTarget (src/server/db/compete.ts raceTarget)
 * What a challenge link (/play/compete/race/<runId>) opens for a verified run: today's Daily
 * with it as the ghost ("daily"), its course ("trial"), or a duel on its own night ("duel").
 * 404 for a run that isn't verified or can't be raced (a case file).
 */
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { raceTarget } from "@/server/db/compete";
import { clientIp, handle, json, notFound } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const GET = handle("compete/race", async (request: Request, { params }: { params: Promise<{ runId: string }> }) => {
  rateLimiter.enforce("replay-ip", clientIp(request), RATE_LIMITS.replayReadPerIp);
  const { runId } = await params;
  if (!z.uuid().safeParse(runId).success) throw notFound("No such run");
  const target = await raceTarget(await getDb(), runId);
  if (!target) throw notFound("That run can’t be raced");
  return json(target);
});
