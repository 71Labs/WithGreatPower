/**
 * POST /api/actions { action, rev } → 200 { applied, save, rev }
 * Menu actions (create-hero, sleep, vote, pick-power, set-loadout, craft-suit,
 * equip-suit, reset) reduced on the server. 409 rev_conflict { save, rev } when `rev` is
 * stale; 409 run_active while a run is in flight.
 */
import { requireSession } from "@/server/auth/session";
import { actionBody, applyAction } from "@/server/db/actions";
import { getDb } from "@/server/db/client";
import { handle, json, readJson } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const POST = handle("actions", async (request: Request) => {
  const session = await requireSession(request);
  rateLimiter.enforce("actions", session.playerId, RATE_LIMITS.actionsPerPlayer);
  const { action, rev } = await readJson(request, actionBody, 4 * 1024);
  return json(await applyAction(await getDb(), { playerId: session.playerId, action, rev }));
});
