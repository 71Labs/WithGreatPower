/**
 * NEAR Auth on the server.
 *
 * Sign-up (Plan A): the browser logs in with Google through NEAR Auth and sends us the
 * Auth0 ID token. We verify it (RS256 against the tenant's JWKS, issuer, audience = our
 * client id, freshness), then derive the user's MPC-controlled key exactly as NEAR Auth
 * does: `derived_public_key(path = "jwt#https://<domain>/#<sub>", predecessor = the NEAR
 * Auth contract, domain_id = 1)` on the MPC contract. That key becomes the full-access
 * key of `<handle>.wgp.*`, so the user controls the account through Google alone.
 *
 * Signing: every NEAR Auth signature is an Auth0 popup or redirect that mints a JWT
 * whose `fatxn` claim is the exact payload. Someone must then call `sign` on the NEAR
 * Auth contract with that JWT; users hold no NEAR, so our relayer does it here, but only
 * for payloads we would relay anyway (a game call or adding a game session key).
 */
import { createHash } from "node:crypto";

import { actions as nearActions, baseEncode, encodeTransaction, keyToImplicitAddress, type Account, type Action } from "near-api-js";
import { InvalidNonceError, TransactionTimeoutError } from "near-api-js/rpc-errors";

import { nearAuthPath } from "../../lib/near/config";
import { decodeSignableDelegate, type DecodedDelegate } from "../../lib/near/delegate-codec";
import { MAX_DELEGATE_TTL_BLOCKS, MAX_RELAY_GAS, RELAY_METHODS, SESSION_KEY_ALLOWANCE } from "../../lib/near/policy";
import { viewFunction } from "../../lib/near/rpc";
import { chainEnv, nearAuthEnv, relayerEnv, type NearAuthEnv } from "./env";
import { decodeJwt, verifyRs256, type JwksFetcher } from "./jwt";
import { relayerKeyIndex } from "./relay";
import { keyedAccount, provider, freshKeyedAccount } from "./rpc";

export interface NearAuthIdentity {
  sub: string;
  email?: string;
  /** The OIDC nonce the sign-in asked for; must be one we issued (login-nonce.ts). */
  nonce?: string;
}

/** Checks a NEAR Auth (Auth0) ID token. Tokens older than an hour are refused. */
export async function verifyNearAuthIdToken(idToken: string, opts: { env?: NearAuthEnv; fetcher?: JwksFetcher; now?: number } = {}): Promise<NearAuthIdentity> {
  const env = opts.env ?? nearAuthEnv();
  const claims = await verifyRs256(idToken, {
    jwksUrl: `https://${env.domain}/.well-known/jwks.json`,
    issuer: env.issuer,
    audience: env.clientId,
    maxAgeSeconds: 3600,
    fetcher: opts.fetcher,
    now: opts.now,
  });
  const sub = claims.sub!;
  // NEAR Auth builds the MPC path from `sub` and refuses '#' and anything over 256 chars.
  if (sub.includes("#") || sub.length > 256) throw new Error("Unsupported subject");
  return {
    sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    ...(typeof claims.nonce === "string" ? { nonce: claims.nonce } : {}),
  };
}

/** The user's NEAR Auth public key ("ed25519:…"), from the MPC contract. */
export async function deriveNearAuthPublicKey(sub: string, env: NearAuthEnv = nearAuthEnv()): Promise<string> {
  const key = await viewFunction<string>(provider(), env.mpcContractId, "derived_public_key", {
    path: nearAuthPath(sub, env.domain),
    predecessor: env.fastAuthContractId,
    domain_id: 1,
  });
  if (typeof key !== "string" || !key.startsWith("ed25519:")) throw new Error("Unexpected derived key");
  return key;
}

/* ------------------------------------------------------------------ relayed `sign` (pure check) */

export interface FastAuthSignRequest {
  guardId: string;
  verifyPayload: string;
  signPayload: number[];
  algorithm: string;
}

export type FastAuthVerdict =
  | { ok: true; delegate: DecodedDelegate; kind: "add-key" | "game-call"; sub: string }
  | { ok: false; code: string; message: string };

const deny = (code: string, message: string): FastAuthVerdict => ({ ok: false, code, message });

function sameBytes(a: unknown, b: number[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Decides whether the relayer will call NEAR Auth's `sign` for this request. Pure.
 * The JWT is checked on chain by the guard; here we only refuse what we won't pay for:
 * another guard, another audience, an expired token, a `fatxn` that isn't the payload,
 * or a payload that isn't a delegate we'd relay anyway.
 */
export function validateFastAuthSign(
  req: FastAuthSignRequest,
  ctx: { env: NearAuthEnv; contractId: string; blockHeight: bigint; sessionAccountId?: string | null; nowSeconds: number },
): FastAuthVerdict {
  if (req.guardId !== ctx.env.guardId) return deny("guard", "Unknown guard");
  if (req.algorithm !== "eddsa") return deny("algorithm", "Only eddsa signatures are relayed");
  if (req.signPayload.length === 0 || req.signPayload.length > 2048 || req.signPayload.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    return deny("payload", "Bad sign payload");
  }
  let claims: Record<string, unknown>;
  try {
    claims = decodeJwt(req.verifyPayload).claims;
  } catch {
    return deny("jwt", "verify_payload is not a JWT");
  }
  if (req.verifyPayload.length > 7 * 1024) return deny("jwt", "JWT is too large");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(ctx.env.signingAudience)) return deny("jwt", "JWT is for another audience");
  if (claims.iss !== ctx.env.issuer) return deny("jwt", "JWT is from another issuer");
  if (typeof claims.exp !== "number" || claims.exp <= ctx.nowSeconds) return deny("jwt", "JWT has expired; approve again");
  if (!sameBytes(claims.fatxn, req.signPayload)) return deny("jwt", "The JWT approves a different payload");
  const sub = typeof claims.sub === "string" ? claims.sub : "";

  let d: DecodedDelegate;
  try {
    d = decodeSignableDelegate(Uint8Array.from(req.signPayload));
  } catch (e) {
    return deny("payload", `Not a delegate action we relay: ${(e as Error).message}`);
  }
  if (ctx.sessionAccountId && d.senderId !== ctx.sessionAccountId) return deny("account", "The delegate is not from the signed-in account");
  if (d.maxBlockHeight <= ctx.blockHeight || d.maxBlockHeight > ctx.blockHeight + MAX_DELEGATE_TTL_BLOCKS) {
    return deny("expired", "The delegate's max_block_height is out of range");
  }
  if (d.actions.length !== 1) return deny("action_count", "Exactly one action is relayed");
  const a = d.actions[0]!;
  if (a.kind === "AddKey") {
    const p = a.permission;
    const ok =
      d.receiverId === d.senderId &&
      p.kind === "FunctionCall" &&
      p.receiverId === ctx.contractId &&
      p.allowance !== null &&
      p.allowance <= SESSION_KEY_ALLOWANCE &&
      p.methodNames.every((m) => (RELAY_METHODS as readonly string[]).includes(m)) &&
      a.nonce === 0n;
    return ok ? { ok: true, delegate: d, kind: "add-key", sub } : deny("action", "Only a game session key can be added this way");
  }
  if (a.kind === "FunctionCall") {
    const ok =
      d.receiverId === ctx.contractId &&
      a.deposit === 0n &&
      a.gas > 0n &&
      a.gas <= MAX_RELAY_GAS &&
      (RELAY_METHODS as readonly string[]).includes(a.methodName);
    return ok ? { ok: true, delegate: d, kind: "game-call", sub } : deny("action", "Only allowlisted game calls are relayed");
  }
  return deny("action", "Only game calls and session keys are relayed");
}

/* ------------------------------------------------------------------ relayed `sign` (submission) */

const SIGN_GAS = 300_000_000_000_000n;

export interface FastAuthSignResult {
  txHash: string;
  /** The 64-byte Ed25519 signature, base64. */
  signature: string;
  gasBurnt: bigint;
}

interface TxOutcome {
  transaction_outcome: { id: string; outcome: { gas_burnt: number | string; status: unknown } };
  receipts_outcome: { outcome: { gas_burnt: number | string; status: unknown } }[];
}

/** Pulls the MPC Ed25519 signature out of the `sign` call's receipts. */
export function signatureFromOutcome(outcome: TxOutcome): Uint8Array | null {
  for (const r of [...outcome.receipts_outcome].reverse()) {
    const s = r.outcome.status as { SuccessValue?: string } | null;
    if (!s || typeof s !== "object" || typeof s.SuccessValue !== "string" || !s.SuccessValue) continue;
    try {
      const v = JSON.parse(Buffer.from(s.SuccessValue, "base64").toString("utf8")) as { scheme?: string; signature?: number[] } | null;
      if (v && Array.isArray(v.signature) && v.signature.length === 64) return Uint8Array.from(v.signature);
    } catch {
      // Not the signature receipt.
    }
  }
  return null;
}

/**
 * Sends a transaction and waits until every receipt ran. MPC signing resumes a few
 * blocks later, which can outlast the RPC's own wait, so a timeout falls back to polling.
 * A stale nonce retries with a freshly loaded key.
 */
export async function sendAndWait(
  account: (fresh: boolean) => Account,
  receiverId: string,
  actions: Action[],
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<TxOutcome> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  for (let attempt = 0; attempt < 3; attempt++) {
    const signer = account(attempt > 0);
    const signed = await signer.createSignedTransaction({ receiverId, actions });
    const txHash = baseEncode(createHash("sha256").update(encodeTransaction(signed.transaction)).digest());
    try {
      return (await provider().sendTransactionUntil(signed, "EXECUTED_OPTIMISTIC")) as unknown as TxOutcome;
    } catch (error) {
      if (error instanceof InvalidNonceError) continue;
      if (!(error instanceof TransactionTimeoutError) && !/timeout/i.test(String((error as Error)?.message))) throw error;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, opts.pollMs ?? 1_000));
        try {
          return (await provider().viewTransactionStatus({
            txHash,
            accountId: signer.accountId,
            waitUntil: "EXECUTED_OPTIMISTIC",
          })) as unknown as TxOutcome;
        } catch {
          // Not there yet.
        }
      }
      throw new Error(`Timed out waiting for ${txHash}`);
    }
  }
  throw new Error("Could not get a fresh nonce for the relayer key");
}

/** Calls NEAR Auth's `sign` from the relayer (1 yoctoNEAR, refunded) and returns the MPC signature. */
export async function submitFastAuthSign(req: FastAuthSignRequest, keyHint: string): Promise<FastAuthSignResult> {
  const env = nearAuthEnv();
  const relayer = relayerEnv();
  const key = relayer.privateKeys[relayerKeyIndex(keyHint, relayer.privateKeys.length)]!;
  const action = nearActions.functionCall(
    "sign",
    { guard_id: req.guardId, verify_payload: req.verifyPayload, sign_payload: req.signPayload, algorithm: req.algorithm },
    SIGN_GAS,
    1n,
  );
  const outcome = await sendAndWait(
    (fresh) => (fresh ? freshKeyedAccount(relayer.accountId, key) : keyedAccount(relayer.accountId, key)),
    env.fastAuthContractId,
    [action],
  );
  const signature = signatureFromOutcome(outcome);
  const all = [outcome.transaction_outcome, ...outcome.receipts_outcome];
  const gasBurnt = all.reduce((s, o) => s + BigInt(o.outcome.gas_burnt), 0n);
  if (!signature) throw new Error(`NEAR Auth returned no signature (tx ${outcome.transaction_outcome.id})`);
  return { txHash: outcome.transaction_outcome.id, signature: Buffer.from(signature).toString("base64"), gasBurnt };
}

/** For the lab and the routes: the contract that the configured client resolves to. */
export function nearAuthSummary(): { fastAuthContractId: string; mpcContractId: string; domain: string; contractId: string } {
  const env = nearAuthEnv();
  return { fastAuthContractId: env.fastAuthContractId, mpcContractId: env.mpcContractId, domain: env.domain, contractId: chainEnv().contractId };
}

/** The implicit account id of an ed25519 public key: its 32 bytes in hex. */
export function implicitAccountId(publicKey: string): string {
  return keyToImplicitAddress(publicKey);
}
