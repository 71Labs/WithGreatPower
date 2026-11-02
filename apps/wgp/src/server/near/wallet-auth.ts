/**
 * Sign-in for existing NEAR wallets (near-connect): the server issues a nonce, the
 * wallet signs a NEP-413 message with it, and we check the signature and that the key
 * is a full-access key of the account on chain.
 *
 * Nonces are stateless: 32 random bytes plus an expiry and the account, sealed with an
 * HMAC under AUTH_SECRET. A used nonce is remembered until it expires (per instance;
 * the 5-minute window bounds replays across instances, and replaying only re-signs in
 * the same wallet owner).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { baseDecode } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";

import { isAccountId } from "../../lib/near/policy";
import { provider } from "./rpc";

export const SIGN_IN_MESSAGE = "Sign in to With Great Power";
const NONCE_TTL_MS = 5 * 60_000;

export interface WalletChallenge {
  /** Pass to the wallet as `nonce` (32 bytes, base64). */
  nonce: string;
  message: string;
  recipient: string;
  /** Send back unchanged with the signature. */
  token: string;
  expiresAt: number;
}

function seal(secret: string, parts: string[]): string {
  return createHmac("sha256", secret).update(`wallet-nonce\0${parts.join("\0")}`).digest("base64url");
}

/** A challenge for `accountId` to sign, valid for five minutes. */
export function issueChallenge(secret: string, accountId: string, recipient: string, now = Date.now()): WalletChallenge {
  if (!isAccountId(accountId)) throw new Error("Not a NEAR account id");
  const nonce = randomBytes(32).toString("base64");
  const expiresAt = now + NONCE_TTL_MS;
  const mac = seal(secret, [nonce, String(expiresAt), accountId, recipient]);
  return { nonce, message: SIGN_IN_MESSAGE, recipient, token: `${nonce}.${expiresAt}.${mac}`, expiresAt };
}

const used = new Map<string, number>();

/** Checks a challenge token and burns it. Returns the nonce bytes. Throws on anything wrong. */
export function redeemChallenge(secret: string, token: string, accountId: string, recipient: string, now = Date.now()): Uint8Array {
  const [nonce, exp, mac] = token.split(".");
  if (!nonce || !exp || !mac) throw new Error("Malformed challenge");
  const expected = Buffer.from(seal(secret, [nonce, exp, accountId, recipient]));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error("Challenge does not match");
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < now) throw new Error("Challenge expired");
  for (const [k, at] of used) if (at < now) used.delete(k);
  if (used.has(nonce)) throw new Error("Challenge already used");
  used.set(nonce, expiresAt);
  const bytes = Buffer.from(nonce, "base64");
  if (bytes.length !== 32) throw new Error("Bad nonce");
  return new Uint8Array(bytes);
}

/** Wallets return base64 signatures; some return "ed25519:<base58>". */
export function signatureBytes(signature: string): Uint8Array {
  const raw = signature.startsWith("ed25519:") ? baseDecode(signature.slice(8)) : new Uint8Array(Buffer.from(signature, "base64"));
  if (raw.length !== 64) throw new Error("Signatures are 64 bytes");
  return raw;
}

/** Verifies the NEP-413 signature and that `publicKey` is a full-access key of `accountId`. */
export async function verifyWalletSignature(input: {
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: Uint8Array;
  recipient: string;
}): Promise<void> {
  await verifyMessage({
    signerAccountId: input.accountId,
    signerPublicKey: input.publicKey,
    payload: { message: SIGN_IN_MESSAGE, recipient: input.recipient, nonce: input.nonce },
    signature: signatureBytes(input.signature),
    provider: provider(),
  });
}

/** A handle for a wallet account: its first label, cleaned up. */
export function handleFromAccount(accountId: string): string {
  const first = accountId.split(".")[0] ?? accountId;
  const cleaned = first.replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 31);
  return cleaned.length >= 2 ? cleaned : `hero-${cleaned || "x"}`;
}
