/**
 * Investing in a merchant, on the server:
 *
 * - the simulated market (server-authoritative: the player's own Bits, contract v3's rules,
 *   the book's row lock), from a till going broke to a stake coming home;
 * - a FAKE CHAIN speaking v2 and v3 (a contract stood in by the TypeScript engine, answering
 *   the same views in the contract's JSON): what the app reads from each, and that nothing
 *   on the v2 path ever asks a v3 question or lets an investing call through.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Save } from "@wgp/game-core/types";

import { stakeCall } from "@/lib/market/chain-calls";
import { BITS_TOKEN, DEFAULT_PARAMS, itemToken, seededPools, type InvestRules } from "@/lib/market/config";
import { accountToday, marketBuy, marketInvest, marketSell, MarketError, memoryLedger, newBook, type MarketBook } from "@/lib/market/engine";
import { DEFAULT_INVEST_RULES, investorView, shopsOf } from "@/lib/market/invest";
import { sellQuote, spotMilli, type Pool } from "@/lib/market/math";
import { INVEST_METHODS, MARKET_METHODS, RELAY_METHODS } from "@/lib/near/policy";

import type { Db } from "../db/client";
import { enqueueRewardMint } from "../db/outbox";
import { ensureSave, writeSave } from "../db/players";
import { marketPrices, marketSim, runs } from "../db/schema";
import { freshDb, givePlayerHero, makePlayer } from "../db/test-helpers";
import { HttpError } from "../http";
import { contractVersion, forgetContractVersion, hasInvesting, investingLive, readChainMarket, readChainWallet, VERSION_TTL_MS, type ChainReader } from "./chain";
import { tradedToday } from "./quest";
import { afterInvestRelay, beforeInvestRelay, isInvestMethod, isMarketMethod } from "./relay";
import { readSim, renameSimAccount, simAct, simStake, simWallet, SIM_ID, type SimState } from "./sim";
import { marketSnapshot, marketView } from "./view";

vi.mock("next/cache", () => ({ cacheTag: () => {}, cacheLife: () => {}, revalidateTag: () => {} }));

const NOW = new Date("2026-11-12T12:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);
const HOUR = 3_600_000;

let db: Db;
let alice: { playerId: string; accountId: string };
let bob: { playerId: string; accountId: string };

async function player(handle: string, bits: number, inventory: Save["inventory"]) {
  const p = await makePlayer(db, handle);
  await givePlayerHero(db, p.id);
  const { save, rev } = await ensureSave(db, p.id);
  await writeSave(db, p.id, { ...save, inventory }, rev);
  if (bits > 0) {
    await db.transaction((tx) =>
      enqueueRewardMint(tx, { kind: "mint_reward", dedupeKey: `mint_reward:${handle}`, playerId: p.id, payload: { accountId: p.nearAccountId, items: [{ tokenId: "item:bits", amount: bits }], digest: "0".repeat(64) } }),
    );
  }
  return { playerId: p.id, accountId: p.nearAccountId };
}

const crumbs = async () => (await readSim(db)).book.pools.find((p) => p.item === "crumbs")!;
const shop = async (item = "crumbs") => (await marketView()).shops!.find((s) => s.item === item)!;
const wallet = (p: { playerId: string; accountId: string }, now = NOW) => simWallet(db, { ...p, now });

/** Alice sells crumbs into Gwei until the till can't pay for another. */
async function drain(now = NOW) {
  for (let i = 0; i < 12; i++) {
    const pool = await crumbs();
    let n = 20;
    while (n > 0 && !sellQuote(pool, n, 200)) n -= 1;
    if (n === 0) return;
    await simAct(db, { ...alice, act: { action: "sell", item: "crumbs", amount: n, minBits: 0 }, now });
  }
  throw new Error("the till never ran dry");
}

beforeEach(async () => {
  db = await freshDb();
  forgetContractVersion();
  alice = await player("alice", 50, { crumbs: 200 });
  bob = await player("bob", 600, {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("investing in the simulated market", () => {
  it("offers contract v3's rules, and every stall starts open", async () => {
    const view = await marketView();
    expect(view.onChain).toBe(false);
    expect(view.contract).toBeNull();
    expect(view.params.invest).toEqual(DEFAULT_INVEST_RULES);
    expect(view.shops!.map((s) => s.closed)).toEqual(view.items.map(() => []));
    expect((await wallet(bob)).investor).toEqual({ stakes: [], investsLeft: 6, investBitsLeft: 1_000 });
  });

  it("closes a shop when its till runs dry, and an investment reopens it at the same price", async () => {
    await drain();
    const broke = await shop();
    expect(broke.closed).toEqual(["broke"]);
    expect(broke).toMatchObject({ buying: false, selling: true });
    expect(broke.needs).toBeGreaterThan(0);
    // Gwei refuses the next sale: her till can't pay.
    await expect(simAct(db, { ...alice, act: { action: "sell", item: "crumbs", amount: 1, minBits: 0 }, now: NOW })).rejects.toMatchObject({ code: "till" });

    const before = await crumbs();
    const r = await simStake(db, { ...bob, act: { action: "invest", item: "crumbs", bits: 100 }, now: NOW });
    expect(r).toMatchObject({ action: "invest", bits: 500, receipt: { item: "crumbs", bits: 100, earned: 0, stake: 100, unlocksAtMs: NOW.getTime() + HOUR } });
    const after = await crumbs();
    expect(after.bits).toBe(before.bits + 100);
    expect(spotMilli(after)).toBe(spotMilli(before));
    expect((await shop()).closed).toEqual([]);
    expect(await shop()).toMatchObject({ buying: true, invested: 100, needs: 0 });

    // She buys again, from the till Bob funded.
    const sold = await simAct(db, { ...alice, act: { action: "sell", item: "crumbs", amount: 5, minBits: 0 }, now: NOW });
    expect(sold.receipt).toMatchObject({ kind: "trade", trade: { side: "sell" } });
    expect((await wallet(bob)).investor).toMatchObject({ stakes: [{ item: "crumbs", bits: 100, unlocksAtMs: NOW.getTime() + HOUR, withdrawable: 0 }], investsLeft: 5, investBitsLeft: 900 });
  });

  it("pays the investor a share of that pool's fees, which they can claim, and locks the stake for an hour", async () => {
    await drain();
    await simStake(db, { ...bob, act: { action: "invest", item: "crumbs", bits: 200 }, now: NOW });
    let fees = 0;
    let cuts = 0;
    for (let i = 0; i < 6; i++) {
      const t = await simAct(db, { ...bob, act: { action: "buy", item: "crumbs", amount: 10, maxBits: 10_000 }, now: NOW });
      if (t.receipt.kind !== "trade") throw new Error("expected a trade");
      fees += t.receipt.trade.fee;
      cuts += t.receipt.trade.cut ?? 0;
    }
    expect(cuts).toBe(Math.floor(fees / 2));
    expect(cuts).toBeGreaterThan(0);
    const stake = (await wallet(bob)).investor.stakes[0]!;
    // A sole investor earns the whole cut, less at most a Bit of rounding (which stays owed to the pool).
    const mine = stake.earned;
    expect(cuts - mine).toBeGreaterThanOrEqual(0);
    expect(cuts - mine).toBeLessThanOrEqual(1);

    await expect(simStake(db, { ...bob, act: { action: "withdraw", item: "crumbs", bits: 200 }, now: later(59 * 60_000) })).rejects.toMatchObject({ code: "locked", message: "Your stake unlocks in about 1 minutes" });

    const bitsBefore = (await wallet(bob)).bits;
    const claim = await simStake(db, { ...bob, act: { action: "claim", item: "crumbs" }, now: NOW });
    expect(claim.receipt).toMatchObject({ bits: 0, earned: mine, stake: 200 });
    expect(claim.bits).toBe(bitsBefore + mine);
    await expect(simStake(db, { ...bob, act: { action: "claim", item: "crumbs" }, now: NOW })).rejects.toMatchObject({ code: "nothing_earned" });

    const out = await simStake(db, { ...bob, act: { action: "withdraw", item: "crumbs", bits: 200 }, now: later(HOUR) });
    expect(out.receipt).toMatchObject({ bits: 200, stake: 0 });
    expect(out.bits).toBe(bitsBefore + mine + 200);
    expect((await wallet(bob, later(HOUR))).investor.stakes).toEqual([]);
    expect(await crumbs()).toMatchObject({ invested: 0, rewards: 0 });
  });

  it("makes a stake wait while the till is empty, and never loses it", async () => {
    await drain();
    await simStake(db, { ...bob, act: { action: "invest", item: "crumbs", bits: 60 }, now: NOW });
    // Alice sells more loot into the till Bob funded and takes the Bits.
    await drain();
    const till = (await crumbs()).bits;
    expect(till).toBeLessThan(60);
    await expect(simStake(db, { ...bob, act: { action: "withdraw", item: "crumbs", bits: 60 }, now: later(2 * HOUR) })).rejects.toMatchObject({
      code: "till_short",
      message: `The till can pay back only ${till} Bits right now; it refills as players buy crumbs`,
    });
    expect((await wallet(bob, later(2 * HOUR))).investor.stakes[0]).toMatchObject({ bits: 60, withdrawable: till });
    // Someone buys that stock: the Bits are back, and so is the stake.
    for (let i = 0; i < 6 && (await crumbs()).bits < 60; i++) await simAct(db, { ...bob, act: { action: "buy", item: "crumbs", amount: 20, maxBits: 10_000 }, now: later(2 * HOUR) });
    const out = await simStake(db, { ...bob, act: { action: "withdraw", item: "crumbs", bits: 60 }, now: later(2 * HOUR) });
    expect(out.receipt.bits).toBe(60);
  });

  it("is the player's own Bits, checked by the server: no Bits, no stake", async () => {
    await expect(simStake(db, { ...alice, act: { action: "invest", item: "crumbs", bits: 80 }, now: NOW })).rejects.toMatchObject({ code: "funds", message: "Needs 80 Bits" });
    await expect(simStake(db, { ...bob, act: { action: "invest", item: "crumbs", bits: 5 }, now: NOW })).rejects.toMatchObject({ code: "invest_amount" });
    await expect(simStake(db, { ...bob, act: { action: "invest", item: "crumbs", bits: 480 }, now: NOW })).rejects.toMatchObject({ code: "invest_room" });
    await expect(simStake(db, { ...bob, act: { action: "withdraw", item: "crumbs", bits: 10 }, now: NOW })).rejects.toMatchObject({ code: "no_stake" });
    expect((await wallet(bob)).bits).toBe(600);
    expect(await db.select().from(marketPrices)).toEqual([]);
    // What a player holds is Bits plus stakes, to the Bit.
    await simStake(db, { ...bob, act: { action: "invest", item: "crumbs", bits: 250 }, now: NOW });
    const w = await wallet(bob);
    expect(w.bits + w.investor.stakes.reduce((s, st) => s + st.bits, 0)).toBe(600);
  });

  it("writes no save and no trade: a stake is a ledger entry, and it doesn't count for the daily quest", async () => {
    const before = await ensureSave(db, bob.playerId);
    await simStake(db, { ...bob, act: { action: "invest", item: "sybil-goo", bits: 100 }, now: NOW });
    const after = await ensureSave(db, bob.playerId);
    expect(after.rev).toBe(before.rev);
    expect(after.save).toEqual(before.save);
    const rows = await db.select().from(marketPrices);
    expect(rows.map((r) => [r.item, r.kind, r.side, r.onChain, r.bits, r.accountId])).toEqual([["sybil-goo", "stake", "invest", false, 100, bob.accountId]]);
    expect(await tradedToday(db, bob.accountId, NOW)).toBe(false);
    expect((await marketView()).items.find((i) => i.item === "sybil-goo")!.trades24h).toBe(0);
  });

  it("waits while a ranked run is in flight, like a trade", async () => {
    const { save, rev } = await ensureSave(db, bob.playerId);
    await db.insert(runs).values({ playerId: bob.playerId, night: 1, seed: 1, ruleset: "t", saveRevAtStart: rev, startSave: save, expiresAt: new Date(NOW.getTime() + 60_000) });
    const err = await simStake(db, { ...bob, act: { action: "invest", item: "crumbs", bits: 50 }, now: NOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe("run_active");
  });

  it("answers a stake with the market as it stands, the investor's stakes included", async () => {
    await simStake(db, { ...bob, act: { action: "invest", item: "crumbs", bits: 100 }, now: NOW });
    const snap = await marketSnapshot(bob);
    expect(snap.me.investor?.stakes.map((s) => [s.item, s.bits])).toEqual([["crumbs", 100]]);
    expect(snap.view.shops!.find((s) => s.item === "crumbs")).toMatchObject({ invested: 100, investRoom: 379 });
    expect(snap.view.items.find((i) => i.item === "crumbs")!.pool).toMatchObject({ invested: 100, virtualBits: 380 });
  });

  it("moves a player's stakes with them when they claim a name", async () => {
    await simStake(db, { ...bob, act: { action: "invest", item: "crumbs", bits: 100 }, now: NOW });
    const [row] = await db.select().from(marketSim).where(eq(marketSim.id, SIM_ID));
    const moved = renameSimAccount(row!.state as SimState, bob.accountId, "bobby.wgpnear.near");
    expect(moved.book.investors?.[bob.accountId]).toBeUndefined();
    expect(moved.book.investors?.["bobby.wgpnear.near"]?.stakes.map((s) => [s.item, s.bits])).toEqual([["crumbs", 100]]);
    expect(moved.wallets["bobby.wgpnear.near"]).toBe(-100);
  });

  it("takes a shorter lock from the environment for local play, never in production", async () => {
    vi.stubEnv("SIM_MARKET_INVEST_LOCK_MS", "5000");
    const r = await simStake(db, { ...bob, act: { action: "invest", item: "crumbs", bits: 50 }, now: NOW });
    expect(r.receipt.unlocksAtMs).toBe(NOW.getTime() + 5_000);
    await expect(simStake(db, { ...bob, act: { action: "withdraw", item: "crumbs", bits: 50 }, now: later(4_000) })).rejects.toMatchObject({ code: "locked" });
    expect((await simStake(db, { ...bob, act: { action: "withdraw", item: "crumbs", bits: 50 }, now: later(5_000) })).receipt.stake).toBe(0);
  });
});

/* ------------------------------------------------------------------ a fake chain, speaking v2 or v3 */

const ACCOUNT = "alice.wgpnear.near";
const T0 = NOW.getTime();

const rawPool = (p: Pool, v3: boolean) => ({
  item: p.item,
  virtual_bits: String(p.virtualBits),
  virtual_items: String(p.virtualItems),
  bits: String(p.bits),
  stock: String(p.stock),
  escrow: String(p.escrow),
  ...(v3 ? { invested: String(p.invested ?? 0), rewards: String(p.rewards ?? 0), fee_acc: p.feeAcc ?? "0", fee_carry: p.feeCarry ?? 0 } : {}),
});

/**
 * A game contract stood in by the TypeScript engine. `version` 2 answers as mainnet does
 * today: no `get_version`, no investing views, v2-shaped state. 3 answers as contract v3.
 * `calls` records every view asked, so a test can check what was never asked.
 */
function fakeChain(version: 2 | 3, rules: InvestRules = { ...DEFAULT_INVEST_RULES, lockMs: 0 }) {
  const book: MarketBook = newBook({ ...DEFAULT_PARAMS, dailyTrades: 10_000, ...(version === 3 ? { invest: rules } : {}) }, seededPools());
  const ledger = memoryLedger({ [ACCOUNT]: { [BITS_TOKEN]: 2_000, [itemToken("crumbs")]: 400 } });
  const state = { version: version as 2 | 3, down: false };
  const calls: string[] = [];
  const notFound = (method: string) => new Error(`[-32000] Server error: wasm execution failed with error: MethodResolveError(MethodNotFound) (${method})`);
  const reader: ChainReader = {
    contractId: "game.wgpnear.near",
    network: "mainnet",
    async view(method, args = {}) {
      calls.push(method);
      if (state.down) throw new Error("fetch failed");
      const v3 = state.version === 3;
      const p = book.params;
      switch (method) {
        case "get_version":
          if (!v3) throw notFound(method);
          return { state: 3, contract: "0.3.0", standards: ["nep245", "nep297", "nep330"] };
        case "market_state":
          return {
            vendor: "game.wgpnear.near",
            params: {
              open: p.open,
              fee_bps: p.feeBps,
              floor_bps: p.floorBps,
              ceiling_bps: p.ceilingBps,
              max_amount: p.maxAmount,
              max_open_listings: p.maxOpenListings,
              max_listings: p.maxListings,
              daily_trades: p.dailyTrades,
              daily_listings: p.dailyListings,
              daily_fills: p.dailyFills,
              daily_fill_bits: String(p.dailyFillBits),
              craft_bits: String(p.craftBits),
              ...(v3
                ? { invest_open: rules.open, invest_fee_bps: rules.feeBps, min_invest: String(rules.min), max_invest: String(rules.max), daily_invests: rules.dailyInvests, daily_invest_bits: String(rules.dailyBits), invest_lock_ms: rules.lockMs }
                : {}),
            },
            pools: book.pools.map((q) => rawPool(q, v3)),
            listings: 0,
            day: Math.floor(T0 / 86_400_000),
            prices_milli: book.pools.map((q) => String(spotMilli(q))),
          };
        case "market_shops":
          if (!v3) throw notFound(method);
          return shopsOf(book.pools, p.open).map((s) => ({
            item: s.item,
            price_milli: String(s.priceMilli),
            closed: s.closed,
            buying: s.buying,
            selling: s.selling,
            till: String(s.till),
            needs: String(s.needs),
            invested: String(s.invested),
            invest_room: String(s.investRoom),
            rewards: String(s.rewards),
          }));
        case "market_investor": {
          if (!v3) throw notFound(method);
          const view = investorView(rules, book.pools, book.investors?.[args.account_id as string], T0);
          return {
            stakes: view.stakes.map((s) => ({ item: s.item, bits: String(s.bits), earned: String(s.earned), unlocks_at_ms: s.unlocksAtMs, withdrawable: String(s.withdrawable) })),
            invests_left: view.investsLeft,
            invest_bits_left: String(view.investBitsLeft),
          };
        }
        case "market_account": {
          const a = accountToday(book, args.account_id as string, T0);
          return { bits: String(ledger.balance(args.account_id as string, BITS_TOKEN)), trades_left: p.dailyTrades - a.trades, listings_left: 10, fills_left: 10, fill_bits_left: "3000", open: [] };
        }
        case "mt_batch_balance_of":
          return (args.token_ids as string[]).map((t) => String(ledger.balance(args.account_id as string, t)));
        default:
          throw notFound(method);
      }
    },
  };
  /** A v3 call's JSON return value, as the relayer hands it to the after-hook. */
  const receipt = (r: ReturnType<typeof marketInvest>) => ({ item: r.item, bits: String(r.bits), earned: String(r.earned), stake: String(r.stake), unlocks_at_ms: r.unlocksAtMs, pool: rawPool(r.pool, true) });
  return { book, ledger, reader, calls, state, receipt };
}

function drainFake(chain: ReturnType<typeof fakeChain>) {
  const pool = () => chain.book.pools.find((p) => p.item === "crumbs")!;
  for (let i = 0; i < 2_000 && sellQuote(pool(), 1, 200); i++) marketSell(chain.book, chain.ledger, ACCOUNT, "crumbs", 1, 0, T0);
}

describe("a v2 contract (mainnet today)", () => {
  it("is read as a market with no investing, and is never asked a v3 question twice", async () => {
    const chain = fakeChain(2);
    const market = (await readChainMarket(chain.reader))!;
    expect(market.contract).toEqual({ state: 2, version: null });
    expect(market.params.invest).toBeUndefined();
    expect(market.shops).toBeUndefined();
    expect(market.pools[0]).not.toHaveProperty("invested");
    const w = await readChainWallet(ACCOUNT, chain.reader);
    expect(w).not.toHaveProperty("investor");
    expect(w.bits).toBe(2_000);
    await readChainMarket(chain.reader);
    await readChainWallet(ACCOUNT, chain.reader);
    // `get_version` once (remembered); the investing views never.
    expect(chain.calls.filter((c) => c === "get_version")).toHaveLength(1);
    expect(chain.calls).not.toContain("market_shops");
    expect(chain.calls).not.toContain("market_investor");
  });

  it("still shows a broke shop and its reason, worked out from the pool", async () => {
    const chain = fakeChain(2);
    drainFake(chain);
    const market = (await readChainMarket(chain.reader))!;
    const crumbsShop = shopsOf(market.pools, market.params.open).find((s) => s.item === "crumbs")!;
    expect(crumbsShop.closed).toEqual(["broke"]);
    expect(crumbsShop.buying).toBe(false);
  });

  it("refuses an investing call before anything is sent", async () => {
    const chain = fakeChain(2);
    expect(await investingLive(chain.reader)).toBe(false);
    for (let i = 0; i < 3; i++) {
      const err = await beforeInvestRelay(db, alice.playerId, chain.reader).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect(err).toMatchObject({ status: 409, code: "invest_unsupported" });
    }
    // The only thing the contract was asked is its version, once.
    expect(chain.calls).toEqual(["get_version"]);
  });

  it("is treated as v2 when the version can't be read, without remembering that", async () => {
    const chain = fakeChain(3);
    chain.state.down = true;
    expect(await contractVersion(chain.reader)).toEqual({ state: 2, version: null });
    expect(await investingLive(chain.reader)).toBe(false);
    chain.state.down = false;
    expect(await investingLive(chain.reader)).toBe(true);
  });

  it("is noticed as v3 after an upgrade, once the remembered answer is five minutes old", async () => {
    const chain = fakeChain(2);
    expect(hasInvesting(await contractVersion(chain.reader, 1_000))).toBe(false);
    chain.state.version = 3;
    expect(hasInvesting(await contractVersion(chain.reader, 1_000 + VERSION_TTL_MS - 1))).toBe(false);
    expect(await contractVersion(chain.reader, 1_000 + VERSION_TTL_MS)).toEqual({ state: 3, version: "0.3.0" });
  });
});

describe("a v3 contract", () => {
  it("is read with its investing rules, its stalls and the player's stakes", async () => {
    const chain = fakeChain(3);
    drainFake(chain);
    let market = (await readChainMarket(chain.reader))!;
    expect(market.contract).toEqual({ state: 3, version: "0.3.0" });
    expect(market.params.invest).toEqual({ ...DEFAULT_INVEST_RULES, lockMs: 0 });
    expect(market.shops!.find((s) => s.item === "crumbs")).toMatchObject({ closed: ["broke"], buying: false, invested: 0, investRoom: 479 });

    const r = marketInvest(chain.book, chain.ledger, ACCOUNT, "crumbs", 150, T0);
    market = (await readChainMarket(chain.reader))!;
    expect(market.shops!.find((s) => s.item === "crumbs")).toMatchObject({ closed: [], buying: true, invested: 150, investRoom: 329 });
    expect(market.pools.find((p) => p.item === "crumbs")).toMatchObject({ invested: 150, rewards: 0, feeAcc: "0", feeCarry: 0, virtualBits: 330 });

    for (let i = 0; i < 4; i++) marketBuy(chain.book, chain.ledger, ACCOUNT, "crumbs", 10, 1e9, T0);
    const w = await readChainWallet(ACCOUNT, chain.reader);
    expect(w.investor!.stakes).toMatchObject([{ item: "crumbs", bits: 150, unlocksAtMs: r.unlocksAtMs, withdrawable: 150 }]);
    expect(w.investor!.stakes[0]!.earned).toBeLessThanOrEqual(chain.book.pools.find((p) => p.item === "crumbs")!.rewards!);
    expect(w.investor!.stakes[0]!.earned).toBeGreaterThan(0);
    expect(w.investor).toMatchObject({ investsLeft: 5, investBitsLeft: 850 });
  });

  it("lets an investing call through the relayer's gate and records it as history", async () => {
    const chain = fakeChain(3);
    await expect(beforeInvestRelay(db, alice.playerId, chain.reader)).resolves.toBeUndefined();
    const r = marketInvest(chain.book, chain.ledger, ACCOUNT, "crumbs", 150, T0);
    expect(await afterInvestRelay(db, { playerId: alice.playerId, accountId: ACCOUNT, method: "market_invest", result: chain.receipt(r), txHash: "tx-invest" }, NOW)).toBe(true);
    const [row] = await db.select().from(marketPrices).where(and(eq(marketPrices.kind, "stake"), eq(marketPrices.onChain, true)));
    expect(row).toMatchObject({ item: "crumbs", side: "invest", bits: 150, fee: 0, till: 630, accountId: ACCOUNT, txHash: "tx-invest" });
    // A return value that isn't a receipt is logged and dropped, never thrown.
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await afterInvestRelay(db, { playerId: alice.playerId, accountId: ACCOUNT, method: "market_claim", result: { nope: true }, txHash: "tx2" }, NOW)).toBe(false);
  });

  it("still refuses the investing call while a ranked run is in flight", async () => {
    const chain = fakeChain(3);
    const { save, rev } = await ensureSave(db, alice.playerId);
    await db.insert(runs).values({ playerId: alice.playerId, night: 1, seed: 1, ruleset: "t", saveRevAtStart: rev, startSave: save, expiresAt: new Date(Date.now() + 60_000) });
    await expect(beforeInvestRelay(db, alice.playerId, chain.reader)).rejects.toMatchObject({ code: "run_active" });
  });

  it("with investing switched off (as it arrives after an upgrade) still reads as v3, closed to new stakes", async () => {
    const chain = fakeChain(3, { ...DEFAULT_INVEST_RULES, open: false });
    const market = (await readChainMarket(chain.reader))!;
    expect(market.params.invest?.open).toBe(false);
    expect(() => marketInvest(chain.book, chain.ledger, ACCOUNT, "crumbs", 50, T0)).toThrow(MarketError);
  });
});

describe("the relayer's allow-list", () => {
  it("carries the three investing methods, apart from the trading ones the NPC may use", () => {
    expect([...INVEST_METHODS]).toEqual(["market_invest", "market_withdraw", "market_claim"]);
    for (const m of INVEST_METHODS) {
      expect(RELAY_METHODS).toContain(m);
      expect(isInvestMethod(m)).toBe(true);
      expect(isMarketMethod(m)).toBe(false);
      expect(MARKET_METHODS as readonly string[]).not.toContain(m);
    }
    expect(isInvestMethod("market_refund")).toBe(false);
    expect(RELAY_METHODS as readonly string[]).not.toContain("market_refund");
  });

  it("builds contract v3's calls: amounts as decimal strings, no deposit to attach", () => {
    expect(stakeCall({ action: "invest", item: "crumbs", bits: 120 })).toEqual({ method: "market_invest", args: { item: "crumbs", bits: "120" } });
    expect(stakeCall({ action: "withdraw", item: "crumbs", bits: 40 })).toEqual({ method: "market_withdraw", args: { item: "crumbs", bits: "40" } });
    expect(stakeCall({ action: "claim", item: "crumbs" })).toEqual({ method: "market_claim", args: { item: "crumbs" } });
  });
});
