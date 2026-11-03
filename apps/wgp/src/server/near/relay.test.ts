import {
  actions,
  buildDelegateAction,
  encodeSignedDelegate,
  KeyPair,
  KeyPairSigner,
  type Action,
} from "near-api-js";
import { describe, expect, it } from "vitest";

import { decodeSignedDelegate, DelegateDecodeError } from "@/lib/near/delegate-codec";
import { SESSION_KEY_ALLOWANCE, TGAS } from "@/lib/near/policy";

import {
  relayerKeyIndex,
  summarizeOutcome,
  toSignedDelegateAction,
  validateAddKeyDelegate,
  validateGameDelegate,
  type AddKeyContext,
  type RelayContext,
} from "./relay";

const GAME = "game.wgp.testnet";
const ALICE = "alice.wgp.testnet";
const HEIGHT = 1_000_000n;

const sessionKey = KeyPair.fromRandom("ed25519");
const userKey = KeyPair.fromRandom("ed25519");
const newDeviceKey = KeyPair.fromRandom("ed25519");

interface Build {
  senderId?: string;
  receiverId?: string;
  actions?: Action[];
  maxBlockHeight?: bigint;
  key?: KeyPair;
}

async function signed(b: Build = {}): Promise<Uint8Array> {
  const key = b.key ?? sessionKey;
  const delegate = buildDelegateAction({
    senderId: b.senderId ?? ALICE,
    receiverId: b.receiverId ?? GAME,
    actions: b.actions ?? [actions.functionCall("register_hero", { name: "Peter", suit: "classic" }, 30n * TGAS, 0n)],
    nonce: 7n,
    maxBlockHeight: b.maxBlockHeight ?? HEIGHT + 120n,
    publicKey: key.getPublicKey(),
  });
  const { signedDelegate } = await new KeyPairSigner(key).signDelegateAction(delegate);
  return encodeSignedDelegate(signedDelegate);
}

function ctx(over: Partial<RelayContext> = {}): RelayContext {
  return {
    contractId: GAME,
    blockHeight: HEIGHT,
    sender: { playerId: "p1", accountId: ALICE, banned: false },
    sessionKey: { playerId: "p1", publicKey: sessionKey.getPublicKey().toString(), revoked: false },
    sessionAccountId: ALICE,
    ...over,
  };
}

async function verdict(b: Build = {}, over: Partial<RelayContext> = {}) {
  return validateGameDelegate(decodeSignedDelegate(await signed(b)), ctx(over));
}

describe("validateGameDelegate", () => {
  it("accepts a session-key call to an allowlisted game method", async () => {
    expect(await verdict()).toEqual({ ok: true, senderId: ALICE, methodName: "register_hero", gas: 30n * TGAS });
  });

  it("rejects the wrong receiver", async () => {
    expect(await verdict({ receiverId: "usdc.fakes.testnet" })).toMatchObject({ ok: false, code: "wrong_receiver" });
  });

  it("rejects a deposit", async () => {
    const a = [actions.functionCall("craft_suit", { suit: "glider" }, 30n * TGAS, 1n)];
    expect(await verdict({ actions: a })).toMatchObject({ ok: false, code: "deposit" });
  });

  it("rejects two actions", async () => {
    const a = [
      actions.functionCall("craft_suit", { suit: "glider" }, 10n * TGAS, 0n),
      actions.functionCall("equip_suit", { suit: "glider" }, 10n * TGAS, 0n),
    ];
    expect(await verdict({ actions: a })).toMatchObject({ ok: false, code: "action_count" });
  });

  it("rejects an unknown sender", async () => {
    expect(await verdict({}, { sender: null })).toMatchObject({ ok: false, status: 403, code: "unknown_sender" });
    expect(await verdict({ senderId: "mallory.testnet" })).toMatchObject({ ok: false, code: "unknown_sender" });
  });

  it("rejects an expired delegate", async () => {
    expect(await verdict({ maxBlockHeight: HEIGHT })).toMatchObject({ ok: false, code: "expired" });
    expect(await verdict({ maxBlockHeight: HEIGHT - 5n })).toMatchObject({ ok: false, code: "expired" });
  });

  it("rejects a delegate that lives too long", async () => {
    expect(await verdict({ maxBlockHeight: HEIGHT + 301n })).toMatchObject({ ok: false, code: "too_far_ahead" });
    expect(await verdict({ maxBlockHeight: HEIGHT + 300n })).toMatchObject({ ok: true });
  });

  it("rejects methods off the allowlist, even ones the key could call", async () => {
    const a = [actions.functionCall("mt_transfer", { receiver_id: "bob.testnet", token_id: "item:crumbs", amount: "1" }, 30n * TGAS, 0n)];
    expect(await verdict({ actions: a })).toMatchObject({ ok: false, code: "method" });
  });

  it("rejects more than 30 Tgas", async () => {
    const a = [actions.functionCall("craft_suit", { suit: "glider" }, 31n * TGAS, 0n)];
    expect(await verdict({ actions: a })).toMatchObject({ ok: false, code: "gas" });
  });

  it("rejects non-call actions", async () => {
    expect(await verdict({ actions: [actions.transfer(1n)] })).toMatchObject({ ok: false, code: "wrong_action" });
  });

  it("rejects args that aren't a JSON object", async () => {
    const a = [actions.functionCall("craft_suit", new TextEncoder().encode("[1,2]"), 10n * TGAS, 0n)];
    expect(await verdict({ actions: a })).toMatchObject({ ok: false, code: "args" });
  });

  it("rejects unknown, foreign and revoked keys", async () => {
    expect(await verdict({}, { sessionKey: null })).toMatchObject({ ok: false, code: "unknown_key" });
    const other = { playerId: "p2", publicKey: sessionKey.getPublicKey().toString(), revoked: false };
    expect(await verdict({}, { sessionKey: other })).toMatchObject({ ok: false, code: "unknown_key" });
    const revoked = { playerId: "p1", publicKey: sessionKey.getPublicKey().toString(), revoked: true };
    expect(await verdict({}, { sessionKey: revoked })).toMatchObject({ ok: false, code: "revoked_key" });
  });

  it("rejects a delegate from another account than the signed-in one", async () => {
    expect(await verdict({}, { sessionAccountId: "bob.wgp.testnet" })).toMatchObject({ ok: false, code: "wrong_account" });
  });

  it("rejects banned players", async () => {
    expect(await verdict({}, { sender: { playerId: "p1", accountId: ALICE, banned: true } })).toMatchObject({ code: "banned" });
  });

  it("rejects a tampered delegate", async () => {
    const bytes = await signed();
    const i = bytes.indexOf("P".charCodeAt(0)); // inside the args: "Peter"
    bytes[i] = "Q".charCodeAt(0);
    expect(validateGameDelegate(decodeSignedDelegate(bytes), ctx())).toMatchObject({ ok: false, status: 401, code: "bad_signature" });
  });
});

describe("validateGameDelegate: Mempool Market calls", () => {
  const market = (method: string, args: Record<string, unknown>, deposit = 0n, gas = 30n * TGAS) => [actions.functionCall(method, args, gas, deposit)];
  const calls: [string, Record<string, unknown>][] = [
    ["market_buy", { item: "crumbs", amount: 3, max_bits: "40" }],
    ["market_sell", { item: "crumbs", amount: 3, min_bits: "30" }],
    ["list_item", { item: "crumbs", amount: 2, price_bits: "24" }],
    ["buy_listing", { listing_id: 7 }],
    ["cancel_listing", { listing_id: 7 }],
  ];

  it("relays every market method from a session key with no deposit", async () => {
    for (const [method, args] of calls) {
      expect(await verdict({ actions: market(method, args) })).toEqual({ ok: true, senderId: ALICE, methodName: method, gas: 30n * TGAS });
    }
  });

  it("still refuses a deposit, even a single yocto", async () => {
    for (const [method, args] of calls) {
      expect(await verdict({ actions: market(method, args, 1n) })).toMatchObject({ ok: false, code: "deposit" });
    }
  });

  it("still refuses other receivers, extra actions, too much gas and unknown keys", async () => {
    const [method, args] = calls[0]!;
    expect(await verdict({ actions: market(method, args), receiverId: "market.fakes.testnet" })).toMatchObject({ code: "wrong_receiver" });
    expect(await verdict({ actions: [...market(method, args), ...market("market_sell", calls[1]![1])] })).toMatchObject({ code: "action_count" });
    expect(await verdict({ actions: market(method, args, 0n, 31n * TGAS) })).toMatchObject({ code: "gas" });
    expect(await verdict({ actions: market(method, args) }, { sessionKey: null })).toMatchObject({ code: "unknown_key" });
    expect(await verdict({ actions: market(method, args) }, { sessionAccountId: "bob.wgp.testnet" })).toMatchObject({ code: "wrong_account" });
  });

  it("keeps owner and transfer methods off the list", async () => {
    for (const method of ["set_market_params", "mt_transfer", "mt_batch_transfer", "mt_transfer_call", "upgrade", "mint_rewards"]) {
      expect(await verdict({ actions: market(method, {}) })).toMatchObject({ ok: false, code: "method" });
    }
  });

  it("refuses oversized market args", async () => {
    expect(await verdict({ actions: market("market_buy", { item: "x".repeat(1100), amount: 1, max_bits: "1" }) })).toMatchObject({ code: "args" });
  });
});

describe("decodeSignedDelegate", () => {
  it("round-trips what near-api-js encodes", async () => {
    const d = decodeSignedDelegate(await signed());
    expect(d.delegate).toMatchObject({ senderId: ALICE, receiverId: GAME, nonce: 7n, maxBlockHeight: HEIGHT + 120n });
    expect(d.delegate.publicKey).toBe(sessionKey.getPublicKey().toString());
    expect(d.signature).toHaveLength(64);
    const action = d.delegate.actions[0]!;
    expect(action.kind).toBe("FunctionCall");
    if (action.kind === "FunctionCall") {
      expect(JSON.parse(new TextDecoder().decode(action.args))).toEqual({ name: "Peter", suit: "classic" });
    }
  });

  it("refuses trailing bytes, truncation and actions we never relay", async () => {
    const bytes = await signed();
    expect(() => decodeSignedDelegate(new Uint8Array([...bytes, 0]))).toThrow(DelegateDecodeError);
    expect(() => decodeSignedDelegate(bytes.slice(0, -1))).toThrow(DelegateDecodeError);
    const deploy = await signed({ actions: [actions.deployContract(new Uint8Array([0, 97, 115, 109]))] });
    expect(() => decodeSignedDelegate(deploy)).toThrow(/Unsupported action: DeployContract/);
    const full = await signed({ actions: [actions.deleteAccount("bob.testnet")] });
    expect(() => decodeSignedDelegate(full)).toThrow(/DeleteAccount/);
  });

  it("refuses secp256k1 keys", async () => {
    const k1 = KeyPair.fromRandom("secp256k1");
    expect(() => decodeSignedDelegate(new Uint8Array(0))).toThrow(DelegateDecodeError);
    await expect(signed({ key: k1 }).then(decodeSignedDelegate)).rejects.toThrow(/ed25519/);
  });
});

describe("validateAddKeyDelegate", () => {
  const addKey = (over: Partial<{ receiver: string; allowance: bigint | undefined; methods: string[]; key: KeyPair }> = {}) =>
    actions.addFunctionCallAccessKey(
      (over.key ?? newDeviceKey).getPublicKey(),
      over.receiver ?? GAME,
      over.methods ?? [],
      "allowance" in over ? over.allowance : SESSION_KEY_ALLOWANCE,
    );

  const addCtx = (over: Partial<AddKeyContext> = {}): AddKeyContext => ({
    contractId: GAME,
    blockHeight: HEIGHT,
    sender: { playerId: "p1", accountId: ALICE, banned: false },
    sessionAccountId: ALICE,
    signerIsFullAccess: true,
    expectedNewKey: newDeviceKey.getPublicKey().toString(),
    ...over,
  });

  const check = async (b: Build, over: Partial<AddKeyContext> = {}) =>
    validateAddKeyDelegate(decodeSignedDelegate(await signed({ key: userKey, receiverId: ALICE, ...b })), addCtx(over));

  it("accepts adding this device's game-only session key", async () => {
    expect(await check({ actions: [addKey()] })).toEqual({ ok: true, senderId: ALICE, newKey: newDeviceKey.getPublicKey().toString() });
  });

  it("refuses keys for other contracts, unlimited allowances and full access", async () => {
    expect(await check({ actions: [addKey({ receiver: "intents.near" })] })).toMatchObject({ code: "wrong_receiver" });
    expect(await check({ actions: [addKey({ allowance: undefined })] })).toMatchObject({ code: "allowance" });
    expect(await check({ actions: [addKey({ allowance: SESSION_KEY_ALLOWANCE + 1n })] })).toMatchObject({ code: "allowance" });
    expect(await check({ actions: [actions.addFullAccessKey(newDeviceKey.getPublicKey())] })).toMatchObject({ code: "wrong_action" });
    expect(await check({ actions: [addKey({ methods: ["mt_transfer"] })] })).toMatchObject({ code: "method" });
  });

  it("refuses another key, another account, or a signer that isn't the owner", async () => {
    expect(await check({ actions: [addKey({ key: KeyPair.fromRandom("ed25519") })] })).toMatchObject({ code: "wrong_key" });
    expect(await check({ actions: [addKey()], receiverId: "bob.wgp.testnet" })).toMatchObject({ code: "wrong_receiver" });
    expect(await check({ actions: [addKey()] }, { signerIsFullAccess: false })).toMatchObject({ code: "wrong_key" });
    expect(await check({ actions: [addKey(), addKey()] })).toMatchObject({ code: "action_count" });
  });
});

describe("submission helpers", () => {
  it("re-encodes the exact signed bytes", async () => {
    const game = decodeSignedDelegate(await signed());
    expect(toSignedDelegateAction(game).signedDelegate).toBeDefined();
    const add = decodeSignedDelegate(
      await signed({
        key: userKey,
        receiverId: ALICE,
        actions: [actions.addFunctionCallAccessKey(newDeviceKey.getPublicKey(), GAME, [], SESSION_KEY_ALLOWANCE)],
      }),
    );
    expect(toSignedDelegateAction(add).signedDelegate).toBeDefined();
  });

  it("picks a stable relayer key per sender", () => {
    const i = relayerKeyIndex(ALICE, 6);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(6);
    expect(relayerKeyIndex(ALICE, 6)).toBe(i);
    const spread = new Set(Array.from({ length: 64 }, (_, n) => relayerKeyIndex(`p${n}.wgp.testnet`, 6)));
    expect(spread.size).toBe(6);
  });

  it("summarizes an outcome: gas, result and the first failure", () => {
    const ok = summarizeOutcome({
      status: { SuccessValue: "" },
      transaction_outcome: { id: "tx1", outcome: { gas_burnt: 1_000, status: { SuccessReceiptId: "r1" } } },
      receipts_outcome: [
        { id: "r1", outcome: { gas_burnt: 2_000, status: { SuccessReceiptId: "r2" } } },
        { id: "r2", outcome: { gas_burnt: 3_000, status: { SuccessValue: Buffer.from('{"name":"Peter"}').toString("base64") } } },
      ],
    });
    expect(ok).toEqual({ txHash: "tx1", ok: true, error: undefined, result: { name: "Peter" }, gasBurnt: 6_000n });
    const failed = summarizeOutcome({
      status: { SuccessValue: "" },
      transaction_outcome: { id: "tx2", outcome: { gas_burnt: 1, status: { SuccessReceiptId: "r1" } } },
      receipts_outcome: [{ id: "r1", outcome: { gas_burnt: 1, status: { Failure: { ActionError: { kind: "x" } } } } }],
    });
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("ActionError");
  });
});
