/**
 * The browser signs delegates with a non-extractable WebCrypto Ed25519 key. These check
 * that what it produces is exactly what NEAR (and our relayer) verifies.
 */
import { actions, baseEncode, buildDelegateAction, KeyPair, PublicKey } from "near-api-js";
import { describe, expect, it } from "vitest";

import { validateGameDelegate } from "@/server/near/relay";

import { decodeSignableDelegate, decodeSignedDelegate } from "./delegate-codec";
import { TGAS } from "./policy";
import { signedDelegateFromRequest } from "./near-auth";
import { assembleSignedDelegate, delegateHash, signDelegate, type SessionKey } from "./session-key";

async function webCryptoKey(): Promise<SessionKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    publicKey: `ed25519:${baseEncode(raw)}`,
    accountId: "alice.wgp.testnet",
    storage: "webcrypto",
    sign: async (m) => new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, m as BufferSource)),
  };
}

const delegateFor = (publicKey: string) =>
  buildDelegateAction({
    senderId: "alice.wgp.testnet",
    receiverId: "game.wgp.testnet",
    actions: [actions.functionCall("craft_suit", { suit: "glider" }, 30n * TGAS, 0n)],
    nonce: 12n,
    maxBlockHeight: 1_120n,
    publicKey: PublicKey.fromString(publicKey),
  });

describe("session-key signing", () => {
  it("WebCrypto Ed25519 signs delegates the relayer accepts", async () => {
    const key = await webCryptoKey();
    const bytes = await signDelegate(delegateFor(key.publicKey), key);
    const signed = decodeSignedDelegate(bytes);
    expect(signed.delegate.publicKey).toBe(key.publicKey);
    const verdict = validateGameDelegate(signed, {
      contractId: "game.wgp.testnet",
      blockHeight: 1_000n,
      sender: { playerId: "p1", accountId: "alice.wgp.testnet", banned: false },
      sessionKey: { playerId: "p1", publicKey: key.publicKey, revoked: false },
      sessionAccountId: "alice.wgp.testnet",
    });
    expect(verdict).toMatchObject({ ok: true, methodName: "craft_suit" });
  });

  it("assembles a delegate signed elsewhere (NEAR Auth's MPC)", async () => {
    const mpc = KeyPair.fromRandom("ed25519");
    const delegate = delegateFor(mpc.getPublicKey().toString());
    const signature = mpc.sign(await delegateHash(delegate)).signature;
    const signed = decodeSignedDelegate(assembleSignedDelegate(delegate, signature));
    expect(PublicKey.fromString(signed.delegate.publicKey).verify(await delegateHash(delegate), signed.signature)).toBe(true);
    expect(() => assembleSignedDelegate(delegate, new Uint8Array(10))).toThrow();
  });

  it("decodes the prefixed bytes NEAR Auth puts in fatxn", async () => {
    const key = await webCryptoKey();
    const { encodeDelegateAction } = await import("near-api-js");
    const decoded = decodeSignableDelegate(encodeDelegateAction(delegateFor(key.publicKey)));
    expect(decoded).toMatchObject({ senderId: "alice.wgp.testnet", receiverId: "game.wgp.testnet", nonce: 12n, maxBlockHeight: 1_120n });
  });

  it("rebuilds the signed delegate from a NEAR Auth signature request alone", async () => {
    const { encodeDelegateAction } = await import("near-api-js");
    const mpc = KeyPair.fromRandom("ed25519");
    const delegate = delegateFor(mpc.getPublicKey().toString());
    const signature = mpc.sign(await delegateHash(delegate)).signature;
    const fromRequest = signedDelegateFromRequest(Array.from(encodeDelegateAction(delegate)), signature);
    expect(Array.from(fromRequest)).toEqual(Array.from(assembleSignedDelegate(delegate, signature)));
    expect(() => signedDelegateFromRequest([1, 2, 3, 4, 5], signature)).toThrow(/not a delegate/);
  });
});
