/**
 * POST /api/relay/fast-auth — call NEAR Auth's `sign` for the user (they hold no NEAR).
 *
 * Body: the signature request from `signer.getSignatureRequest()`:
 *   { guardId, verifyPayload (the Auth0 JWT), signPayload: number[] (= the JWT's fatxn), algorithm: "eddsa" }
 * 200 { txHash, signature }   signature: base64 of the 64-byte Ed25519 signature over sha256(signPayload)
 *
 * Only `sign` on the NEAR Auth contract, with 1 yoctoNEAR (refunded by the contract),
 * and only for payloads we'd relay anyway: adding a game session key to the user's own
 * account, or an allowlisted game call. Rate-limited per IP and account, budgeted per
 * day. Needs a session, except on the dev-only lab (ALLOW_NEAR_AUTH_LAB=1, not production).
 */
import { z } from "zod";

import { finalBlockHeight } from "@/lib/near/rpc";
import { TGAS } from "@/lib/near/policy";
import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { HttpError, clientIp, handle, json, readJson, unauthorized } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";
import { chainEnv, nearAuthEnv } from "@/server/near/env";
import { labMode, NEAR_BUDGETS, NEAR_RATE_LIMITS, nearRoute, spendRelay } from "@/server/near/http";
import { submitFastAuthSign, validateFastAuthSign } from "@/server/near/near-auth";
import { relayerHasFunds } from "@/server/near/relay";
import { provider } from "@/server/near/rpc";

export const maxDuration = 60;

const body = z.object({
  guardId: z.string().max(256),
  verifyPayload: z.string().max(7 * 1024),
  signPayload: z.array(z.number().int().min(0).max(255)).min(1).max(2048),
  algorithm: z.string().max(16),
});

const SIGN_RESERVE_TGAS = 300;

export const POST = handle("relay/fast-auth", (request: Request) =>
  nearRoute(async () => {
    const ip = clientIp(request);
    rateLimiter.enforce("fast-auth-ip", ip, NEAR_RATE_LIMITS.fastAuthPerIp);
    const session = await getSession(request);
    if (!session && !labMode()) throw unauthorized();
    if (session?.player.bannedAt) throw new HttpError(403, "banned", "This account is suspended");
    const accountId = session?.player.nearAccountId ?? null;
    if (accountId) rateLimiter.enforce("fast-auth-account", accountId, NEAR_RATE_LIMITS.fastAuthPerAccount);

    const req = await readJson(request, body, 24 * 1024);
    const env = nearAuthEnv();
    const verdict = validateFastAuthSign(req, {
      env,
      contractId: chainEnv().contractId,
      blockHeight: await finalBlockHeight(provider()),
      sessionAccountId: accountId,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    if (!verdict.ok) throw new HttpError(400, verdict.code, verdict.message);

    if (!(await relayerHasFunds())) throw new HttpError(503, "relayer_empty", "The relayer is out of funds");
    const db = await getDb();
    const releaseGas = await spendRelay(db, SIGN_RESERVE_TGAS, {
      scope: "relay:fast-auth",
      key: accountId ?? `ip:${ip}`,
      limit: NEAR_BUDGETS.fastAuthSignsPerAccountPerDay,
    });

    let result;
    try {
      result = await submitFastAuthSign(req, verdict.sub || accountId || ip);
    } catch (error) {
      await releaseGas(SIGN_RESERVE_TGAS);
      throw error;
    }
    await releaseGas(SIGN_RESERVE_TGAS - Number((result.gasBurnt + TGAS - 1n) / TGAS));
    return json({ txHash: result.txHash, signature: result.signature, kind: verdict.kind, contractId: env.fastAuthContractId });
  }),
);
