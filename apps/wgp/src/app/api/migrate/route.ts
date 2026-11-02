/**
 * POST /api/migrate { save } → 200 { save, rev, items, trophy }
 * Once per player, onto an empty server save: the local save is rebuilt and capped
 * (src/server/db/migrate-save.ts) and its items queued as a one-time mint.
 * 409 already_migrated | server_save_exists · 422 nothing_to_import.
 */
import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { importLocalSave } from "@/server/db/migrate-save";
import { handle, json, readJson } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

const body = z.object({ save: z.unknown() });

export const POST = handle("migrate", async (request: Request) => {
  const session = await requireSession(request);
  rateLimiter.enforce("migrate", session.playerId, RATE_LIMITS.migratePerPlayer);
  const { save } = await readJson(request, body, 128 * 1024);
  return json(await importLocalSave(await getDb(), { playerId: session.playerId, local: save }));
});
