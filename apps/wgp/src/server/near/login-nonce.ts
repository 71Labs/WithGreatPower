/**
 * Binds a NEAR Auth (Auth0) ID token to one sign-in started here.
 *
 * On testnet every NEAR Auth app shares one Auth0 client, so an ID token any of them
 * receives would otherwise pass our audience check. Before the Google popup, the browser
 * gets a nonce from POST /api/auth/near-auth/nonce: the value comes back in the body and
 * in an HttpOnly cookie, and only its hash is stored, for ten minutes. The browser has
 * Auth0 put it in the token's `nonce` claim (src/lib/near/near-auth.ts). When the token
 * arrives, the claim must equal this browser's cookie and still be live; signing in uses
 * it up. A token minted for another app, replayed, or older than ten minutes is refused.
 */
import { timingSafeEqual } from "node:crypto";

import { consumeNonce, nonceIsLive } from "@/server/auth/nonces";
import type { Db } from "@/server/db/client";
import { HttpError } from "@/server/http";

export function nearAuthNonceCookieName(env: Record<string, string | undefined> = process.env): string {
  return env.NODE_ENV === "production" ? "__Host-wgp_near_auth_nonce" : "wgp_near_auth_nonce";
}

/** A cookie's value from a request's Cookie header. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim()) || null;
  }
  return null;
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const nonceError = {
  missing: () => new HttpError(401, "nonce_missing", "That Google sign-in didn’t come from this page. Sign in again."),
  mismatch: () => new HttpError(401, "nonce_mismatch", "That Google sign-in was started in another tab or browser. Sign in again."),
  spent: () => new HttpError(401, "nonce_spent", "That Google sign-in expired or was already used. Sign in again."),
};

/**
 * Checks a verified token's `nonce` claim against this browser's nonce cookie and the
 * stored nonces. `consume: true` uses it up (do that at the point of no return: a session
 * or an account); `consume: false` only checks, e.g. before asking a new player for a handle.
 * Throws a 401 HttpError: nonce_missing | nonce_mismatch | nonce_spent.
 */
export async function redeemNearAuthNonce(
  db: Db,
  input: { tokenNonce: unknown; cookieNonce: string | null; consume: boolean; now?: Date },
): Promise<void> {
  const { tokenNonce, cookieNonce, consume, now = new Date() } = input;
  if (typeof tokenNonce !== "string" || !tokenNonce) throw nonceError.missing();
  if (!cookieNonce || !sameString(tokenNonce, cookieNonce)) throw nonceError.mismatch();
  const live = consume ? await consumeNonce(db, "near-auth", tokenNonce, now) : await nonceIsLive(db, "near-auth", tokenNonce, now);
  if (!live) throw nonceError.spent();
}
