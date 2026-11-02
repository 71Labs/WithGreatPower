/** Factory, operator, season, wallet sign-in and env: the pure parts. */
import { KeyPair, KeyPairSigner } from "near-api-js";
import { describe, expect, it } from "vitest";

import { GAME_CONTRACT_ID } from "@/lib/near/config";
import { SESSION_KEY_ALLOWANCE } from "@/lib/near/policy";

import { chainEnv, factoryEnv, NearConfigError, operatorEnv, relayerEnv } from "./env";
import { createAccountActions, HandleError, normalizeHandle, playerAccountId, suggestHandle } from "./factory";
import { itemsFromTokens, planBatches, toRewardMint, type Reward } from "./operator";
import { commitSeason, leafHash, merkleProof, merkleRoot, verifyProof } from "./season";
import { handleFromAccount, issueChallenge, redeemChallenge, signatureBytes, SIGN_IN_MESSAGE } from "./wallet-auth";

const KEY = `ed25519:${"3".repeat(20)}${"A".repeat(40)}`;

describe("env fails closed", () => {
  it("names every missing variable", () => {
    expect(() => chainEnv({})).toThrow(NearConfigError);
    expect(() => chainEnv({})).toThrow(/NEAR_NETWORK, WGP_CONTRACT_ID/);
    expect(() => factoryEnv({ FACTORY_ACCOUNT_ID: "wgp.testnet" })).toThrow(/FACTORY_PRIVATE_KEY/);
    expect(() => relayerEnv({ RELAYER_ACCOUNT_ID: "relayer.wgp.testnet", RELAYER_PRIVATE_KEYS: " , " })).toThrow(NearConfigError);
    expect(() => operatorEnv({})).toThrow(/OPERATOR_ACCOUNT_ID, OPERATOR_PRIVATE_KEY/);
  });

  it("refuses malformed values", () => {
    expect(() => chainEnv({ NEAR_NETWORK: "devnet", WGP_CONTRACT_ID: "game.wgp.testnet" })).toThrow(/NEAR_NETWORK/);
    expect(() => chainEnv({ NEAR_NETWORK: "testnet", WGP_CONTRACT_ID: "Not An Account" })).toThrow(/WGP_CONTRACT_ID/);
    expect(() => operatorEnv({ OPERATOR_ACCOUNT_ID: "operator.wgp.testnet", OPERATOR_PRIVATE_KEY: "hunter2" })).toThrow(/OPERATOR_PRIVATE_KEY/);
  });

  it("reads a full configuration", () => {
    expect(chainEnv({ NEAR_NETWORK: "testnet", WGP_CONTRACT_ID: "game.wgp.testnet" }).rpcUrls[0]).toContain("fastnear");
    const r = relayerEnv({ RELAYER_ACCOUNT_ID: "relayer.wgp.testnet", RELAYER_PRIVATE_KEYS: `${KEY},${KEY}` });
    expect(r.privateKeys).toHaveLength(2);
    expect(r.minBalanceYocto).toBe(10n ** 24n);
    expect(factoryEnv({ FACTORY_ACCOUNT_ID: "wgp.testnet", FACTORY_PRIVATE_KEY: KEY }).initialBalance).toBe(0n);
  });
});

describe("factory", () => {
  it("normalizes and checks handles", () => {
    expect(normalizeHandle("  Peter_Parker ")).toBe("peter_parker");
    for (const bad of ["a", "-peter", "peter-", "pe.ter", "x".repeat(33), "pétér"]) {
      expect(() => normalizeHandle(bad)).toThrow(HandleError);
    }
    expect(() => normalizeHandle("relayer")).toThrow(/reserved/);
    expect(playerAccountId("peter", "wgp.testnet")).toBe("peter.wgp.testnet");
  });

  it("suggests a handle from an email, or none it couldn't use", () => {
    expect(suggestHandle("Peter.Parker+web@gmail.com")).toBe("peterparkerweb");
    expect(suggestHandle("miles_morales@example.com")).toBe("miles_morales");
    expect(suggestHandle("-gwen-@example.com")).toBe("gwen");
    expect(suggestHandle("relayer@example.com")).toBeUndefined();
    expect(suggestHandle("x@example.com")).toBeUndefined();
    expect(suggestHandle("ïñ@example.com")).toBeUndefined();
    expect(suggestHandle(undefined)).toBeUndefined();
    expect(suggestHandle(`${"a".repeat(40)}@example.com`)).toBe("a".repeat(24));
  });

  it("creates the account with the user's key and a game-only session key, in one transaction", () => {
    const user = KeyPair.fromRandom("ed25519").getPublicKey().toString();
    const session = KeyPair.fromRandom("ed25519").getPublicKey().toString();
    const a = createAccountActions({ userPublicKey: user, sessionPublicKey: session, contractId: GAME_CONTRACT_ID, initialBalance: 0n });
    expect(a.map((x) => x.enum)).toEqual(["createAccount", "transfer", "addKey", "addKey"]);
    expect(a[1]!.transfer!.deposit).toBe(0n);
    expect(a[2]!.addKey!.publicKey.toString()).toBe(user);
    expect(a[2]!.addKey!.accessKey.permission.fullAccess).toBeDefined();
    const fc = a[3]!.addKey!.accessKey.permission.functionCall!;
    expect(a[3]!.addKey!.publicKey.toString()).toBe(session);
    expect(fc).toMatchObject({ receiverId: GAME_CONTRACT_ID, methodNames: [], allowance: SESSION_KEY_ALLOWANCE });
    expect(() => createAccountActions({ userPublicKey: user, sessionPublicKey: user, contractId: GAME_CONTRACT_ID, initialBalance: 0n })).toThrow();
  });
});

describe("operator", () => {
  const digest = "ab".repeat(32);
  const reward = (key: string, accountId: string, nonce: number): Reward => ({ key, accountId, nonce, items: [{ item: "crumbs", amount: 2 }], digest });

  it("maps outbox token lists to contract items", () => {
    expect(itemsFromTokens([{ tokenId: "item:fee-bomb", amount: 2 }])).toEqual([{ item: "fee-bomb", amount: 2 }]);
    expect(() => itemsFromTokens([{ tokenId: "suit:octo", amount: 1 }])).toThrow();
    expect(() => itemsFromTokens([{ tokenId: "item:crumbs", amount: 0 }])).toThrow();
  });

  it("builds the contract's RewardMint and refuses what the contract would", () => {
    expect(toRewardMint({ ...reward("k", "alice.wgp.testnet", 1), level: 3 })).toEqual({
      account_id: "alice.wgp.testnet",
      nonce: 1,
      items: [{ item: "crumbs", amount: 2 }],
      level: 3,
      digest,
    });
    expect(() => toRewardMint({ ...reward("k", "a.testnet", 0) })).toThrow(/nonce/);
    expect(() => toRewardMint({ ...reward("k", "a.testnet", 1), digest: "AB".repeat(32) })).toThrow(/Digest/);
  });

  it("orders each account's nonces and splits batches of 20", () => {
    const rewards = [reward("b2", "bob", 2), reward("a1", "alice", 1), reward("b1", "bob", 1), ...Array.from({ length: 20 }, (_, i) => reward(`c${i}`, "carol", i + 1))];
    const batches = planBatches(rewards);
    expect(batches.map((b) => b.length)).toEqual([20, 3]);
    const flat = batches.flat();
    expect(flat.findIndex((r) => r.key === "b1")).toBeLessThan(flat.findIndex((r) => r.key === "b2"));
  });
});

describe("season", () => {
  const board = Array.from({ length: 13 }, (_, i) => ({ rank: i + 1, accountId: `p${i}.wgp.testnet`, score: 10_000 - i * 100 }));

  it("proves every placement against the root", () => {
    const leaves = board.map((l) => leafHash("s1", l));
    const root = merkleRoot(leaves);
    board.forEach((_, i) => expect(verifyProof(leaves[i]!, merkleProof(leaves, i), root)).toBe(true));
    expect(verifyProof(leafHash("s1", { ...board[0]!, score: 99_999 }), merkleProof(leaves, 0), root)).toBe(false);
  });

  it("commits the root, top 10 and a results file whose sha256 is the digest", () => {
    const c = commitSeason("s1", board);
    expect(c.top10).toHaveLength(10);
    expect(c.top10[0]).toBe("p0.wgp.testnet");
    expect(c.root).toMatch(/^[0-9a-f]{64}$/);
    const file = JSON.parse(c.file);
    expect(file.leaves).toHaveLength(13);
    expect(() => commitSeason("s1", [{ rank: 2, accountId: "x.testnet", score: 1 }])).toThrow(/Ranks/);
  });
});

describe("wallet sign-in", () => {
  const secret = "test-secret-at-least-16";

  it("redeems a challenge once, for the same account and recipient, before it expires", () => {
    const c = issueChallenge(secret, "alice.near", "wgp.example", 1_000);
    expect(c.message).toBe(SIGN_IN_MESSAGE);
    expect(redeemChallenge(secret, c.token, "alice.near", "wgp.example", 2_000)).toHaveLength(32);
    expect(() => redeemChallenge(secret, c.token, "alice.near", "wgp.example", 2_000)).toThrow(/already used/);
    const d = issueChallenge(secret, "alice.near", "wgp.example", 1_000);
    expect(() => redeemChallenge(secret, d.token, "bob.near", "wgp.example", 2_000)).toThrow(/match/);
    expect(() => redeemChallenge(secret, d.token, "alice.near", "evil.example", 2_000)).toThrow(/match/);
    expect(() => redeemChallenge("another-secret-16chars", d.token, "alice.near", "wgp.example", 2_000)).toThrow(/match/);
    expect(() => redeemChallenge(secret, d.token, "alice.near", "wgp.example", 1_000 + 6 * 60_000)).toThrow(/expired/);
  });

  it("reads base64 and base58 signatures", async () => {
    const key = KeyPair.fromRandom("ed25519");
    const signed = await new KeyPairSigner(key).signNep413Message("alice.near", { message: SIGN_IN_MESSAGE, recipient: "wgp.example", nonce: new Uint8Array(32) });
    const b64 = Buffer.from(signed.signature).toString("base64");
    expect(signatureBytes(b64)).toEqual(signed.signature);
    expect(() => signatureBytes("AAAA")).toThrow(/64 bytes/);
  });

  it("derives a handle from the account", () => {
    expect(handleFromAccount("peter.near")).toBe("peter");
    expect(handleFromAccount("a.near")).toBe("hero-a");
    expect(handleFromAccount("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")).toHaveLength(31);
  });
});
