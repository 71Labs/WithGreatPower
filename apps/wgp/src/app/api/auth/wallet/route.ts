/**
 * POST /api/auth/wallet — sign in with an existing NEAR wallet (near-connect), NEP-413.
 *
 * { action: "nonce", accountId }
 *     200 { nonce, message, recipient, token, expiresAt }: pass nonce (base64 → 32 bytes),
 *     message and recipient to `wallet.signMessage`, keep `token`.
 * { action: "verify", accountId, publicKey, signature, token, ref? }
 *     Checks the signature, that publicKey is a full-access key of accountId on chain, and
 *     the challenge (once on any instance, 5 minutes). 200 { accountId, playerId } and a
 *     session cookie. An invite (the `wgp_ref` cookie, else `ref`) is attached when this
 *     sign-in creates the player (docs/referrals.md).
 * { action: "session-key", publicKey }   (signed in)
 *     "Enable quick play": after the wallet added a function-call key for the game
 *     contract, records it so the relayer accepts it. Checked on chain first.
 *     200 { publicKey, live: true }
 *
 * 415 when the body isn't sent as JSON (no form posts: login CSRF).
 */
import { z } from "zod";

import { SESSION_KEY_ALLOWANCE, isAccountId } from "@/lib/near/policy";
import { attachInviteOnSignIn, refField } from "@/server/auth/referral";
import { secret } from "@/server/auth/secrets";
import { createSession, requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { findOrCreatePlayerOutcome } from "@/server/db/players";
import { HttpError, assertJson, clientIp, handle, json, readJson, unauthorized } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";
import { chainEnv } from "@/server/near/env";
import { NEAR_RATE_LIMITS, nearRoute } from "@/server/near/http";
import { provider } from "@/server/near/rpc";
import { addSessionKey } from "@/server/near/session-keys";
import { burnChallenge, handleFromAccount, issueChallenge, redeemChallenge, verifyWalletSignature } from "@/server/near/wallet-auth";

const accountId = z.string().refine(isAccountId, "not a NEAR account id");
const publicKey = z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/, "an ed25519 public key");

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("nonce"), accountId }),
  z.object({ action: z.literal("verify"), accountId, publicKey, signature: z.string().min(40).max(200), token: z.string().max(300), ref: refField }),
  z.object({ action: z.literal("session-key"), publicKey }),
]);

/** The NEP-413 recipient: this site's host, so a signature for another site never works here. */
const recipientOf = (request: Request) => new URL(request.url).host;

export const POST = handle("auth/wallet", (request: Request) =>
  nearRoute(async () => {
    rateLimiter.enforce("wallet-ip", clientIp(request), NEAR_RATE_LIMITS.walletPerIp);
    assertJson(request);
    const input = await readJson(request, body, 4 * 1024);
    const recipient = recipientOf(request);

    if (input.action === "nonce") {
      return json(issueChallenge(secret("AUTH_SECRET"), input.accountId, recipient));
    }

    if (input.action === "verify") {
      let nonce: Uint8Array;
      try {
        nonce = redeemChallenge(secret("AUTH_SECRET"), input.token, input.accountId, recipient);
      } catch (error) {
        throw unauthorized(`Sign-in challenge rejected: ${(error as Error).message}`);
      }
      try {
        await verifyWalletSignature({ accountId: input.accountId, publicKey: input.publicKey, signature: input.signature, nonce, recipient });
      } catch (error) {
        // Logged, not echoed: a failed RPC call's message can name the RPC URL, API key included.
        console.error(`[auth/wallet] signature for ${input.accountId}: ${(error as Error).message}`);
        throw unauthorized("Signature rejected: sign in with a full-access key of that account");
      }
      const db = await getDb();
      if (!(await burnChallenge(db, input.token))) throw unauthorized("Sign-in challenge rejected: Challenge already used");
      const { player, created } = await findOrCreatePlayerOutcome(db, {
        nearAccountId: input.accountId,
        authKind: "wallet",
        authSub: `wallet:${input.accountId}`,
        handle: handleFromAccount(input.accountId),
      });
      if (player.bannedAt) throw new HttpError(403, "banned", "This account is suspended");
      await createSession(player.id, request);
      await attachInviteOnSignIn(db, request, { playerId: player.id, created, ref: input.ref });
      return json({ accountId: player.nearAccountId, playerId: player.id });
    }

    const session = await requireSession(request);
    const { contractId } = chainEnv();
    const key = await provider()
      .viewAccessKey({ accountId: session.player.nearAccountId, publicKey: input.publicKey, finalityQuery: { finality: "optimistic" } })
      .catch(() => null);
    const permission = key?.permission;
    const fc = typeof permission === "object" && permission && "FunctionCall" in permission ? permission.FunctionCall : null;
    if (!fc) throw new HttpError(400, "key_not_found", "That key isn't on your account as a function-call key yet");
    if (fc.receiver_id !== contractId) throw new HttpError(400, "wrong_receiver", `The key must be limited to ${contractId}`);
    if (fc.allowance === null || fc.allowance === undefined || BigInt(fc.allowance) > SESSION_KEY_ALLOWANCE) {
      throw new HttpError(400, "allowance", "Session keys carry at most a 0.05 NEAR allowance");
    }
    await addSessionKey(await getDb(), { playerId: session.playerId, publicKey: input.publicKey });
    return json({ publicKey: input.publicKey, live: true });
  }),
);
