/**
 * Investing, end to end through the route handlers:
 *
 * - POST /api/market/invest on the simulated market: the session, the body's shape, the
 *   rules' refusals in the contract's words, and what it answers;
 * - POST /api/relay/meta with the chain faked as contract v2 and as v3: an investing call
 *   is refused before anything is submitted on v2 (mainnet today) and relayed on v3, while
 *   a trade is relayed on both.
 */
import { actions, buildDelegateAction, encodeSignedDelegate, KeyPair, KeyPairSigner } from "near-api-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_INVEST_RULES } from "@/lib/market/invest";
import { TGAS } from "@/lib/near/policy";
import { issueSession } from "@/server/auth/session";
import { setDb, type Db } from "@/server/db/client";
import { enqueueRewardMint } from "@/server/db/outbox";
import { marketPrices, type Player } from "@/server/db/schema";
import { freshDb, givePlayerHero, makePlayer } from "@/server/db/test-helpers";
import { budgetUsed, utcDay } from "@/server/rate-limit";
import { addSessionKey } from "@/server/near/session-keys";

import { forgetContractVersion } from "./chain";
import { readSim } from "./sim";

vi.mock("next/cache", () => ({ cacheTag: () => {}, cacheLife: () => {}, revalidateTag: () => {} }));

const HEIGHT = 1_000_000n;
const GAME = "game.wgp.testnet";

/** The fake chain: which contract version answers, and every view it was asked. */
const chain = { version: 2 as 2 | 3, live: false, views: [] as string[] };

vi.mock("@/server/near/rpc", () => ({
  provider: () => ({
    viewBlock: async () => ({ header: { height: 1_000_000 } }),
    callFunction: async ({ method }: { method: string }) => {
      chain.views.push(method);
      if (method === "get_version") {
        if (chain.version === 2) throw new Error("wasm execution failed with error: MethodResolveError(MethodNotFound)");
        return { state: 3, contract: "0.3.0", standards: ["nep245"] };
      }
      if (method === "market_state") {
        // `live`: a v2 market with a pool, so the app shows the chain's market. Otherwise none yet, and the simulated one stands in.
        const pool = { item: "crumbs", virtual_bits: "480", virtual_items: "40", bits: "480", stock: "40", escrow: "0" };
        const params = { open: true, fee_bps: 200, floor_bps: 5000, ceiling_bps: 40000, max_amount: 20, max_open_listings: 3, max_listings: 300, daily_trades: 40, daily_listings: 10, daily_fills: 10, daily_fill_bits: "3000", craft_bits: "0" };
        return { vendor: GAME, params, pools: chain.live ? [pool] : [], listings: 0, day: 0 };
      }
      throw new Error(`MethodResolveError(MethodNotFound): ${method}`);
    },
  }),
}));

const submitted = vi.fn();
vi.mock("@/server/near/relay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/near/relay")>()),
  relayerHasFunds: async () => true,
  submitSignedDelegate: (...args: unknown[]) => submitted(...args),
}));

import { POST as invest } from "@/app/api/market/invest/route";
import { POST as relayMeta } from "@/app/api/relay/meta/route";

let db: Db;
let player: Player;
let cookie: string;

async function fund(p: Player, bits: number) {
  await db.transaction((tx) =>
    enqueueRewardMint(tx, { kind: "mint_reward", dedupeKey: `mint_reward:${p.id}`, playerId: p.id, payload: { accountId: p.nearAccountId, items: [{ tokenId: "item:bits", amount: bits }], digest: "0".repeat(64) } }),
  );
}

beforeEach(async () => {
  chain.version = 2;
  chain.live = false;
  chain.views = [];
  submitted.mockReset();
  forgetContractVersion();
  db = await freshDb();
  player = await makePlayer(db, "alice");
  await givePlayerHero(db, player.id);
  await fund(player, 600);
  cookie = `wgp_session=${(await issueSession(db, player.id)).token}`;
});

afterEach(() => {
  vi.unstubAllEnvs();
  setDb(undefined);
});

describe("POST /api/market/invest (the simulated market)", () => {
  const post = (body: unknown, headers: Record<string, string> = { cookie }) =>
    invest(new Request("http://test/api/market/invest", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

  it("needs a session", async () => {
    const res = await post({ action: "invest", item: "crumbs", bits: 100 }, {});
    expect(res.status).toBe(401);
    expect((await readSim(db)).book.investors).toBeUndefined();
  });

  it("refuses a body that isn't one of its three moves", async () => {
    for (const body of [
      { action: "invest", item: "crumbs", bits: -5 },
      { action: "invest", item: "crumbs", bits: 1.5 },
      { action: "invest", item: "gold-bar", bits: 100 },
      { action: "invest", item: "crumbs" },
      { action: "refund", item: "crumbs", bits: 100 },
      { action: "claim" },
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("invests the player's own Bits and answers with the receipt, the wallet and the market after it", async () => {
    const res = await post({ action: "invest", item: "crumbs", bits: 100 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { action: string; bits: number; receipt: { stake: number; bits: number; unlocksAtMs: number }; market: { view: { shops: { item: string; invested: number }[]; params: { invest: unknown } }; me: { bits: number; investor: { stakes: { item: string; bits: number }[]; investsLeft: number } } } };
    expect(body).toMatchObject({ action: "invest", bits: 500, receipt: { item: "crumbs", bits: 100, stake: 100 } });
    expect(body.receipt.unlocksAtMs).toBeGreaterThan(Date.now() + DEFAULT_INVEST_RULES.lockMs - 60_000);
    expect(body.market.me).toMatchObject({ bits: 500, investor: { stakes: [{ item: "crumbs", bits: 100 }], investsLeft: 5 } });
    expect(body.market.view.params.invest).toEqual(DEFAULT_INVEST_RULES);
    expect(body.market.view.shops.find((s) => s.item === "crumbs")).toMatchObject({ invested: 100 });
    const rows = await db.select().from(marketPrices);
    expect(rows.map((r) => [r.kind, r.side, r.onChain, r.bits])).toEqual([["stake", "invest", false, 100]]);
  });

  it("answers a refused rule with 422, its code and the contract's own words", async () => {
    const cases: [unknown, string, string][] = [
      [{ action: "invest", item: "crumbs", bits: 5 }, "invest_amount", "Invest 10 to 500 Bits at a time"],
      [{ action: "invest", item: "crumbs", bits: 480 }, "invest_room", "The vendor can take only 479 more Bits for crumbs"],
      [{ action: "withdraw", item: "crumbs", bits: 10 }, "no_stake", "You have no stake in crumbs"],
      [{ action: "claim", item: "crumbs" }, "no_stake", "You have no stake in crumbs"],
    ];
    for (const [body, code, message] of cases) {
      const res = await post(body);
      expect(res.status, code).toBe(422);
      expect(await res.json()).toMatchObject({ error: code, message });
    }
    await post({ action: "invest", item: "crumbs", bits: 100 });
    const locked = await post({ action: "withdraw", item: "crumbs", bits: 100 });
    expect(locked.status).toBe(422);
    expect(await locked.json()).toMatchObject({ error: "locked", message: "Your stake unlocks in about 60 minutes" });
    const empty = await post({ action: "claim", item: "crumbs" });
    expect(await empty.json()).toMatchObject({ error: "nothing_earned", message: "Nothing earned yet" });
  });

  it("can't invest Bits the player doesn't have", async () => {
    const poor = await makePlayer(db, "bob");
    await givePlayerHero(db, poor.id);
    const res = await post({ action: "invest", item: "crumbs", bits: 50 }, { cookie: `wgp_session=${(await issueSession(db, poor.id)).token}` });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "funds", message: "Needs 50 Bits" });
  });

  it("steps aside once the contract's market is live: 409, and the simulated book is untouched", async () => {
    vi.stubEnv("NEAR_NETWORK", "testnet");
    vi.stubEnv("WGP_CONTRACT_ID", GAME);
    chain.live = true;
    const res = await post({ action: "invest", item: "crumbs", bits: 100 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "on_chain" });
    expect((await readSim(db)).book.investors).toBeUndefined();
    expect(await db.select().from(marketPrices)).toEqual([]);
  });
});

describe("POST /api/relay/meta: investing calls and the contract's version", () => {
  const sessionKey = KeyPair.fromRandom("ed25519");
  let nonce = 7n;

  async function relay(method: string, args: Record<string, unknown>) {
    const delegate = buildDelegateAction({
      senderId: player.nearAccountId,
      receiverId: GAME,
      actions: [actions.functionCall(method, args, 30n * TGAS, 0n)],
      nonce: nonce++,
      maxBlockHeight: HEIGHT + 120n,
      publicKey: sessionKey.getPublicKey(),
    });
    const { signedDelegate } = await new KeyPairSigner(sessionKey).signDelegateAction(delegate);
    return relayMeta(
      new Request("http://test/api/relay/meta", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ signedDelegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64") }),
      }),
    );
  }

  const INVEST_CALLS: [string, Record<string, unknown>][] = [
    ["market_invest", { item: "crumbs", bits: "100" }],
    ["market_withdraw", { item: "crumbs", bits: "100" }],
    ["market_claim", { item: "crumbs" }],
  ];
  const gasUsed = () => budgetUsed(db, { scope: "relay:tgas", key: "global", period: utcDay(new Date()) });

  beforeEach(async () => {
    vi.stubEnv("NEAR_NETWORK", "testnet");
    vi.stubEnv("WGP_CONTRACT_ID", GAME);
    vi.stubEnv("RELAYER_ACCOUNT_ID", "relayer.wgp.testnet");
    vi.stubEnv("RELAYER_PRIVATE_KEYS", KeyPair.fromRandom("ed25519").toString());
    vi.stubEnv("RELAYER_DAILY_TGAS", "100000");
    await addSessionKey(db, { playerId: player.id, publicKey: sessionKey.getPublicKey().toString() });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("on contract v2 refuses every investing call before anything is submitted or any gas is spent", async () => {
    chain.version = 2;
    for (const [method, args] of INVEST_CALLS) {
      const res = await relay(method, args);
      expect(res.status, method).toBe(409);
      expect(await res.json()).toMatchObject({ error: "invest_unsupported", message: "Investing in a merchant is built into contract v3, which isn't live yet" });
    }
    expect(submitted).not.toHaveBeenCalled();
    expect(await gasUsed()).toBe(0);
    // All the contract was asked is its version, once: the answer is remembered.
    expect(chain.views).toEqual(["get_version"]);
    expect(await db.select().from(marketPrices)).toEqual([]);
  });

  it("on contract v2 still relays a trade: the gate is only for investing", async () => {
    chain.version = 2;
    const pool = { item: "crumbs", virtual_bits: "480", virtual_items: "40", bits: "493", stock: "39", escrow: "0" };
    submitted.mockResolvedValue({ txHash: "tx-buy", ok: true, result: { item: "crumbs", amount: 1, bits: "14", fee: "1", pool }, gasBurnt: 3n * TGAS });
    const res = await relay("market_buy", { item: "crumbs", amount: 1, max_bits: "14" });
    expect(res.status).toBe(200);
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(chain.views).not.toContain("get_version");
  });

  it("on contract v3 relays the investing call and records it as history", async () => {
    chain.version = 3;
    const pool = { item: "crumbs", virtual_bits: "380", virtual_items: "40", bits: "580", stock: "40", escrow: "0", invested: "100", rewards: "0", fee_acc: "0", fee_carry: 0 };
    submitted.mockResolvedValue({ txHash: "tx-invest", ok: true, result: { item: "crumbs", bits: "100", earned: "0", stake: "100", unlocks_at_ms: 1_800_000_000_000, pool }, gasBurnt: 3n * TGAS });
    const res = await relay("market_invest", { item: "crumbs", bits: "100" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, txHash: "tx-invest" });
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(await gasUsed()).toBe(3);
    const rows = await db.select().from(marketPrices);
    expect(rows.map((r) => [r.item, r.kind, r.side, r.onChain, r.bits, r.till, r.txHash, r.accountId])).toEqual([["crumbs", "stake", "invest", true, 100, 580, "tx-invest", player.nearAccountId]]);
  });

  it("keeps the owner's refund off the relay on any version", async () => {
    chain.version = 3;
    const res = await relay("market_refund", { item: "crumbs", account_ids: [player.nearAccountId] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "method" });
    expect(submitted).not.toHaveBeenCalled();
  });
});
