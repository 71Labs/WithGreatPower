/**
 * GET /api/invite/:code → 200 { valid, referrer: { handle, heroName, suit } | null }
 * Public, cached for a minute. Who an invite link is from, for the landing page
 * (/invite/:code) and its card: their game handle and, if they made one, their hero's name and
 * suit. An unknown code, or a banned player's, answers { valid: false, referrer: null }.
 */
import { getDb } from "@/server/db/client";
import { inviteView } from "@/server/db/referrals";
import { clientIp, handle, json } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const GET = handle("invite", async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  rateLimiter.enforce("invite-ip", clientIp(request), RATE_LIMITS.invitePerIp);
  const { code } = await params;
  return json(await inviteView(await getDb(), code), { cacheSeconds: 60 });
});
