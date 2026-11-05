/**
 * POST /api/runs/start { assist?, abandon?, chapter? } → 201 { runId, seed, ruleset, saveRev, night, expiresAt, assist, chapter }
 * Signed in. One run in flight (409 run_active with its runId; pass abandon: true to drop
 * it) and 20 runs per UTC day (429 daily_cap).
 *
 * `chapter: "case-001"` starts a story chapter's run instead (Case File 001): any night, its
 * own budget of 30 a day, ruleset "c001-1", unranked and never a Bits mint; the client plays
 * it with startChapterRun(save, seed, chapter).
 */
import { z } from "zod";

import { CHAPTER_IDS } from "@wgp/game-core/chapters";

import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { startRun } from "@/server/db/runs";
import { clientIp, handle, json, readJson } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { sweepSoon } from "@/server/background";

const body = z.object({
  assist: z.boolean().optional(),
  abandon: z.boolean().optional(),
  chapter: z.enum(CHAPTER_IDS as [string, ...string[]]).optional(),
});

export const POST = handle("runs/start", async (request: Request) => {
  rateLimiter.enforce("run-start-ip", clientIp(request), RATE_LIMITS.runStartPerIp);
  const session = await requireSession(request);
  rateLimiter.enforce("run-start", session.playerId, RATE_LIMITS.runStartPerPlayer);
  const { assist, abandon, chapter } = await readJson(request, body, 1024);
  const run = await startRun(await getDb(), { playerId: session.playerId, assist, abandon, chapter: chapter as (typeof CHAPTER_IDS)[number] | undefined });
  sweepSoon();
  return json(run, { status: 201 });
});
