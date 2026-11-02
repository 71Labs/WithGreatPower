/**
 * POST /api/auth/near-auth — sign in (and up) with Google through NEAR Auth. Plan A.
 *
 * Body: { mode?: "sign-in" | "verify", idToken, handle?, sessionPublicKey? }
 *   idToken           the Auth0 ID token from the NEAR Auth login (raw JWT)
 *   handle            new players only: the account becomes <handle>.<FACTORY_ACCOUNT_ID>
 *   sessionPublicKey  this browser's ed25519 session key ("ed25519:…")
 *
 * sign-in, new player   201 { accountId, created: true, txHash, sessionKeyLive: true }
 *     One transaction creates the account with the user's NEAR Auth key (full access)
 *     and the session key (game contract only), then a session cookie is set.
 * sign-in, returning    200 { accountId, created: false, sessionKeyLive }
 *     Session cookie set. If this browser's key isn't live yet, add it: NEAR Auth signs
 *     an AddKey delegate (one popup) and /api/relay/meta { kind: "add-key" } relays it.
 * verify                200 { sub, userPublicKey, implicitAccountId, accountId | null, fastAuthContractId }
 *     Checks the token and derives the key without creating anything (the lab uses it).
 */
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { findOrCreatePlayer } from "@/server/db/players";
import { createSession } from "@/server/auth/session";
import { HttpError, badRequest, clientIp, handle, json, readJson } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";
import { nearAuthEnv } from "@/server/near/env";
import { createPlayerAccount, normalizeHandle } from "@/server/near/factory";
import { NEAR_BUDGETS, NEAR_RATE_LIMITS, nearRoute, spend } from "@/server/near/http";
import { deriveNearAuthPublicKey, implicitAccountId, verifyNearAuthIdToken } from "@/server/near/near-auth";
import { addSessionKey, liveSessionKeys, playerByAuthSub } from "@/server/near/session-keys";

const publicKey = z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/, "an ed25519 public key");

const body = z.object({
  mode: z.enum(["sign-in", "verify"]).default("sign-in"),
  idToken: z.string().min(20).max(8 * 1024),
  handle: z.string().max(40).optional(),
  sessionPublicKey: publicKey.optional(),
});

export const POST = handle("auth/near-auth", (request: Request) =>
  nearRoute(async () => {
    const ip = clientIp(request);
    rateLimiter.enforce("near-auth-ip", ip, NEAR_RATE_LIMITS.signInPerIp);
    const input = await readJson(request, body, 16 * 1024);

    const identity = await verifyNearAuthIdToken(input.idToken);
    const env = nearAuthEnv();
    const userPublicKey = await deriveNearAuthPublicKey(identity.sub, env);
    const db = await getDb();
    const existing = await playerByAuthSub(db, identity.sub);

    if (input.mode === "verify") {
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
      await createSession(existing.id, request);
      const live = input.sessionPublicKey ? (await liveSessionKeys(db, existing.id)).includes(input.sessionPublicKey) : false;
      return json({ accountId: existing.nearAccountId, created: false, sessionKeyLive: live });
    }

    if (!input.handle) throw badRequest("Pick a handle");
    if (!input.sessionPublicKey) throw badRequest("sessionPublicKey is required to create an account");
    const handleName = normalizeHandle(input.handle);
    rateLimiter.enforce("near-auth-signup-ip", ip, NEAR_RATE_LIMITS.signUpPerIp);
    const release = await spend(db, "chain:accounts", "global", NEAR_BUDGETS.accountsPerDay(), 1);

    let created;
    try {
      created = await createPlayerAccount({ handle: handleName, userPublicKey, sessionPublicKey: input.sessionPublicKey });
    } catch (error) {
      await release(1);
      throw error;
    }
    const player = await findOrCreatePlayer(db, { nearAccountId: created.accountId, authKind: "near_auth", authSub: identity.sub, handle: handleName });
    await addSessionKey(db, { playerId: player.id, publicKey: input.sessionPublicKey, addTx: created.txHash });
    await createSession(player.id, request);
    return json({ accountId: created.accountId, created: true, txHash: created.txHash, sessionKeyLive: true }, { status: 201 });
  }),
);
