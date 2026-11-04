/**
 * PUT /api/me/social { xHandle: string | null, xTagOk: boolean } → 200 { social }
 * DELETE /api/me/social → 200 { social } (handle removed, tagging off)
 * The signed-in player's X handle (1–15 of A–Z, a–z, 0–9 and _, any leading @ dropped)
 * and whether drafts may tag them. Self-reported and unverified; off by default.
 */
import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { assertJson, handle, json, readJson } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { setXProfile } from "@/server/social/players";

const body = z.object({ xHandle: z.string().max(64).nullable(), xTagOk: z.boolean().default(false) });

export const PUT = handle("me/social", async (request: Request) => {
  const session = await requireSession(request);
  rateLimiter.enforce("me-social", session.playerId, RATE_LIMITS.socialPerPlayer);
  assertJson(request);
  const input = await readJson(request, body, 1024);
  return json({ social: await setXProfile(await getDb(), session.playerId, input) });
});

export const DELETE = handle("me/social", async (request: Request) => {
  const session = await requireSession(request);
  rateLimiter.enforce("me-social", session.playerId, RATE_LIMITS.socialPerPlayer);
  return json({ social: await setXProfile(await getDb(), session.playerId, { xHandle: null, xTagOk: false }) });
});
