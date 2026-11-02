/**
 * POST /api/auth/dev { handle? } → 201 { player }
 * Dev-only sign-in (NODE_ENV ≠ production and ALLOW_DEV_AUTH=1); 404 everywhere else.
 */
import { devAuthEnabled, devLoginBody, findOrCreateDevPlayer } from "@/server/auth/dev";
import { createSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { clientIp, handle, json, notFound, readJson } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const POST = handle("auth/dev", async (request: Request) => {
  if (!devAuthEnabled()) throw notFound();
  rateLimiter.enforce("dev-auth-ip", clientIp(request), RATE_LIMITS.devAuthPerIp);
  const { handle: name } = await readJson(request, devLoginBody, 1024);
  const player = await findOrCreateDevPlayer(await getDb(), name);
  const { expiresAt } = await createSession(player.id, request);
  return json(
    { player: { id: player.id, handle: player.handle, nearAccountId: player.nearAccountId, authKind: player.authKind }, expiresAt: expiresAt.toISOString() },
    { status: 201 },
  );
});
