/**
 * POST /api/runs/start { assist?, abandon? } → 201 { runId, seed, ruleset, saveRev, night, expiresAt, assist }
 * Signed in. One run in flight (409 run_active with its runId; pass abandon: true to drop
 * it) and 20 runs per UTC day (429 daily_cap).
 */
import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { startRun } from "@/server/db/runs";
import { clientIp, handle, json, readJson } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { sweepSoon } from "@/server/background";

const body = z.object({ assist: z.boolean().optional(), abandon: z.boolean().optional() });

export const POST = handle("runs/start", async (request: Request) => {
  rateLimiter.enforce("run-start-ip", clientIp(request), RATE_LIMITS.runStartPerIp);
  const session = await requireSession(request);
  rateLimiter.enforce("run-start", session.playerId, RATE_LIMITS.runStartPerPlayer);
  const { assist, abandon } = await readJson(request, body, 1024);
  const run = await startRun(await getDb(), { playerId: session.playerId, assist, abandon });
  sweepSoon();
  return json(run, { status: 201 });
});
