/**
 * The sign-in side of referrals (docs/referrals.md).
 *
 * GET /api/invite/:code/accept sets the `wgp_ref` cookie (HttpOnly, 30 days). Every sign-in
 * route (privy, wallet, near-auth, dev) then calls `attachInviteOnSignIn` once it has its
 * player: the cookie's code, else the `ref` the browser sent in the body (its copy from
 * localStorage, in case the cookie was lost), is attached only when that request created the
 * player (src/server/db/referrals.ts `attachReferral`). A finished sign-in drops the cookie:
 * the code either attached, or it never can for this browser's account.
 */
import { cookies } from "next/headers";
import { z } from "zod";

import type { Db } from "@/server/db/client";
import { attachReferral, normalizeReferralCode, type AttachOutcome } from "@/server/db/referrals";

export const REF_COOKIE = "wgp_ref";
/** 30 days, in seconds. */
export const REF_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** The optional `ref` every sign-in body takes. Never validated as a code here: a bad one must not block a sign-in. */
export const refField = z.string().max(64).nullish();

const secure = (env: Record<string, string | undefined>) => env.NODE_ENV === "production";

/** The Set-Cookie value for an accepted invite (a normalized code). */
export function refCookieHeader(code: string, env: Record<string, string | undefined> = process.env): string {
  return [`${REF_COOKIE}=${code}`, `Max-Age=${REF_COOKIE_MAX_AGE}`, "Path=/", "SameSite=Lax", "HttpOnly", ...(secure(env) ? ["Secure"] : [])].join("; ");
}

/** The `wgp_ref` cookie's value from a request, or null. */
export function readRefCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== REF_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function clearRefCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(REF_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: secure(process.env), path: "/", maxAge: 0 });
}

/**
 * Call once a sign-in has its (unbanned) player. Attaches the invite to a player this request
 * created (`created`), tries the cookie's code, then the body's, and drops the cookie. Never
 * throws: a sign-in never fails over an invite. Null when there was no code at all.
 */
export async function attachInviteOnSignIn(
  db: Db,
  request: Request,
  input: { playerId: string; created: boolean; ref?: string | null; now?: Date },
): Promise<AttachOutcome | null> {
  const cookie = readRefCookie(request);
  const codes = [...new Set([cookie, input.ref].map(normalizeReferralCode).filter((c): c is string => c !== null))];
  if (!cookie && !input.ref) return null;
  let outcome: AttachOutcome = { attached: false, reason: input.created ? "bad_code" : "not_new" };
  try {
    for (const code of codes) {
      outcome = await attachReferral(db, { playerId: input.playerId, code, created: input.created, now: input.now });
      if (outcome.attached || outcome.reason !== "bad_code") break;
    }
  } catch (error) {
    console.error(`[referral] attach for ${input.playerId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (cookie) {
    try {
      await clearRefCookie();
    } catch {
      // Outside a request (scripts): nothing to clear.
    }
  }
  return outcome;
}
