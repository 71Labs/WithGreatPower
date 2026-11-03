/**
 * POST /api/auth/privy — sign in (and up) with Google through Privy.
 *
 * The browser logs in with Google through Privy and makes sure the user has a Privy NEAR
 * embedded wallet. The server verifies the access token (Privy's SDK and our app secret:
 * issuer, audience = our app id, expiry) and reads the user's verified email and NEAR
 * wallet from Privy, never from the body (src/server/auth/privy.ts).
 *
 * Body: { accessToken, handle?, sessionPublicKey? }
 *   accessToken       Privy's access token (getAccessToken())
 *   handle            new players only, while the factory is live: <handle>.<FACTORY_ACCOUNT_ID>
 *   sessionPublicKey  this browser's ed25519 session key ("ed25519:…")
 *
 * new player, factory live, no handle  200 { needsHandle: true, suggestedHandle?, parentId }
 *     Post again with the same token (or a fresh one) and a handle.
 * new player, factory live             201 { accountId, created: true, txHash, sessionKeyLive, unclaimed: false }
 *     One transaction creates the account with the Privy NEAR key (full access) and the
 *     session key (game contract only); then the session cookie is set.
 * new player, factory not live         201 { accountId, created: true, txHash: null, sessionKeyLive: false, unclaimed: true }
 *     The player is made on their key's implicit account id and can play ranked nights
 *     now; GET /api/auth/privy/claim says when they can claim a name.
 * returning (or found by email)        200 { accountId, created: false, sessionKeyLive, unclaimed, linked }
 *     `linked`: found by verified email (they first signed up through NEAR Auth).
 *
 * 401 bad_token · 409 near_wallet_missing · 409 handle_taken · 400 invalid_handle ·
 * 503 privy_not_configured · 429 rate_limited / budget_exhausted · 415 not JSON (no form posts)
 */
import { z } from "zod";

import { isUnclaimed } from "@/lib/near/policy";
import { createSession } from "@/server/auth/session";
import { privySignIn } from "@/server/auth/privy-sign-in";
import { identityFromToken, openFactory, privyRoute } from "@/server/auth/privy-route";
import { getDb } from "@/server/db/client";
import { assertJson, clientIp, handle, json, readJson } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";
import { NEAR_RATE_LIMITS } from "@/server/near/http";

const publicKey = z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/, "an ed25519 public key");

const body = z.object({
  accessToken: z.string().min(20).max(8 * 1024),
  handle: z.string().max(40).optional(),
  sessionPublicKey: publicKey.optional(),
});

export const POST = handle("auth/privy", (request: Request) =>
  privyRoute(async () => {
    const ip = clientIp(request);
    rateLimiter.enforce("privy-ip", ip, NEAR_RATE_LIMITS.signInPerIp);
    assertJson(request);
    const input = await readJson(request, body, 16 * 1024);

    const identity = await identityFromToken(input.accessToken);
    const db = await getDb();
    const outcome = await privySignIn(db, { identity, handle: input.handle, sessionPublicKey: input.sessionPublicKey }, { factory: () => openFactory(db, ip) });

    if (outcome.kind === "needs-handle") return json({ needsHandle: true, suggestedHandle: outcome.suggestedHandle, parentId: outcome.parentId });

    const { player } = outcome;
    await createSession(player.id, request);
    return json(
      {
        accountId: player.nearAccountId,
        created: outcome.created,
        txHash: outcome.txHash,
        sessionKeyLive: outcome.sessionKeyLive,
        unclaimed: isUnclaimed(player),
        linked: outcome.linked,
      },
      { status: outcome.created ? 201 : 200 },
    );
  }),
);
