import { generateKeyPairSync, createSign } from "node:crypto";

import { actions, buildDelegateAction, encodeDelegateAction, KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";

import { SESSION_KEY_ALLOWANCE, TGAS } from "@/lib/near/policy";

import type { NearAuthEnv } from "./env";
import { clearJwksCache, type Jwk } from "./jwt";
import { implicitAccountId, signatureFromOutcome, validateFastAuthSign, verifyNearAuthIdToken, type FastAuthSignRequest } from "./near-auth";

const ENV: NearAuthEnv = {
  fastAuthContractId: "fast-auth.testnet",
  mpcContractId: "v1.signer-prod.testnet",
  domain: "login.testnet.fast-auth.com",
  issuer: "https://login.testnet.fast-auth.com/",
  clientId: "np8paqIpMWmNbzT4xAvOOapZBjsOpptl",
  signingAudience: "auth0.jwt.fast-auth.testnet",
  guardId: "jwt#https://login.testnet.fast-auth.com/",
};
const GAME = "game.wgp.testnet";
const ALICE = "alice.wgp.testnet";
const NOW = 1_800_000_000;
const HEIGHT = 5_000n;

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as Jwk), kid: "k1", alg: "RS256", use: "sig" };
const fetcher = async () => ({ keys: [jwk] });

function jwt(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" }): string {
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const s = createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey).toString("base64url");
  return `${h}.${p}.${s}`;
}

const idClaims = (over: Record<string, unknown> = {}) => ({
  iss: ENV.issuer,
  aud: ENV.clientId,
  sub: "google-oauth2|1234567890",
  iat: NOW - 60,
  exp: NOW + 3600,
  email: "peter@example.com",
  ...over,
});

describe("verifyNearAuthIdToken", () => {
  it("accepts a fresh token from our tenant for our client", async () => {
    clearJwksCache();
    const id = await verifyNearAuthIdToken(jwt(idClaims()), { env: ENV, fetcher, now: NOW });
    expect(id).toEqual({ sub: "google-oauth2|1234567890", email: "peter@example.com" });
  });

  it("refuses forged, foreign, expired and stale tokens", async () => {
    clearJwksCache();
    const cases: [string, RegExp][] = [
      [jwt(idClaims({ aud: "someone-else" })), /audience/],
      [jwt(idClaims({ iss: "https://evil.example/" })), /issuer/],
      [jwt(idClaims({ exp: NOW - 3600 })), /expired/],
      [jwt(idClaims({ iat: NOW - 3 * 3600 })), /too old/],
      [jwt(idClaims(), { alg: "HS256", kid: "k1" }), /RS256/],
      [jwt(idClaims({ sub: "a#b" })), /subject/],
    ];
    for (const [token, error] of cases) {
      await expect(verifyNearAuthIdToken(token, { env: ENV, fetcher, now: NOW })).rejects.toThrow(error);
    }
    const good = jwt(idClaims());
    const tampered = good.replace(/\.[^.]+\./, `.${Buffer.from(JSON.stringify(idClaims({ sub: "google-oauth2|attacker" }))).toString("base64url")}.`);
    await expect(verifyNearAuthIdToken(tampered, { env: ENV, fetcher, now: NOW })).rejects.toThrow(/signature/);
  });
});

describe("validateFastAuthSign", () => {
  const userKey = KeyPair.fromRandom("ed25519");
  const sessionKey = KeyPair.fromRandom("ed25519");

  function payload(a = [actions.addFunctionCallAccessKey(sessionKey.getPublicKey(), GAME, [], SESSION_KEY_ALLOWANCE)], receiverId = ALICE) {
    return Array.from(
      encodeDelegateAction(
        buildDelegateAction({ senderId: ALICE, receiverId, actions: a, nonce: 1n, maxBlockHeight: HEIGHT + 100n, publicKey: userKey.getPublicKey() }),
      ),
    );
  }

  function request(signPayload: number[], claims: Record<string, unknown> = {}): FastAuthSignRequest {
    return {
      guardId: ENV.guardId,
      algorithm: "eddsa",
      signPayload,
      verifyPayload: jwt({ iss: ENV.issuer, aud: ENV.signingAudience, sub: "google-oauth2|1", exp: NOW + 300, fatxn: signPayload, ...claims }),
    };
  }

  const ctx = { env: ENV, contractId: GAME, blockHeight: HEIGHT, sessionAccountId: ALICE, nowSeconds: NOW };

  it("relays adding a game session key and allowlisted game calls", () => {
    expect(validateFastAuthSign(request(payload()), ctx)).toMatchObject({ ok: true, kind: "add-key", sub: "google-oauth2|1" });
    const call = payload([actions.functionCall("craft_suit", { suit: "glider" }, 30n * TGAS, 0n)], GAME);
    expect(validateFastAuthSign(request(call), ctx)).toMatchObject({ ok: true, kind: "game-call" });
  });

  it("refuses another guard, algorithm, audience, an expired JWT or a mismatched fatxn", () => {
    const p = payload();
    expect(validateFastAuthSign({ ...request(p), guardId: "jwt#https://evil/" }, ctx)).toMatchObject({ ok: false, code: "guard" });
    expect(validateFastAuthSign({ ...request(p), algorithm: "ecdsa" }, ctx)).toMatchObject({ ok: false, code: "algorithm" });
    expect(validateFastAuthSign(request(p, { aud: "auth0.jwt.fast-auth.near" }), ctx)).toMatchObject({ ok: false, code: "jwt" });
    expect(validateFastAuthSign(request(p, { exp: NOW - 1 }), ctx)).toMatchObject({ ok: false, code: "jwt" });
    expect(validateFastAuthSign(request(p, { fatxn: [1, 2, 3] }), ctx)).toMatchObject({ ok: false, code: "jwt" });
  });

  it("refuses payloads we would never relay", () => {
    const transfer = payload([actions.transfer(10n ** 24n)], "bob.testnet");
    expect(validateFastAuthSign(request(transfer), ctx)).toMatchObject({ ok: false, code: "action" });
    const fullAccess = payload([actions.addFullAccessKey(sessionKey.getPublicKey())]);
    expect(validateFastAuthSign(request(fullAccess), ctx)).toMatchObject({ ok: false, code: "action" });
    const foreignKey = payload([actions.addFunctionCallAccessKey(sessionKey.getPublicKey(), "intents.near", [], SESSION_KEY_ALLOWANCE)]);
    expect(validateFastAuthSign(request(foreignKey), ctx)).toMatchObject({ ok: false, code: "action" });
    const notDelegate = Array.from(new TextEncoder().encode("hello"));
    expect(validateFastAuthSign(request(notDelegate), ctx)).toMatchObject({ ok: false, code: "payload" });
    expect(validateFastAuthSign(request(payload()), { ...ctx, sessionAccountId: "bob.wgp.testnet" })).toMatchObject({ ok: false, code: "account" });
    expect(validateFastAuthSign(request(payload()), { ...ctx, blockHeight: HEIGHT + 200n })).toMatchObject({ ok: false, code: "expired" });
  });
});

describe("helpers", () => {
  it("reads the MPC signature from the sign call's receipts", () => {
    const sig = Array.from({ length: 64 }, (_, i) => i);
    const value = Buffer.from(JSON.stringify({ scheme: "Ed25519", signature: sig })).toString("base64");
    const outcome = {
      transaction_outcome: { id: "t", outcome: { gas_burnt: 1, status: {} } },
      receipts_outcome: [
        { outcome: { gas_burnt: 1, status: { SuccessValue: value } } },
        { outcome: { gas_burnt: 1, status: { SuccessValue: "" } } },
      ],
    };
    expect(Array.from(signatureFromOutcome(outcome)!)).toEqual(sig);
    expect(signatureFromOutcome({ ...outcome, receipts_outcome: [] })).toBeNull();
  });

  it("computes implicit account ids", () => {
    const key = KeyPair.fromRandom("ed25519").getPublicKey();
    expect(implicitAccountId(key.toString())).toBe(Buffer.from(key.data).toString("hex"));
  });
});
