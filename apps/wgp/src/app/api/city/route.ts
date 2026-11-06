/**
 * GET /api/city → 200 { signedIn, city: CityRecord | null } (src/server/db/city.ts)
 *
 *   { tasks: { bread?: stage, … }, items: { pixels?: bits, … }, pages: bits, views: bits, xp,
 *     at: { x, y, z, fx, fz } | null, outings, outing?: { id, base } }
 *
 * Signed out: { signedIn: false, city: null } (a guest's city lives in their browser's save).
 * Never cached: every outing changes it.
 */
import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getCity } from "@/server/db/city";
import { clientIp, handle, json } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";

const CITY_READ_PER_IP = { limit: 120, windowMs: 60_000 };

export const GET = handle("city", async (request: Request) => {
  rateLimiter.enforce("city-ip", clientIp(request), CITY_READ_PER_IP);
  const session = await getSession(request);
  if (!session) return json({ signedIn: false, city: null });
  return json({ signedIn: true, city: await getCity(await getDb(), session.playerId) });
});
