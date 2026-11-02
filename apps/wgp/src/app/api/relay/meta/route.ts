/**
 * POST /api/relay/meta — relay a NEP-366 meta-transaction; our relayer pays the gas.
 *
 * Body: { kind?: "game" | "add-key", signedDelegate: base64(borsh SignedDelegateAction), newKey?: "ed25519:…" }
 *   game     a session-key call to an allowlisted game method (register_hero, craft_suit, equip_suit)
 *   add-key  a returning player's NEAR Auth-signed AddKey of this device's game session key
 *
 * 200 { txHash, ok: true, result }            relayed, the call succeeded
 * 422 { error: "call_failed", txHash, message } relayed, the contract refused (e.g. already has a hero)
 * 400/401/403 { error: <code>, message }       refused before spending gas (see server/near/relay.ts)
 * 429 rate limited · 503 relayer not configured, out of funds or out of budget
 *
 * Needs a session cookie; the delegate must come from the signed-in account.
 */
import { z } from "zod";

import { base64Decode } from "near-api-js";

import { decodeSignedDelegate } from "@/lib/near/delegate-codec";
import { finalBlockHeight } from "@/lib/near/rpc";
import { TGAS } from "@/lib/near/policy";
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { HttpError, clientIp, handle, json, readJson } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";
import { chainEnv, relayerEnv } from "@/server/near/env";
import { deviceId, NEAR_BUDGETS, NEAR_RATE_LIMITS, nearRoute, spend } from "@/server/near/http";
import {
  relayerHasFunds,
  reserveTgasFor,
  submitSignedDelegate,
  validateAddKeyDelegate,
  validateGameDelegate,
} from "@/server/near/relay";
import { provider } from "@/server/near/rpc";
import { addSessionKey, relayLookup, touchSessionKey } from "@/server/near/session-keys";

const body = z.object({
  kind: z.enum(["game", "add-key"]).default("game"),
  signedDelegate: z.string().min(16).max(12_000),
  newKey: z
    .string()
    .regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/)
    .optional(),
});

export const POST = handle("relay/meta", (request: Request) =>
  nearRoute(async () => {
    const ip = clientIp(request);
    rateLimiter.enforce("relay-ip", ip, NEAR_RATE_LIMITS.relayPerIp);
    const device = deviceId(request);
    if (device) rateLimiter.enforce("relay-device", device, NEAR_RATE_LIMITS.relayPerDevice);
    const session = await requireSession(request);
    const accountId = session.player.nearAccountId;
    rateLimiter.enforce("relay-account", accountId, NEAR_RATE_LIMITS.relayPerAccount);

    const input = await readJson(request, body, 16 * 1024);
    let bytes: Uint8Array;
    try {
      bytes = base64Decode(input.signedDelegate);
    } catch {
      throw new HttpError(400, "bad_delegate", "signedDelegate is not base64");
    }
    const signed = decodeSignedDelegate(bytes);
    const chain = chainEnv();
    const rpc = provider();
    const db = await getDb();
    const [blockHeight, lookup] = await Promise.all([finalBlockHeight(rpc), relayLookup(db, signed.delegate.senderId, signed.delegate.publicKey)]);

    let innerGas: bigint;
    let newKey: string | null = null;
    if (input.kind === "game") {
      const verdict = validateGameDelegate(signed, { contractId: chain.contractId, blockHeight, ...lookup, sessionAccountId: accountId });
      if (!verdict.ok) throw new HttpError(verdict.status, verdict.code, verdict.message);
      innerGas = verdict.gas;
    } else {
      if (!input.newKey) throw new HttpError(400, "bad_request", "newKey is required for add-key");
      const access = await rpc
        .viewAccessKey({ accountId: signed.delegate.senderId, publicKey: signed.delegate.publicKey, finalityQuery: { finality: "optimistic" } })
        .catch(() => null);
      const verdict = validateAddKeyDelegate(signed, {
        contractId: chain.contractId,
        blockHeight,
        sender: lookup.sender,
        sessionAccountId: accountId,
        signerIsFullAccess: access?.permission === "FullAccess",
        expectedNewKey: input.newKey,
      });
      if (!verdict.ok) throw new HttpError(verdict.status, verdict.code, verdict.message);
      newKey = verdict.newKey;
      innerGas = 0n;
    }

    if (!(await relayerHasFunds())) throw new HttpError(503, "relayer_empty", "The relayer is out of funds");
    const reserved = reserveTgasFor(innerGas);
    const releaseGas = await spend(db, "relay:tgas", "global", relayerEnv().dailyTgas, reserved);
    await spend(db, "relay:calls", accountId, NEAR_BUDGETS.relayCallsPerAccountPerDay, 1, 429);

    let result;
    try {
      result = await submitSignedDelegate(signed);
    } catch (error) {
      await releaseGas(reserved);
      throw error;
    }
    await releaseGas(reserved - Number((result.gasBurnt + TGAS - 1n) / TGAS));

    if (newKey && result.ok) await addSessionKey(db, { playerId: session.playerId, publicKey: newKey, addTx: result.txHash });
    if (input.kind === "game") await touchSessionKey(db, signed.delegate.publicKey);

    if (!result.ok) return json({ error: "call_failed", txHash: result.txHash, message: result.error }, { status: 422 });
    return json({ ok: true, txHash: result.txHash, result: result.result ?? null });
  }),
);
