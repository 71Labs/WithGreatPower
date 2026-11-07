/**
 * GET /api/invite/:code/accept → 302 /play?invited=1 with the `wgp_ref` cookie (30 days,
 * HttpOnly, SameSite=Lax, Secure in production), or 302 /play without it for an unknown code
 * (or a banned player's). The invite landing's "Start playing" links here; the next sign-in that
 * creates a player attaches the code (src/server/auth/referral.ts).
 */
import { refCookieHeader } from "@/server/auth/referral";
import { getDb } from "@/server/db/client";
import { normalizeReferralCode, playerByCode } from "@/server/db/referrals";
import { clientIp, handle } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

const redirect = (location: string, cookie?: string) => {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
};

export const GET = handle("invite/accept", async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  rateLimiter.enforce("invite-ip", clientIp(request), RATE_LIMITS.invitePerIp);
  const { code: raw } = await params;
  const code = normalizeReferralCode(raw);
  const referrer = code ? await playerByCode(await getDb(), code) : null;
  if (!code || !referrer || referrer.bannedAt) return redirect("/play");
  return redirect("/play?invited=1", refCookieHeader(code));
});
