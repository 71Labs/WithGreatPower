/**
 * POST /api/migrate { save } → 200 { save, rev, items, trophy }
 * Once per player, onto an empty server save: the local save is rebuilt and capped
 * (src/server/db/migrate-save.ts) and its items queued as a one-time mint.
 * 409 already_migrated | server_save_exists · 422 nothing_to_import.
 * The imported hero is queued for registration on chain (server/near/heroes.ts).
 */
import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { importLocalSave } from "@/server/db/migrate-save";
import { handle, json, readJson } from "@/server/http";
import { queueHeroRegistration } from "@/server/near/heroes";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

const body = z.object({ save: z.unknown() });

export const POST = handle("migrate", async (request: Request) => {
  const session = await requireSession(request);
  rateLimiter.enforce("migrate", session.playerId, RATE_LIMITS.migratePerPlayer);
  const { save } = await readJson(request, body, 128 * 1024);
  const db = await getDb();
  const result = await importLocalSave(db, { playerId: session.playerId, local: save });
  // GET /api/chain/status queues it too, so a miss here only delays it.
  await queueHeroRegistration(db, session.player, result.save).catch((error: unknown) => {
    console.error(`[migrate] queue register_hero for ${session.playerId}: ${error instanceof Error ? error.message : String(error)}`);
  });
  return json(result);
});
