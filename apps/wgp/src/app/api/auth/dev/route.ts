/**
 * POST /api/auth/dev { handle? } → 201 { player }
 * GET  /api/auth/dev → 200 { enabled: true }, so the sign-in sheet knows to offer it
 * Dev-only sign-in (NODE_ENV ≠ production and ALLOW_DEV_AUTH=1); 404 everywhere else.
 */
import { devAuthEnabled, devLoginBody, findOrCreateDevPlayer } from "@/server/auth/dev";
import { createSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { clientIp, handle, json, notFound, readJson } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const GET = handle("auth/dev", async (request: Request) => {
  // Reading the request keeps this dynamic: whether dev sign-in is on is decided per request.
  rateLimiter.enforce("dev-auth-probe-ip", clientIp(request), RATE_LIMITS.mePerIp);
  if (!devAuthEnabled()) throw notFound();
  return json({ enabled: true });
});

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
