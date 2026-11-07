/**
 * POST /api/referrals/claim { code } → 200 { referredBy: handle }
 *   409 already_referred · 422 bad_code | self | too_late | cycle · 401 signed out · 429 rate_limited
 * A late claim: a player who signed up without the invite link adds who invited them, once, in
 * their first 48 hours (src/server/db/referrals.ts `claimReferral`). Their inviter is counted
 * again straight after.
 */
import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { checkReferralsSoon } from "@/server/background";
import { getDb } from "@/server/db/client";
import { claimReferral } from "@/server/db/referrals";
import { assertJson, clientIp, handle, json, readJson } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

const body = z.object({ code: z.string().max(32) });

export const POST = handle("referrals/claim", async (request: Request) => {
  rateLimiter.enforce("referral-claim-ip", clientIp(request), RATE_LIMITS.referralClaimPerIp);
  const session = await requireSession(request);
  rateLimiter.enforce("referral-claim", session.playerId, RATE_LIMITS.referralClaimPerPlayer);
  assertJson(request);
  const { code } = await readJson(request, body, 1024);
  const claimed = await claimReferral(await getDb(), { playerId: session.playerId, code });
  checkReferralsSoon({ referrer: claimed.referrerId });
  return json({ referredBy: claimed.handle });
});
