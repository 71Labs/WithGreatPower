/**
 * GET /api/cron/sweep (Authorization: Bearer $CRON_SECRET) → 200 SweepReport
 * Nothing schedules it: the sweep runs in the background of player requests at most every
 * 10 minutes (src/server/background.ts), and this route is a manual trigger. Expires abandoned runs, re-queues
 * failed or stuck outbox rows (GET /api/cron/mint sends them), prunes expired sessions
 * and sign-in nonces, and old budget counters.
 */
import { getDb } from "@/server/db/client";
import { sweep } from "@/server/db/sweep";
import { assertCron, handle, json } from "@/server/http";

export const GET = handle("cron/sweep", async (request: Request) => {
  assertCron(request);
  return json(await sweep(await getDb()));
});
