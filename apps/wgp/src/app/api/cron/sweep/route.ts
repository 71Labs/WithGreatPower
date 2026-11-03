/**
 * GET /api/cron/sweep (Authorization: Bearer $CRON_SECRET) → 200 SweepReport
 * Vercel Cron calls it every 10 minutes (vercel.json). Expires abandoned runs, re-queues
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
