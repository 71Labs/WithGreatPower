/**
 * A Privy NEAR embedded wallet's key, both ways. Privy's NEAR wallets are ed25519 keys
 * whose address is their implicit account id: the key's 32 bytes in lowercase hex. Our
 * accounts take the key as "ed25519:<base58>". Pure; browser and server.
 */
import { baseDecode, baseEncode } from "near-api-js";

import { isImplicitAccountId } from "../near/policy";

export class NearKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NearKeyError";
  }
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new NearKeyError("Not hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "ed25519:<base58>" for an implicit account id. */
export function implicitToPublicKey(implicitAccountId: string): string {
  if (!isImplicitAccountId(implicitAccountId)) throw new NearKeyError("Not an implicit account id");
  return `ed25519:${baseEncode(hexToBytes(implicitAccountId))}`;
}

/**
 * The 32 key bytes from "ed25519:<base58>", bare base58, or (0x-)hex. Privy reports its
 * NEAR wallets' keys as hex with a leading 00 key-type byte (ed25519), which is dropped.
 * Throws on anything else.
 */
export function publicKeyBytes(raw: string): Uint8Array {
  const value = raw.trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(value)) return hexToBytes(value);
  const flagged = /^(?:0x)?00([0-9a-fA-F]{64})$/.exec(value);
  if (flagged) return hexToBytes(flagged[1]);
  const b58 = value.startsWith("ed25519:") ? value.slice("ed25519:".length) : value;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(b58)) throw new NearKeyError("Not an ed25519 public key");
  let bytes: Uint8Array;
  try {
    bytes = baseDecode(b58);
  } catch {
    throw new NearKeyError("Not an ed25519 public key");
  }
  if (bytes.length !== 32) throw new NearKeyError("Ed25519 public keys are 32 bytes");
  return bytes;
}

export interface NearWalletKey {
  /** "ed25519:<base58>". */
  publicKey: string;
  /** The key's implicit account id (64 lowercase hex). */
  implicitAccountId: string;
}

/**
 * The key of a Privy NEAR wallet from what Privy reports: its address (the implicit
 * account id) and, when present, its public key in whatever encoding. When both are
 * there they must agree.
 */
export function nearKeyFromWallet(wallet: { address?: string | null; publicKey?: string | null }): NearWalletKey {
  const address = wallet.address?.trim().toLowerCase() ?? "";
  const fromAddress = isImplicitAccountId(address) ? address : null;
  const fromKey = wallet.publicKey ? bytesToHex(publicKeyBytes(wallet.publicKey)) : null;
  if (fromAddress && fromKey && fromAddress !== fromKey) throw new NearKeyError("The wallet's address and public key disagree");
  const implicitAccountId = fromAddress ?? fromKey;
  if (!implicitAccountId) throw new NearKeyError("The NEAR wallet has no ed25519 key");
  return { publicKey: implicitToPublicKey(implicitAccountId), implicitAccountId };
}
