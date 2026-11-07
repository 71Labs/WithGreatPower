/**
 * GET /api/referrals → 200 { code, link, goal, qualified, invited, reward, referredBy, canClaim }
 *   401 signed out · 403 banned
 * The signed-in player's "Invite 3 friends" page (src/server/db/referrals.ts `ReferralView`):
 * their invite code (made on the first read) and link, each invited friend by game handle with
 * their steps (x, played, qualified), the reward (locked | queued | minted, or granted), who
 * invited them and whether they can still add an inviter. `link` uses this request's origin.
 * Reaching 3 qualified friends grants the reward here as well as in the background.
 */
import { requireSession } from "@/server/auth/session";
import { sendMintsSoon } from "@/server/background";
import { getDb } from "@/server/db/client";
import { inviteOrigin, referralView } from "@/server/db/referrals";
import { handle, json } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const GET = handle("referrals", async (request: Request) => {
  const session = await requireSession(request);
  rateLimiter.enforce("referrals", session.playerId, RATE_LIMITS.referralsPerPlayer);
  const { view, granted } = await referralView(await getDb(), session.playerId, { origin: inviteOrigin(request) });
  // A grant here queued the badge: send it now rather than after the next run.
  if (granted) sendMintsSoon();
  return json(view);
});
