/**
 * POST /api/auth/near-auth — sign in (and up) with Google through NEAR Auth. Plan A.
 *
 * First POST /api/auth/near-auth/nonce, and have the Google login carry that nonce: the
 * ID token's `nonce` claim must equal this browser's nonce cookie and be unused, so a
 * token minted for another app, or replayed, is refused (src/server/near/login-nonce.ts).
 *
 * Body: { mode?: "sign-in" | "verify", idToken, handle?, sessionPublicKey?, ref? }
 *   idToken           the Auth0 ID token from the NEAR Auth login (raw JWT)
 *   handle            new players only: the account becomes <handle>.<FACTORY_ACCOUNT_ID>
 *   ref               an invite code, used when the `wgp_ref` cookie is missing: attached only
 *                     when this sign-in creates the player (docs/referrals.md)
 *   sessionPublicKey  this browser's ed25519 session key ("ed25519:…")
 *
 * sign-in, new player, no handle   200 { needsHandle: true, suggestedHandle? }
 *     Nothing is spent: post again with the same token and a handle.
 * sign-in, new player              201 { accountId, created: true, txHash, sessionKeyLive: true }
 *     One transaction creates the account with the user's NEAR Auth key (full access)
 *     and the session key (game contract only), then a session cookie is set.
 * sign-in, returning               200 { accountId, created: false, sessionKeyLive }
 *     Session cookie set. If this browser's key isn't live yet, add it: NEAR Auth signs
 *     an AddKey delegate (one popup) and /api/relay/meta { kind: "add-key" } relays it.
 *     "Returning" includes a player who signed up with Google through Privy: the token's
 *     verified email finds them, so they keep their hero (docs/ARCHITECTURE.md §5).
 * verify                           200 { sub, userPublicKey, implicitAccountId, accountId | null, fastAuthContractId }
 *     Checks the token and derives the key without creating anything (the lab uses it).
 *
 * 401 nonce_missing | nonce_mismatch | nonce_spent: start the sign-in again.
 */
import { cookies } from "next/headers";
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { findOrCreatePlayerOutcome, findPlayerForLogin, normalizeEmail, rememberEmail } from "@/server/db/players";
import { attachInviteOnSignIn, refField } from "@/server/auth/referral";
import { createSession } from "@/server/auth/session";
import { HttpError, badRequest, clientIp, handle, json, readJson } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";
import { nearAuthEnv } from "@/server/near/env";
import { assertHandleAvailable, createPlayerAccount, normalizeHandle, suggestHandle } from "@/server/near/factory";
import { NEAR_BUDGETS, NEAR_RATE_LIMITS, nearRoute, spend } from "@/server/near/http";
import { nearAuthNonceCookieName, readCookie, redeemNearAuthNonce } from "@/server/near/login-nonce";
import { deriveNearAuthPublicKey, implicitAccountId, verifyNearAuthIdToken } from "@/server/near/near-auth";
import { addSessionKey, liveSessionKeys } from "@/server/near/session-keys";

const publicKey = z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/, "an ed25519 public key");

const body = z.object({
  mode: z.enum(["sign-in", "verify"]).default("sign-in"),
  idToken: z.string().min(20).max(8 * 1024),
  handle: z.string().max(40).optional(),
  sessionPublicKey: publicKey.optional(),
  ref: refField,
});

/** The nonce did its job: drop the cookie so it can't be paired with anything else. */
async function clearNonceCookie() {
  const jar = await cookies();
  jar.set(nearAuthNonceCookieName(), "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export const POST = handle("auth/near-auth", (request: Request) =>
  nearRoute(async () => {
    const ip = clientIp(request);
    rateLimiter.enforce("near-auth-ip", ip, NEAR_RATE_LIMITS.signInPerIp);
    const input = await readJson(request, body, 16 * 1024);

    const identity = await verifyNearAuthIdToken(input.idToken);
    const db = await getDb();
    const nonce = { tokenNonce: identity.nonce, cookieNonce: readCookie(request, nearAuthNonceCookieName()) };
    // Refuse foreign or replayed tokens before any RPC work; spend the nonce later, at the point of no return.
    await redeemNearAuthNonce(db, { ...nonce, consume: false });

    const env = nearAuthEnv();
    const userPublicKey = await deriveNearAuthPublicKey(identity.sub, env);
    // Known by this Google sub, or by the verified email of a player who signed up
    // through Privy: the same person keeps the same hero whichever service signs them in.
    const email = identity.emailVerified ? normalizeEmail(identity.email) : null;
    const found = await findPlayerForLogin(db, { authSub: identity.sub, authKind: "near_auth", email });
    const existing = found ? await rememberEmail(db, found.player, email) : null;

    if (input.mode === "verify") {
      await redeemNearAuthNonce(db, { ...nonce, consume: true });
      await clearNonceCookie();
      return json({
        sub: identity.sub,
        userPublicKey,
        implicitAccountId: implicitAccountId(userPublicKey),
        accountId: existing?.nearAccountId ?? null,
        fastAuthContractId: env.fastAuthContractId,
      });
    }

    if (existing) {
      if (existing.bannedAt) throw new HttpError(403, "banned", "This account is suspended");
      await redeemNearAuthNonce(db, { ...nonce, consume: true });
      await clearNonceCookie();
      await createSession(existing.id, request);
      // A returning player is never attached; this only drops a leftover invite cookie.
      await attachInviteOnSignIn(db, request, { playerId: existing.id, created: false, ref: input.ref });
      const live = input.sessionPublicKey ? (await liveSessionKeys(db, existing.id)).includes(input.sessionPublicKey) : false;
      return json({ accountId: existing.nearAccountId, created: false, sessionKeyLive: live });
    }

    if (!input.handle) return json({ needsHandle: true, suggestedHandle: suggestHandle(identity.email) });
    if (!input.sessionPublicKey) throw badRequest("sessionPublicKey is required to create an account");
    const handleName = normalizeHandle(input.handle);
    // Read-only checks first, so a taken handle or a closed server never burns the nonce.
    await assertHandleAvailable(handleName);
    rateLimiter.enforce("near-auth-signup-ip", ip, NEAR_RATE_LIMITS.signUpPerIp);
    const release = await spend(db, "chain:accounts", "global", NEAR_BUDGETS.accountsPerDay(), 1);

    let created;
    try {
      await redeemNearAuthNonce(db, { ...nonce, consume: true });
      created = await createPlayerAccount({ handle: handleName, userPublicKey, sessionPublicKey: input.sessionPublicKey });
    } catch (error) {
      await release(1);
      throw error;
    }
    await clearNonceCookie();
    const made = await findOrCreatePlayerOutcome(db, { nearAccountId: created.accountId, authKind: "near_auth", authSub: identity.sub, handle: handleName, email });
    const player = made.player;
    await addSessionKey(db, { playerId: player.id, publicKey: input.sessionPublicKey, addTx: created.txHash });
    await createSession(player.id, request);
    await attachInviteOnSignIn(db, request, { playerId: player.id, created: made.created, ref: input.ref });
    return json({ accountId: created.accountId, created: true, txHash: created.txHash, sessionKeyLive: true }, { status: 201 });
  }),
);
