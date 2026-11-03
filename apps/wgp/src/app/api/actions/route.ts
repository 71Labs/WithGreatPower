/**
 * POST /api/actions { action, rev } → 200 { applied, save, rev }
 * Menu actions (create-hero, sleep, vote, pick-power, set-loadout, craft-suit,
 * equip-suit, reset) reduced on the server. 409 rev_conflict { save, rev } when `rev` is
 * stale; 409 run_active while a run is in flight.
 *
 * A new hero is queued for registration on chain (server/near/heroes.ts); the player's
 * session key sends it once quick play is on. Craft and equip here change the save only;
 * with quick play on, the browser sends them through the relayer instead.
 */
import { requireSession } from "@/server/auth/session";
import { actionBody, applyAction } from "@/server/db/actions";
import { getDb } from "@/server/db/client";
import { handle, json, readJson } from "@/server/http";
import { queueHeroRegistration } from "@/server/near/heroes";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const POST = handle("actions", async (request: Request) => {
  const session = await requireSession(request);
  rateLimiter.enforce("actions", session.playerId, RATE_LIMITS.actionsPerPlayer);
  const { action, rev } = await readJson(request, actionBody, 4 * 1024);
  const db = await getDb();
  const result = await applyAction(db, { playerId: session.playerId, action, rev });
  if (result.applied && action.type === "create-hero") {
    // GET /api/chain/status queues it too, so a miss here only delays it.
    await queueHeroRegistration(db, session.player, result.save).catch((error: unknown) => {
      console.error(`[actions] queue register_hero for ${session.playerId}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  return json(result);
});
