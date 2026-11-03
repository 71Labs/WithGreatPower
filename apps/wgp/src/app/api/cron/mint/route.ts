/**
 * GET /api/cron/mint (Authorization: Bearer $CRON_SECRET) → 200 MintReport
 * Nothing schedules it: mints go out in the background of player requests
 * (src/server/background.ts), and this route is a manual trigger. Sends queued reward mints to the game
 * contract with the operator key, in per-account nonce order and at most 20 per call,
 * and records what the contract said about each (src/server/near/mint-worker.ts).
 * Idempotent: rerunning it, or two runs at once, never mints twice.
 *
 * 401 bad or missing secret · 503 near_not_configured, checked before anything is claimed.
 */
import { getDb } from "@/server/db/client";
import { assertCron, handle, json } from "@/server/http";
import { chainEnv, operatorEnv } from "@/server/near/env";
import { nearRoute } from "@/server/near/http";
import { drainRewards } from "@/server/near/mint-worker";

/** Up to five batches, each one transaction waited on until it executes. */
export const maxDuration = 60;

export const GET = handle("cron/mint", (request: Request) =>
  nearRoute(async () => {
    assertCron(request);
    // Fail closed while the operator key isn't set: claiming first would strand rows in "sending".
    chainEnv();
    operatorEnv();
    return json(await drainRewards(await getDb()));
  }),
);
