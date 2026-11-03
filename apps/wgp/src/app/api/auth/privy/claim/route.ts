/**
 * "Claim your name": for a Google player who signed up through Privy before the account
 * factory was live, and so plays on their key's implicit account id.
 *
 * GET  (signed in) → 200 { unclaimed, open, parentId, suggestedHandle? }
 *     `open`: the factory is live, so a claim can go through now.
 * POST (signed in) { handle, sessionPublicKey } → 201 { accountId, txHash, sessionKeyLive }
 *     The factory creates <handle>.<parent> with the player's Privy NEAR key (read from
 *     Privy again; it must be the key of their implicit account) and this browser's
 *     session key. The player moves onto it with their save, rank and held rewards, which
 *     then go out to the new account (src/server/auth/privy-sign-in.ts, claimName).
 *
 * 409 already_claimed | wallet_mismatch | handle_taken · 400 invalid_handle ·
 * 503 names_closed (factory not live) | privy_not_configured · 429 rate_limited
 */
import { z } from "zod";

import { requireSession } from "@/server/auth/session";
import { claimInfo, claimName } from "@/server/auth/privy-sign-in";
import { identityOf, openFactory, privyRoute } from "@/server/auth/privy-route";
import { sendMintsSoon } from "@/server/background";
import { getDb } from "@/server/db/client";
import { getPlayer } from "@/server/db/players";
import { HttpError, assertJson, clientIp, handle, json, readJson, unauthorized } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";
import { factoryState } from "@/server/near/factory";
import { NEAR_RATE_LIMITS } from "@/server/near/http";
import { isUnclaimed } from "@/lib/near/policy";

const body = z.object({
  handle: z.string().max(40),
  sessionPublicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/, "an ed25519 public key"),
});

async function signedInPlayer(request: Request) {
  const session = await requireSession(request);
  const db = await getDb();
  const player = await getPlayer(db, session.playerId);
  if (!player) throw unauthorized();
  return { db, player };
}

export const GET = handle("auth/privy/claim", async (request: Request) => {
  const { player } = await signedInPlayer(request);
  rateLimiter.enforce("privy-claim-read", player.id, NEAR_RATE_LIMITS.chainStatusPerPlayer);
  const state = isUnclaimed(player) ? await factoryState() : null;
  return json(claimInfo(player, state?.open ? { parentId: state.parentId } : null));
});

export const POST = handle("auth/privy/claim", (request: Request) =>
  privyRoute(async () => {
    const ip = clientIp(request);
    rateLimiter.enforce("privy-ip", ip, NEAR_RATE_LIMITS.signInPerIp);
    const { db, player } = await signedInPlayer(request);
    rateLimiter.enforce("privy-claim", player.id, NEAR_RATE_LIMITS.signInPerIp);
    assertJson(request);
    const input = await readJson(request, body, 4 * 1024);
    if (!isUnclaimed(player) || !player.authSub) throw new HttpError(409, "already_claimed", "Your account already has its name");

    const identity = await identityOf(player.authSub);
    const claimed = await claimName(db, { player, identity, handle: input.handle, sessionPublicKey: input.sessionPublicKey }, { factory: () => openFactory(db, ip) });
    // Rewards held while the player had no account now go out to the new one.
    sendMintsSoon();
    return json({ accountId: claimed.accountId, txHash: claimed.txHash, sessionKeyLive: claimed.sessionKeyLive }, { status: 201 });
  }),
);
