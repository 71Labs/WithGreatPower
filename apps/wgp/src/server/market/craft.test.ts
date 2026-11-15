/**
 * Crafting's Bits cost on an in-memory database: free while `craft_bits` is 0 (nothing
 * changes), and with it set the save-only craft is refused when the Bits are short, burns
 * them in the simulated market when they aren't, and is refused where only a signed call
 * could burn them. Also the relayer's check before it spends gas, and the dev overrides.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Save } from "@wgp/game-core/types";

import { DEFAULT_PARAMS, seededPools } from "@/lib/market/config";
import { CRAFT_BITS_SHORT, CRAFT_NEEDS_CHAIN } from "@/lib/market/craft";
import { newBook } from "@/lib/market/engine";
import { DEFAULT_INVEST_RULES } from "@/lib/market/invest";

import type { Db } from "../db/client";
import { enqueueRewardMint } from "../db/outbox";
import { ensureSave, writeSave } from "../db/players";
import { marketSim, runs } from "../db/schema";
import { freshDb, givePlayerHero, makePlayer } from "../db/test-helpers";
import { HttpError } from "../http";
import { assertCraftAffordable, craftSuitAction, type CraftChain } from "./craft";
import { readSim, simAct, simParamOverrides, simStateOf, simWallet, SIM_ID, withNewStockPools, type SimState } from "./sim";

vi.mock("next/cache", () => ({ cacheTag: () => {}, cacheLife: () => {}, revalidateTag: () => {} }));

const NOW = new Date("2026-11-12T12:00:00Z");
/** No contract market here: the simulated one stands in. */
const SIM: CraftChain = { market: async () => null, bits: async () => 0 };
const onChain = (craftBits: number, bits: number): CraftChain => ({ market: async () => ({ params: { craftBits } }), bits: async () => bits });

let db: Db;

async function player(handle: string, bits: number, inventory: Save["inventory"], level = 3) {
  const p = await makePlayer(db, handle);
  await givePlayerHero(db, p.id);
  const { save, rev } = await ensureSave(db, p.id);
  await writeSave(db, p.id, { ...save, inventory, hero: { ...save.hero!, level } }, rev);
  if (bits > 0) {
    await db.transaction((tx) =>
      enqueueRewardMint(tx, { kind: "mint_reward", dedupeKey: `mint_reward:${handle}`, playerId: p.id, payload: { accountId: p.nearAccountId, items: [{ tokenId: "item:bits", amount: bits }], digest: "0".repeat(64) } }),
    );
  }
  return { playerId: p.id, accountId: p.nearAccountId };
}

/** Stores the simulated market with a crafting cost, as `set_market_params` would on chain. */
async function setCraftBits(craftBits: number) {
  const state: SimState = { book: newBook({ ...DEFAULT_PARAMS, craftBits }, seededPools()), wallets: {} };
  await db.insert(marketSim).values({ id: SIM_ID, state, rev: 0, updatedAt: NOW });
}

const stored = (who: { playerId: string }) => ensureSave(db, who.playerId);
const bitsOf = async (who: { playerId: string; accountId: string }) => (await simWallet(db, { ...who, now: NOW })).bits;
const craft = async (who: { playerId: string; accountId: string }, suit: "stealth" | "glider" | "snow" = "stealth", chain: CraftChain = SIM) =>
  craftSuitAction(db, { ...who, action: { type: "craft-suit", suit }, rev: (await stored(who)).rev, now: NOW }, chain);

async function refusal(run: Promise<unknown>): Promise<HttpError> {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

beforeEach(async () => {
  db = await freshDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with craft_bits 0 (mainnet today)", () => {
  it("crafts exactly as before: the loot is spent, no Bits move, nothing is stored for the market", async () => {
    const alice = await player("alice", 40, { "sybil-goo": 3 });
    const res = await craft(alice);
    expect(res).toMatchObject({ applied: true, burned: 0 });
    expect(res.save.suits).toContain("stealth");
    expect(res.save.inventory["sybil-goo"] ?? 0).toBe(0);
    expect(await bitsOf(alice)).toBe(40);
    expect((await readSim(db)).craftBurned).toBeUndefined();
  });

  it("is free on the contract's market too, with or without Bits", async () => {
    const alice = await player("alice", 0, { "sybil-goo": 3 });
    expect(await craft(alice, "stealth", onChain(0, 0))).toMatchObject({ applied: true, burned: 0 });
  });
});

describe("with a cost, in the simulated market", () => {
  beforeEach(() => setCraftBits(250));

  it("refuses a craft the contract would refuse, in the contract's words, and leaves the save alone", async () => {
    const alice = await player("alice", 120, { "sybil-goo": 3 });
    const before = await stored(alice);
    const error = await refusal(craft(alice));
    expect(error).toMatchObject({ status: 422, code: CRAFT_BITS_SHORT, message: "Needs bits x130", details: { cost: 250, bits: 120 } });
    expect(await stored(alice)).toEqual(before);
    expect(await bitsOf(alice)).toBe(120);
    expect((await readSim(db)).craftBurned).toBeUndefined();
  });

  it("burns the Bits with the loot when the player can pay, once", async () => {
    const alice = await player("alice", 300, { "sybil-goo": 3, crumbs: 2 });
    const res = await craft(alice);
    expect(res).toMatchObject({ applied: true, burned: 250 });
    expect(res.save.suits).toContain("stealth");
    expect(res.save.hero!.suit).toBe("stealth");
    expect(res.save.inventory).toEqual({ "sybil-goo": 0, crumbs: 2 });
    expect(await stored(alice)).toMatchObject({ save: res.save, rev: res.rev });
    expect(await bitsOf(alice)).toBe(50);
    expect((await readSim(db)).craftBurned).toBe(250);

    // The contract's "You already own this suit": the reducer refuses, and nothing more burns.
    expect(await craft(alice)).toMatchObject({ applied: false, burned: 0 });
    expect(await bitsOf(alice)).toBe(50);
    expect((await readSim(db)).craftBurned).toBe(250);
  });

  it("counts Bits earned and spent in simulated trades, like the market does", async () => {
    const alice = await player("alice", 245, { "sybil-goo": 3, "goblin-glider": 1 });
    await refusal(craft(alice));
    // Selling a glider to Gwei pays about 130 Bits: now the craft goes through.
    await simAct(db, { ...alice, act: { action: "sell", item: "goblin-glider", amount: 1, minBits: 1 }, now: NOW });
    const had = await bitsOf(alice);
    expect(had).toBeGreaterThan(250);
    expect(await craft(alice)).toMatchObject({ applied: true, burned: 250 });
    expect(await bitsOf(alice)).toBe(had - 250);
  });

  it("burns nothing when the loot or the level is missing", async () => {
    const short = await player("short", 400, { "sybil-goo": 2 });
    expect(await craft(short)).toMatchObject({ applied: false, burned: 0 });
    const low = await player("low", 400, { "sybil-goo": 3 }, 1);
    expect(await craft(low)).toMatchObject({ applied: false, burned: 0 });
    // Short of loot and of Bits: the reducer's refusal comes first, as the contract checks ownership and level first.
    const neither = await player("neither", 10, { "sybil-goo": 1 });
    expect(await craft(neither)).toMatchObject({ applied: false, burned: 0 });
    expect(await bitsOf(short)).toBe(400);
    expect(await bitsOf(low)).toBe(400);
    expect((await readSim(db)).craftBurned).toBeUndefined();
  });

  it("keeps starter suits free", async () => {
    const alice = await player("alice", 0, {});
    const res = await craft(alice, "snow");
    expect(res).toMatchObject({ applied: true, burned: 0 });
    expect(res.save.suits).toContain("snow");
  });

  it("burns nothing when the save moved or a ranked run is in flight", async () => {
    const alice = await player("alice", 300, { "sybil-goo": 3 });
    const stale = await refusal(craftSuitAction(db, { ...alice, action: { type: "craft-suit", suit: "stealth" }, rev: 0, now: NOW }, SIM));
    expect(stale).toMatchObject({ status: 409, code: "rev_conflict" });

    const { save, rev } = await stored(alice);
    await db.insert(runs).values({ playerId: alice.playerId, night: 1, seed: 1, ruleset: "t", saveRevAtStart: rev, startSave: save, expiresAt: new Date(NOW.getTime() + 60_000) });
    expect(await refusal(craft(alice))).toMatchObject({ status: 409, code: "run_active" });
    expect(await bitsOf(alice)).toBe(300);
    expect((await stored(alice)).save.suits).not.toContain("stealth");
  });

  it("two crafts at once on 300 Bits: one suit is paid for, the other is refused", async () => {
    const alice = await player("alice", 300, { "sybil-goo": 3, "goblin-glider": 1, "fee-bomb": 2 });
    const rev = (await stored(alice)).rev;
    const both = await Promise.allSettled([
      craftSuitAction(db, { ...alice, action: { type: "craft-suit", suit: "stealth" }, rev, now: NOW }, SIM),
      craftSuitAction(db, { ...alice, action: { type: "craft-suit", suit: "glider" }, rev, now: NOW }, SIM),
    ]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await bitsOf(alice)).toBe(50);
    expect((await readSim(db)).craftBurned).toBe(250);
    const { save } = await stored(alice);
    expect(save.suits.filter((s) => s === "stealth" || s === "glider")).toHaveLength(1);
  });
});

describe("with a cost, on the contract's market", () => {
  it("refuses the save-only craft when the on-chain Bits are short", async () => {
    const alice = await player("alice", 0, { "sybil-goo": 3 });
    const before = await stored(alice);
    expect(await refusal(craft(alice, "stealth", onChain(250, 120)))).toMatchObject({ status: 422, code: CRAFT_BITS_SHORT, message: "Needs bits x130" });
    expect(await stored(alice)).toEqual(before);
  });

  it("refuses it with enough Bits too: only a signed craft_suit can burn them", async () => {
    const alice = await player("alice", 0, { "sybil-goo": 3 });
    const before = await stored(alice);
    const error = await refusal(craft(alice, "stealth", onChain(250, 900)));
    expect(error).toMatchObject({ status: 422, code: CRAFT_NEEDS_CHAIN });
    expect(error.message).toContain("250 Bits");
    expect(await stored(alice)).toEqual(before);
    // Without the loot it's the reducer's refusal, as before the cost existed.
    const bare = await player("bare", 0, {});
    expect(await craft(bare, "stealth", onChain(250, 900))).toMatchObject({ applied: false, burned: 0 });
    // A starter suit still saves: it costs nothing on chain either.
    expect(await craft(alice, "snow", onChain(250, 0))).toMatchObject({ applied: true, burned: 0 });
  });

  it("checks the wallet before the relayer pays for a craft_suit", async () => {
    await expect(assertCraftAffordable({ accountId: "alice.near", suit: "stealth" }, onChain(250, 249))).rejects.toMatchObject({ status: 422, code: CRAFT_BITS_SHORT, message: "Needs bits x1" });
    await expect(assertCraftAffordable({ accountId: "alice.near", suit: "stealth" }, onChain(250, 250))).resolves.toBeUndefined();
    await expect(assertCraftAffordable({ accountId: "alice.near", suit: "stealth" }, onChain(0, 0))).resolves.toBeUndefined();
    await expect(assertCraftAffordable({ accountId: "alice.near", suit: "snow" }, onChain(250, 0))).resolves.toBeUndefined();
    await expect(assertCraftAffordable({ accountId: "alice.near", suit: "stealth" }, SIM)).resolves.toBeUndefined();
  });

  it("lets the call through when the chain can't be read: the contract has the last word", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const down: CraftChain = { market: async () => Promise.reject(new Error("fetch failed")), bits: async () => 0 };
    await expect(assertCraftAffordable({ accountId: "alice.near", suit: "stealth" }, down)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("the simulated market's local overrides", () => {
  it("read craft_bits and the fee from the environment, outside production only", () => {
    expect(simParamOverrides({})).toEqual({});
    expect(simParamOverrides({ SIM_MARKET_CRAFT_BITS: "250", SIM_MARKET_FEE_BPS: "500" })).toEqual({ craftBits: 250, feeBps: 500 });
    expect(simParamOverrides({ NODE_ENV: "production", SIM_MARKET_CRAFT_BITS: "250", SIM_MARKET_FEE_BPS: "500" })).toEqual({});
    // Malformed values and a fee over the contract's 10% cap are ignored.
    expect(simParamOverrides({ SIM_MARKET_CRAFT_BITS: "-5", SIM_MARKET_FEE_BPS: "1001" })).toEqual({});
    expect(simParamOverrides({ SIM_MARKET_CRAFT_BITS: "2.5", SIM_MARKET_FEE_BPS: "abc" })).toEqual({});
    const base: SimState = { book: newBook(DEFAULT_PARAMS, seededPools()), wallets: {} };
    // Nothing overridden: the same market, with the investing rules a sim stored before them lacks.
    expect(simStateOf(base, {})).toEqual({ ...base, book: { ...base.book, pools: withNewStockPools(base.book.pools), params: { ...DEFAULT_PARAMS, invest: DEFAULT_INVEST_RULES } } });
    expect(simStateOf(base, { SIM_MARKET_INVEST_LOCK_MS: "5000" }).book.params.invest).toEqual({ ...DEFAULT_INVEST_RULES, lockMs: 5_000 });
    expect(simStateOf(base, { NODE_ENV: "production", SIM_MARKET_INVEST_LOCK_MS: "5000" }).book.params.invest).toEqual(DEFAULT_INVEST_RULES);
    expect(simStateOf(base, { SIM_MARKET_CRAFT_BITS: "250" }).book.params).toMatchObject({ craftBits: 250, feeBps: DEFAULT_PARAMS.feeBps });
  });

  it("apply to a market that was stored without them, and the craft then costs Bits", async () => {
    const alice = await player("alice", 100, { "sybil-goo": 3 });
    await setCraftBits(0);
    vi.stubEnv("SIM_MARKET_CRAFT_BITS", "250");
    vi.stubEnv("SIM_MARKET_FEE_BPS", "500");
    expect((await readSim(db)).book.params).toMatchObject({ craftBits: 250, feeBps: 500 });
    expect(await refusal(craft(alice))).toMatchObject({ code: CRAFT_BITS_SHORT, message: "Needs bits x150" });
    // The 5% fee is what a trade is charged: selling one Sybil goo burns ceil(5%) of the payout.
    const sold = await simAct(db, { ...alice, act: { action: "sell", item: "sybil-goo", amount: 1, minBits: 1 }, now: NOW });
    const trade = sold.receipt.kind === "trade" ? sold.receipt.trade : null;
    expect(trade).not.toBeNull();
    expect(trade!.fee).toBe(Math.ceil(((trade!.bits + trade!.fee) * 500) / 10_000));
    const [row] = await db.select().from(marketSim).where(eq(marketSim.id, SIM_ID));
    expect((row!.state as SimState).book.params.feeBps).toBe(500);
  });
});
