/**
 * The relay routes' durable budgets, end to end through the route handlers with the
 * chain faked: the RPC answers a block height, the relayer has funds and every submit
 * lands. A player at their own daily cap must not eat into the relayer's global gas.
 */
import { createSign, generateKeyPairSync } from "node:crypto";

import { actions, buildDelegateAction, encodeDelegateAction, encodeSignedDelegate, KeyPair, KeyPairSigner } from "near-api-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_KEY_ALLOWANCE, TGAS } from "@/lib/near/policy";
import { issueSession } from "@/server/auth/session";
import { setDb, type Db } from "@/server/db/client";
import type { Player } from "@/server/db/schema";
import { freshDb, makePlayer } from "@/server/db/test-helpers";
import { budgetUsed, reserveBudget, utcDay } from "@/server/rate-limit";

import { addSessionKey } from "./session-keys";

const HEIGHT = 1_000_000n;

vi.mock("@/server/near/rpc", () => ({
  provider: () => ({ viewBlock: async () => ({ header: { height: 1_000_000 } }) }),
}));

vi.mock("@/server/near/relay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/near/relay")>()),
  relayerHasFunds: async () => true,
  submitSignedDelegate: async () => ({ txHash: "tx-relay", ok: true, result: null, gasBurnt: 3n * TGAS }),
}));

vi.mock("@/server/near/near-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/near/near-auth")>()),
  submitFastAuthSign: async () => ({ txHash: "tx-sign", signature: Buffer.alloc(64).toString("base64"), gasBurnt: 20n * TGAS }),
}));

import { POST as relayFastAuth } from "@/app/api/relay/fast-auth/route";
import { POST as relayMeta } from "@/app/api/relay/meta/route";

const GAME = "game.wgp.testnet";
const sessionKey = KeyPair.fromRandom("ed25519");
const userKey = KeyPair.fromRandom("ed25519");

const today = () => utcDay(new Date());
const gasUsed = (db: Db) => budgetUsed(db, { scope: "relay:tgas", key: "global", period: today() });

let db: Db;
let player: Player;
let cookie: string;

beforeEach(async () => {
  vi.stubEnv("NEAR_NETWORK", "testnet");
  vi.stubEnv("WGP_CONTRACT_ID", GAME);
  vi.stubEnv("RELAYER_ACCOUNT_ID", "relayer.wgp.testnet");
  vi.stubEnv("RELAYER_PRIVATE_KEYS", KeyPair.fromRandom("ed25519").toString());
  vi.stubEnv("RELAYER_DAILY_TGAS", "100000");
  db = await freshDb();
  player = await makePlayer(db, "alice");
  const { token } = await issueSession(db, player.id);
  cookie = `wgp_session=${token}`;
});

afterEach(() => {
  vi.unstubAllEnvs();
  setDb(undefined);
});

describe("POST /api/relay/meta budgets", () => {
  async function signedDelegate(): Promise<string> {
    const delegate = buildDelegateAction({
      senderId: player.nearAccountId,
      receiverId: GAME,
      actions: [actions.functionCall("register_hero", { name: "Peter", suit: "classic" }, 30n * TGAS, 0n)],
      nonce: 7n,
      maxBlockHeight: HEIGHT + 120n,
      publicKey: sessionKey.getPublicKey(),
    });
    const { signedDelegate } = await new KeyPairSigner(sessionKey).signDelegateAction(delegate);
    return Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64");
  }

  const relay = async () =>
    relayMeta(
      new Request("http://test/api/relay/meta", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ signedDelegate: await signedDelegate() }),
      }),
    );

  beforeEach(async () => {
    await addSessionKey(db, { playerId: player.id, publicKey: sessionKey.getPublicKey().toString() });
  });

  it("charges the global gas budget only what the call burned", async () => {
    const res = await relay();
    expect(res.status).toBe(200);
    expect(await gasUsed(db)).toBe(3);
    expect(await budgetUsed(db, { scope: "relay:calls", key: player.nearAccountId, period: today() })).toBe(1);
  });

  it("gives the reserved gas back when the player is over their daily calls", async () => {
    await reserveBudget(db, { scope: "relay:calls", key: player.nearAccountId, period: today(), limit: 400, amount: 400 });
    for (let i = 0; i < 3; i++) {
      const res = await relay();
      expect(res.status).toBe(429);
      expect(await res.json()).toMatchObject({ error: "budget_exhausted" });
    }
    expect(await gasUsed(db)).toBe(0);
  });
});

describe("POST /api/relay/fast-auth budgets", () => {
  const issuer = "https://login.testnet.fast-auth.com/";
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  function jwt(claims: Record<string, unknown>): string {
    const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })).toString("base64url");
    const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${h}.${p}.${createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey).toString("base64url")}`;
  }

  function signRequest() {
    const signPayload = Array.from(
      encodeDelegateAction(
        buildDelegateAction({
          senderId: player.nearAccountId,
          receiverId: player.nearAccountId,
          actions: [actions.addFunctionCallAccessKey(sessionKey.getPublicKey(), GAME, [], SESSION_KEY_ALLOWANCE)],
          nonce: 1n,
          maxBlockHeight: HEIGHT + 100n,
          publicKey: userKey.getPublicKey(),
        }),
      ),
    );
    const exp = Math.floor(Date.now() / 1000) + 300;
    return {
      guardId: `jwt#${issuer}`,
      algorithm: "eddsa",
      signPayload,
      verifyPayload: jwt({ iss: issuer, aud: "auth0.jwt.fast-auth.testnet", sub: "google-oauth2|1", exp, fatxn: signPayload }),
    };
  }

  const sign = () =>
    relayFastAuth(
      new Request("http://test/api/relay/fast-auth", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(signRequest()),
      }),
    );

  it("charges the global gas budget only what the sign call burned", async () => {
    const res = await sign();
    expect(res.status).toBe(200);
    expect(await gasUsed(db)).toBe(20);
  });

  it("gives the reserved gas back when the player is over their daily signs", async () => {
    await reserveBudget(db, { scope: "relay:fast-auth", key: player.nearAccountId, period: today(), limit: 20, amount: 20 });
    for (let i = 0; i < 3; i++) {
      const res = await sign();
      expect(res.status).toBe(429);
      expect(await res.json()).toMatchObject({ error: "budget_exhausted" });
    }
    expect(await gasUsed(db)).toBe(0);
  });
});
