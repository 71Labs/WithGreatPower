/**
 * GET /api/compete/ghosts?mode=daily|trial&course=<id>&ghost=<runId> → 200 { ghosts: GhostEntry[] }
 * (src/server/db/compete.ts ghostsFor): the runs to race as ghosts: the board's top three
 * (today's Daily, or the course's), your own best when signed in, and a chosen run that fits.
 * Each one's replay (seed, start save and log) is GET /api/runs/<runId>/replay.
 */
import { z } from "zod";

import { TRIAL_COURSE_IDS } from "@wgp/game-core/compete";
import type { TrialCourseId } from "@wgp/game-core/types";

import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ghostsFor } from "@/server/db/compete";
import { badRequest, clientIp, handle, json } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

const query = z.object({
  mode: z.enum(["daily", "trial"]),
  course: z.enum(TRIAL_COURSE_IDS as [TrialCourseId, ...TrialCourseId[]]).optional(),
  ghost: z.uuid().optional(),
});

export const GET = handle("compete/ghosts", async (request: Request) => {
  rateLimiter.enforce("compete-ip", clientIp(request), RATE_LIMITS.leaderboardPerIp);
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) throw badRequest("Bad ghost query", { issues: parsed.error.issues.map((i) => i.message) });
  const { mode, course, ghost } = parsed.data;
  if (mode === "trial" && !course) throw badRequest("A trial needs a course");
  const session = await getSession(request);
  const ghosts = await ghostsFor(await getDb(), { mode, course, ghost: ghost ?? null, playerId: session?.playerId ?? null });
  return json({ ghosts });
});
