/**
 * The invite code at sign-in, through each real route (dev, wallet, Privy, NEAR Auth) with only
 * the identity providers and the chain faked: the `wgp_ref` cookie, or the body's `ref` when the
 * cookie is gone, is attached only when that request created the player; an existing player is
 * never re-attached; a bad code never blocks a sign-in; and a finished sign-in drops the cookie.
 */
import { eq } from "drizzle-orm";
import { KeyPair, keyToImplicitAddress } from "near-api-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDb, type Db } from "@/server/db/client";
import { findOrCreatePlayer, getPlayer } from "@/server/db/players";
import { ensureReferralCode } from "@/server/db/referrals";
import { players } from "@/server/db/schema";
import { freshDb, makePlayer } from "@/server/db/test-helpers";
import { rateLimiter } from "@/server/rate-limit";

import type { PrivyIdentity } from "./privy";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (name: string, value: string) => jar.set(name, value) }),
}));

// Wallet: the NEP-413 check (and the on-chain key lookup behind it) passes.
vi.mock("near-api-js/nep413", () => ({ verifyMessage: async () => {} }));

// Privy: the access token's identity is whatever the test says; the factory is closed, so a new
// player lands on their key's implicit account.
const privy = vi.hoisted(() => ({ identity: null as unknown }));
vi.mock("@/server/auth/privy-route", () => ({
  privyRoute: (fn: () => Promise<Response>) => fn(),
  identityFromToken: async () => privy.identity,
  openFactory: async () => null,
}));

// NEAR Auth: the ID token names its subject; nonces, keys and the account factory are faked.
vi.mock("@/server/near/near-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/near/near-auth")>()),
  verifyNearAuthIdToken: async (token: string) => ({ sub: token, nonce: "nonce" }),
  deriveNearAuthPublicKey: async () => KeyPair.fromRandom("ed25519").getPublicKey().toString(),
}));
vi.mock("@/server/near/login-nonce", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/near/login-nonce")>()),
  redeemNearAuthNonce: async () => {},
}));
vi.mock("@/server/near/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/near/env")>()),
  nearAuthEnv: () => ({ fastAuthContractId: "fast-auth.testnet" }),
}));
vi.mock("@/server/near/factory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/near/factory")>()),
  assertHandleAvailable: async (handle: string) => handle,
  createPlayerAccount: async ({ handle }: { handle: string }) => ({ accountId: `${handle}.wgpnear.testnet`, txHash: `tx-${handle}` }),
}));
vi.mock("@/server/near/session-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/near/session-keys")>()),
  addSessionKey: async () => {},
  liveSessionKeys: async () => [],
}));

import { POST as devPost } from "@/app/api/auth/dev/route";
import { POST as nearAuthPost } from "@/app/api/auth/near-auth/route";
import { POST as privyPost } from "@/app/api/auth/privy/route";
import { POST as walletPost } from "@/app/api/auth/wallet/route";

import { attachInviteOnSignIn, readRefCookie, refCookieHeader } from "./referral";

let db: Db;
let code: string;
let otherCode: string;
let seleId: string;

const post = (handler: (r: Request) => Promise<Response>, url: string, body: unknown, ref?: string) =>
  handler(
    new Request(`http://wgp.test${url}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(ref ? { cookie: `wgp_session=old; wgp_ref=${ref}` } : {}) },
      body: JSON.stringify(body),
    }),
  );

const referredBy = async (nearAccountId: string) => {
  const [row] = await db.select({ referredBy: players.referredBy }).from(players).where(eq(players.nearAccountId, nearAccountId));
  return row?.referredBy ?? null;
};

beforeEach(async () => {
  rateLimiter.reset();
  vi.stubEnv("ALLOW_DEV_AUTH", "1");
  vi.stubEnv("NEAR_NETWORK", "testnet");
  vi.stubEnv("WGP_CONTRACT_ID", "game.wgp.testnet");
  db = await freshDb();
  const sele = await makePlayer(db, "sele");
  seleId = sele.id;
  code = await ensureReferralCode(db, sele.id);
  otherCode = await ensureReferralCode(db, (await makePlayer(db, "ana")).id);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setDb(undefined);
  jar.clear();
});

describe("the wgp_ref cookie", () => {
  it("is HttpOnly, Lax, site-wide for 30 days, and Secure in production", () => {
    expect(refCookieHeader("K7Q2M9X", { NODE_ENV: "development" })).toBe("wgp_ref=K7Q2M9X; Max-Age=2592000; Path=/; SameSite=Lax; HttpOnly");
    expect(refCookieHeader("K7Q2M9X", { NODE_ENV: "production" })).toBe("wgp_ref=K7Q2M9X; Max-Age=2592000; Path=/; SameSite=Lax; HttpOnly; Secure");
  });

  it("is read from the request", () => {
    const req = (cookie?: string) => new Request("http://wgp.test", { headers: cookie ? { cookie } : {} });
    expect(readRefCookie(req("a=1; wgp_ref=K7Q2M9X; b=2"))).toBe("K7Q2M9X");
    expect(readRefCookie(req("wgp_ref="))).toBeNull();
    expect(readRefCookie(req("wgp_ref=%E0%A4%A"))).toBeNull();
    expect(readRefCookie(req())).toBeNull();
  });

  it("falls back to the body's code when the cookie's is bad, and never throws", async () => {
    const nora = await makePlayer(db, "nora");
    const req = new Request("http://wgp.test", { headers: { cookie: "wgp_ref=ZZZZZZZ" } });
    expect(await attachInviteOnSignIn(db, req, { playerId: nora.id, created: true, ref: code })).toEqual({ attached: true, referrerId: seleId });
    expect(jar.get("wgp_ref")).toBe("");
    expect(await attachInviteOnSignIn(db, new Request("http://wgp.test"), { playerId: nora.id, created: true })).toBeNull();
  });
});

describe("dev sign-in", () => {
  it("attaches the cookie's code to a new player and drops the cookie", async () => {
    const res = await post(devPost, "/api/auth/dev", { handle: "nora" }, code.toLowerCase());
    expect(res.status).toBe(201);
    expect(await referredBy("nora.dev.wgp.testnet")).toBe(seleId);
    expect(jar.get("wgp_ref")).toBe("");
  });

  it("never re-attaches an existing player, whatever code they bring", async () => {
    await post(devPost, "/api/auth/dev", { handle: "old" });
    jar.clear();
    const res = await post(devPost, "/api/auth/dev", { handle: "old", ref: code }, code);
    expect(res.status).toBe(201);
    expect(await referredBy("old.dev.wgp.testnet")).toBeNull();
    // Its job is done for this browser.
    expect(jar.get("wgp_ref")).toBe("");

    await post(devPost, "/api/auth/dev", { handle: "nora" }, code);
    await post(devPost, "/api/auth/dev", { handle: "nora", ref: otherCode }, otherCode);
    expect(await referredBy("nora.dev.wgp.testnet")).toBe(seleId);
  });

  it("uses the body's ref when the cookie was lost, and signs in anyway with a bad one", async () => {
    expect((await post(devPost, "/api/auth/dev", { handle: "nora", ref: code })).status).toBe(201);
    expect(await referredBy("nora.dev.wgp.testnet")).toBe(seleId);
    expect(jar.has("wgp_ref")).toBe(false);

    expect((await post(devPost, "/api/auth/dev", { handle: "omar", ref: "nope!" }, "ZZZZZZZ")).status).toBe(201);
    expect(await referredBy("omar.dev.wgp.testnet")).toBeNull();
    expect((await post(devPost, "/api/auth/dev", { handle: "pia", ref: null })).status).toBe(201);
  });
});

describe("wallet sign-in", () => {
  const publicKey = KeyPair.fromRandom("ed25519").getPublicKey().toString();
  const signature = Buffer.alloc(64, 7).toString("base64");

  async function signIn(accountId: string, opts: { cookie?: string; ref?: string } = {}) {
    const nonce = await post(walletPost, "/api/auth/wallet", { action: "nonce", accountId });
    const { token } = (await nonce.json()) as { token: string };
    return post(walletPost, "/api/auth/wallet", { action: "verify", accountId, publicKey, signature, token, ...(opts.ref ? { ref: opts.ref } : {}) }, opts.cookie);
  }

  it("attaches on the sign-in that creates the player, and never after", async () => {
    expect((await signIn("nora.testnet", { cookie: code })).status).toBe(200);
    expect(await referredBy("nora.testnet")).toBe(seleId);
    expect(jar.get("wgp_ref")).toBe("");

    expect((await signIn("nora.testnet", { ref: otherCode })).status).toBe(200);
    expect(await referredBy("nora.testnet")).toBe(seleId);

    await makePlayer(db, "old");
    expect((await signIn("old.wgp.testnet", { ref: code })).status).toBe(200);
    expect(await referredBy("old.wgp.testnet")).toBeNull();
  });
});

describe("Privy sign-in", () => {
  function identity(n: number): PrivyIdentity {
    const publicKey = KeyPair.fromRandom("ed25519").getPublicKey().toString();
    return { userId: `did:privy:user${n}`, email: `friend${n}@example.com`, near: { publicKey, implicitAccountId: keyToImplicitAddress(publicKey) } };
  }

  it("attaches the body's code to a new player only", async () => {
    const id = identity(1);
    privy.identity = id;
    const first = await post(privyPost, "/api/auth/privy", { accessToken: "x".repeat(40), ref: code.toLowerCase() });
    expect(first.status).toBe(201);
    expect(await referredBy(id.near!.implicitAccountId)).toBe(seleId);

    const again = await post(privyPost, "/api/auth/privy", { accessToken: "x".repeat(40), ref: otherCode }, otherCode);
    expect(again.status).toBe(200);
    expect(await referredBy(id.near!.implicitAccountId)).toBe(seleId);
    expect(jar.get("wgp_ref")).toBe("");
  });

  it("doesn't attach a returning player found by email", async () => {
    // A player who signed up through NEAR Auth with the same verified email.
    const known = await findOrCreatePlayer(db, { nearAccountId: "mary.wgp.testnet", authKind: "near_auth", authSub: "google|mary", handle: "mary", email: "friend2@example.com" });
    privy.identity = identity(2);
    const res = await post(privyPost, "/api/auth/privy", { accessToken: "x".repeat(40) }, code);
    expect(res.status).toBe(200);
    expect((await getPlayer(db, known.id))!.referredBy).toBeNull();
  });
});

describe("NEAR Auth sign-in", () => {
  const sessionPublicKey = KeyPair.fromRandom("ed25519").getPublicKey().toString();

  it("attaches the cookie's code to the player it creates, and not on a returning sign-in", async () => {
    const created = await post(nearAuthPost, "/api/auth/near-auth", { idToken: "google|nora-0000000000000", handle: "nora", sessionPublicKey }, code);
    expect(created.status).toBe(201);
    expect(await referredBy("nora.wgpnear.testnet")).toBe(seleId);
    expect(jar.get("wgp_ref")).toBe("");

    jar.clear();
    const back = await post(nearAuthPost, "/api/auth/near-auth", { idToken: "google|nora-0000000000000", ref: otherCode }, otherCode);
    expect(back.status).toBe(200);
    expect(await referredBy("nora.wgpnear.testnet")).toBe(seleId);
    expect(jar.get("wgp_ref")).toBe("");
  });

  it("asks for a handle first without touching the cookie, then attaches on the creating post", async () => {
    const ask = await post(nearAuthPost, "/api/auth/near-auth", { idToken: "google|omar-0000000000000" }, code);
    expect(await ask.json()).toMatchObject({ needsHandle: true });
    expect(jar.has("wgp_ref")).toBe(false);
    const made = await post(nearAuthPost, "/api/auth/near-auth", { idToken: "google|omar-0000000000000", handle: "omar", sessionPublicKey, ref: code });
    expect(made.status).toBe(201);
    expect(await referredBy("omar.wgpnear.testnet")).toBe(seleId);
  });
});
