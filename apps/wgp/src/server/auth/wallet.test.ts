/**
 * POST /api/auth/wallet as an attacker would try it, with the on-chain signature check
 * faked (it passes): a cross-site form post, and a signed challenge replayed on another
 * server instance.
 */
import { KeyPair } from "near-api-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDb } from "@/server/db/client";
import { freshDb } from "@/server/db/test-helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (name: string, value: string) => jar.set(name, value) }),
}));

// The NEP-413 check reads the key from chain; here every signature is good.
vi.mock("near-api-js/nep413", () => ({ verifyMessage: async () => {} }));

import { POST } from "@/app/api/auth/wallet/route";

const URL = "http://wgp.test/api/auth/wallet";
const ALICE = "alice.near";
const publicKey = KeyPair.fromRandom("ed25519").getPublicKey().toString();
const signature = Buffer.alloc(64, 7).toString("base64");

const post = (handler: typeof POST, body: unknown, type = "application/json") =>
  handler(new Request(URL, { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) }));

async function challenge(): Promise<{ token: string }> {
  const res = await post(POST, { action: "nonce", accountId: ALICE });
  expect(res.status).toBe(200);
  return (await res.json()) as { token: string };
}

const verify = (token: string) => ({ action: "verify", accountId: ALICE, publicKey, signature, token });

describe("wallet sign-in", () => {
  beforeEach(async () => {
    vi.stubEnv("NEAR_NETWORK", "testnet");
    vi.stubEnv("WGP_CONTRACT_ID", "game.wgp.testnet");
    await freshDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setDb(undefined);
    jar.clear();
  });

  it("signs in with a JSON post", async () => {
    const { token } = await challenge();
    const res = await post(POST, verify(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accountId: ALICE });
    expect(jar.get("wgp_session")).toBeTruthy();
  });

  it("refuses a form post, so another site can't sign a visitor in to its own account", async () => {
    const { token } = await challenge();
    // What a cross-site <form enctype="text/plain"> sends, without a CORS preflight.
    const res = await post(POST, verify(token), "text/plain");
    expect(res.status).toBe(415);
    expect(jar.size).toBe(0);
  });

  it("refuses a signed challenge replayed on another server instance", async () => {
    const { token } = await challenge();
    expect((await post(POST, verify(token))).status).toBe(200);
    jar.clear();

    // A fresh module is what another serverless instance runs: nothing in its memory.
    vi.resetModules();
    const { POST: otherInstance } = await import("@/app/api/auth/wallet/route");
    const replay = await post(otherInstance, verify(token));
    expect(replay.status).toBe(401);
    expect(jar.size).toBe(0);
  });
});
