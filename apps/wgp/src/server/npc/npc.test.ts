/**
 * Sandwich Man's runner on an in-memory database: in the simulated market (a player lists
 * cheap, he buys it, then sells it on; idempotent, rate-limited, one action a look), and
 * against a fake chain (off when unconfigured; signs only market calls; a refusal is
 * booked, not retried in a loop).
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Save } from "@wgp/game-core/types";

import { DEFAULT_PARAMS, seededPools } from "@/lib/market/config";
import type { Listing } from "@/lib/market/engine";
import { NPC_RULES, type NpcAction } from "@/lib/market/npc-rules";
import { MARKET_METHODS } from "@/lib/near/policy";

import type { Db } from "../db/client";
import { enqueueRewardMint } from "../db/outbox";
import { ensureSave, writeSave } from "../db/players";
import { marketPrices, marketSim } from "../db/schema";
import { freshDb, givePlayerHero, makePlayer } from "../db/test-helpers";
import type { ChainMarket, ChainWallet } from "../market/chain";
import { readSim, simAct, simWallet } from "../market/sim";
import { npcCall, outcomeOf } from "./chain";
import { NPC_SIM_ACCOUNT, npcTraderAccount, npcTraderEnv } from "./env";
import { MIN_GAP_MS, runNpcTrader, type NpcChain } from "./runner";
import { LEASE_MS, readNpcState } from "./store";
import { buildNpcView } from "./view";

vi.mock("next/cache", () => ({ cacheTag: () => {}, cacheLife: () => {}, revalidateTag: () => {} }));

const NOW = new Date("2026-11-12T12:00:00Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1_000);

let db: Db;
let alice: { playerId: string; accountId: string };

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

beforeEach(async () => {
  db = await freshDb();
  alice = await player("alice", 100, { crumbs: 6 });
  // These tests are the rules' path; the brain has its own (./brain.test.ts).
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  return () => vi.unstubAllEnvs();
});

describe("in the simulated market", () => {
  it("a player lists cheap, he buys it, the player is paid, and the reason is on his ledger", async () => {
    await simAct(db, { ...alice, act: { action: "list", item: "crumbs", amount: 2, price: 13 }, now: NOW });
    const report = await runNpcTrader(db, { now: at(1) });
    expect(report).toMatchObject({ ran: true, onChain: false });
    expect(report.event).toMatchObject({ kind: "fill", item: "crumbs", amount: 2, bits: 13, onChain: false, txHash: null });
    expect(`${report.event!.text}: ${report.event!.reason}`).toBe("Bought 2 × Crumbs from alice’s listing at 13 Bits: Gwei pays 22. Lunch money.");

    const sim = await readSim(db);
    expect(sim.book.listings).toEqual([]);
    expect(sim.npc).toEqual({ items: { crumbs: 2 } });
    expect(sim.wallets[NPC_SIM_ACCOUNT]).toBe(NPC_RULES.seedBits - 13);
    // Alice got her asking price less the 2% gas fee, as from any buyer.
    expect((await simWallet(db, { ...alice, now: at(2) })).bits).toBe(100 + 13 - 1);

    // The fill is in the price history under his own account, flagged simulated.
    const rows = await db.select().from(marketPrices).where(eq(marketPrices.accountId, NPC_SIM_ACCOUNT));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "fill", onChain: false, item: "crumbs", amount: 2, bits: 13, side: "fill" });

    const state = await readNpcState(db, false, NPC_SIM_ACCOUNT);
    expect(state.log.map((e) => e.kind)).toEqual(["seed", "fill"]);
    expect(state.books.lots.crumbs).toEqual({ units: 2, cost: 13 });
    expect(state.leaseUntil).toBe(0);
  });

  it("is rate-limited: a second look inside the gap does nothing, and one action a look", async () => {
    await simAct(db, { ...alice, act: { action: "list", item: "crumbs", amount: 2, price: 13 }, now: NOW });
    await simAct(db, { ...alice, act: { action: "list", item: "crumbs", amount: 2, price: 14 }, now: NOW });
    expect((await runNpcTrader(db, { now: at(1) })).event?.kind).toBe("fill");
    // Two cheap listings, one look: one is still there.
    expect((await readSim(db)).book.listings).toHaveLength(1);
    expect(await runNpcTrader(db, { now: at(5) })).toEqual({ ran: false, why: "too_soon", onChain: false });
    expect((await readSim(db)).book.listings).toHaveLength(1);
    const next = await runNpcTrader(db, { now: at(1 + MIN_GAP_MS / 1_000) });
    expect(next.event?.kind).toBe("fill");
  });

  it("is idempotent: two looks at once act once", async () => {
    await simAct(db, { ...alice, act: { action: "list", item: "crumbs", amount: 2, price: 13 }, now: NOW });
    await simAct(db, { ...alice, act: { action: "list", item: "crumbs", amount: 2, price: 14 }, now: NOW });
    const [a, b] = await Promise.all([runNpcTrader(db, { now: at(1) }), runNpcTrader(db, { now: at(1) })]);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
    expect((await readSim(db)).book.listings).toHaveLength(1);
    expect((await readNpcState(db, false, NPC_SIM_ACCOUNT)).log.filter((e) => e.kind === "fill")).toHaveLength(1);
  });

  it("refuses to look while another look holds the lock, and frees a lock that was never released", async () => {
    await runNpcTrader(db, { now: NOW });
    const [row] = await db.select().from(marketSim).where(eq(marketSim.id, "npc:sim"));
    await db
      .update(marketSim)
      .set({ state: { ...(row!.state as object), leaseUntil: at(60).getTime() + LEASE_MS } })
      .where(eq(marketSim.id, "npc:sim"));
    expect(await runNpcTrader(db, { now: at(60) })).toMatchObject({ ran: false, why: "busy" });
    expect(await runNpcTrader(db, { now: at(61 + LEASE_MS / 1_000) })).toMatchObject({ ran: true });
  });

  it("flips what he bought to Gwei on a later look, and a player can buy what he lists", async () => {
    await simAct(db, { ...alice, act: { action: "list", item: "crumbs", amount: 2, price: 13 }, now: NOW });
    await runNpcTrader(db, { now: at(1) });
    const sold = await runNpcTrader(db, { now: at(60) });
    expect(sold.event).toMatchObject({ kind: "sell", item: "crumbs", amount: 2, bits: 22 });
    expect(sold.event!.reason).toContain("Cost me 13.");
    const sim = await readSim(db);
    expect(sim.wallets[NPC_SIM_ACCOUNT]).toBe(NPC_RULES.seedBits - 13 + 22);
    expect(sim.npc).toEqual({ items: {} });
    // Nothing left to do: a look is just a look.
    expect(await runNpcTrader(db, { now: at(120) })).toMatchObject({ ran: true, why: "nothing_to_do" });
    const rows = await db.select().from(marketPrices).where(eq(marketPrices.accountId, NPC_SIM_ACCOUNT));
    expect(rows.map((r) => r.side).sort()).toEqual(["fill", "sell"]);
  });

  it("keeps his items through a player's trade, and shows up in the view", async () => {
    await simAct(db, { ...alice, act: { action: "list", item: "crumbs", amount: 2, price: 13 }, now: NOW });
    await runNpcTrader(db, { now: at(1) });
    // A player's own trade rewrites the sim's row; his items must survive it.
    await simAct(db, { ...alice, act: { action: "buy", item: "fee-bomb", amount: 1, maxBits: 50 }, now: at(2) });
    expect((await readSim(db)).npc).toEqual({ items: { crumbs: 2 } });

    const view = await buildNpcView(at(30));
    expect(view).toMatchObject({ mode: "simulated", accountId: NPC_SIM_ACCOUNT, explorerUrl: null, status: "open", bits: NPC_RULES.seedBits - 13 });
    expect(view.items).toEqual([{ item: "crumbs", name: "Crumbs", amount: 2 }]);
    expect(view.log[0]).toMatchObject({ kind: "fill", text: "Bought 2 × Crumbs from alice’s listing at 13 Bits", reason: "Gwei pays 22. Lunch money.", txUrl: null });
    expect(view.actionsLeft).toBe(NPC_RULES.maxActionsPerDay - 1);
    expect(view.rules.length).toBeGreaterThan(4);
  });

  it("shows his seed before his first look", async () => {
    const view = await buildNpcView(NOW);
    expect(view).toMatchObject({ mode: "simulated", bits: NPC_RULES.seedBits, items: [], log: [] });
  });
});

/* ------------------------------------------------------------------ on chain (a fake one) */

const KEY = `ed25519:${"1".repeat(60)}` as const;
const NPC = { accountId: "sandwich.wgpnear.near", privateKey: KEY };

function fakeChain(start: { bits: number; listings?: Listing[]; refuse?: string }) {
  const market: ChainMarket = { contractId: "game.wgpnear.near", network: "mainnet", vendor: "game.wgpnear.near", params: DEFAULT_PARAMS, pools: seededPools(), listings: 0 };
  const wallet: ChainWallet = { bits: start.bits, items: {}, tradesLeft: 40, listingsLeft: 10, fillsLeft: 10, fillBitsLeft: 3_000, open: [] };
  const sent: { signer: string; action: NpcAction }[] = [];
  let listings = start.listings ?? [];
  const chain: NpcChain = {
    market: async () => market,
    listings: async () => listings,
    wallet: async () => wallet,
    send: async (env, action) => {
      sent.push({ signer: env.accountId, action });
      if (start.refuse) return { ok: false, error: start.refuse, txHash: "FAILEDTX" };
      if (action.kind !== "fill") throw new Error("the fake chain only fills");
      listings = listings.filter((l) => l.id !== action.listingId);
      wallet.bits -= action.price;
      const items: Record<string, number> = { ...wallet.items };
      items[action.item] = (items[action.item] ?? 0) + action.amount;
      wallet.items = items;
      return { ok: true, outcome: { bits: action.price, fee: 1 }, txHash: "GoodTxHash111" };
    },
  };
  return { chain, sent };
}

const cheap: Listing = { id: 7, seller: "azalleaxyz.wgpnear.near", item: "crumbs", amount: 2, price: 13, listedAtMs: NOW.getTime() - 1_000 };

describe("on chain", () => {
  it("is off unless both his account and key are set", async () => {
    expect(npcTraderEnv({})).toBeNull();
    expect(npcTraderEnv({ NPC_TRADER_ACCOUNT_ID: "sandwich.wgpnear.near" })).toBeNull();
    expect(npcTraderEnv({ NPC_TRADER_PRIVATE_KEY: KEY })).toBeNull();
    expect(npcTraderEnv({ NPC_TRADER_ACCOUNT_ID: "sandwich.wgpnear.near", NPC_TRADER_PRIVATE_KEY: KEY })).toEqual(NPC);
    expect(() => npcTraderEnv({ NPC_TRADER_ACCOUNT_ID: "Not An Account", NPC_TRADER_PRIVATE_KEY: KEY })).toThrow(/NPC_TRADER_ACCOUNT_ID/);
    expect(() => npcTraderEnv({ NPC_TRADER_ACCOUNT_ID: "sandwich.wgpnear.near", NPC_TRADER_PRIVATE_KEY: "nope" })).toThrow(/NPC_TRADER_PRIVATE_KEY/);
    expect(npcTraderAccount({ NPC_TRADER_ACCOUNT_ID: "sandwich.wgpnear.near", NPC_TRADER_PRIVATE_KEY: "nope" })).toBeNull();

    const { chain, sent } = fakeChain({ bits: 300, listings: [cheap] });
    expect(await runNpcTrader(db, { now: NOW, onChain: true, env: null, chain })).toEqual({ ran: false, why: "off", onChain: true });
    expect(sent).toEqual([]);
    // Nothing was written for him either.
    expect(await db.select().from(marketSim).where(eq(marketSim.id, "npc:chain"))).toEqual([]);
  });

  it("signs one market call with his own account and books it with its transaction", async () => {
    const { chain, sent } = fakeChain({ bits: 300, listings: [cheap] });
    const report = await runNpcTrader(db, { now: NOW, onChain: true, env: NPC, chain });
    expect(report.event).toMatchObject({ kind: "fill", onChain: true, txHash: "GoodTxHash111", bits: 13 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.signer).toBe("sandwich.wgpnear.near");
    const [row] = await db.select().from(marketPrices).where(eq(marketPrices.accountId, "sandwich.wgpnear.near"));
    expect(row).toMatchObject({ kind: "fill", onChain: true, txHash: "GoodTxHash111", bits: 13 });
    const state = await readNpcState(db, true, "sandwich.wgpnear.near");
    expect(state.books.lots.crumbs).toEqual({ units: 2, cost: 13 });
    // The simulated market's books are a different row and untouched.
    expect((await readNpcState(db, false, NPC_SIM_ACCOUNT)).log).toEqual([]);
    // A second trigger straight after: nothing.
    expect(await runNpcTrader(db, { now: at(3), onChain: true, env: NPC, chain })).toMatchObject({ ran: false, why: "too_soon" });
    expect(sent).toHaveLength(1);
  });

  it("books a refusal against the day's actions instead of retrying it forever", async () => {
    const { chain, sent } = fakeChain({ bits: 300, listings: [cheap], refuse: "That listing is gone" });
    for (let i = 0; i < NPC_RULES.maxActionsPerDay + 3; i++) await runNpcTrader(db, { now: at(i * 30), onChain: true, env: NPC, chain });
    expect(sent).toHaveLength(NPC_RULES.maxActionsPerDay);
    const state = await readNpcState(db, true, "sandwich.wgpnear.near");
    expect(state.lastRefusal).toMatchObject({ error: "That listing is gone", txHash: "FAILEDTX" });
    expect(state.log).toEqual([]);
    expect(await db.select().from(marketPrices)).toEqual([]);
  });

  it("can only ever send the five market methods a player's session key may call", () => {
    const said = { text: "", reason: "", rule: 0 };
    const calls = [
      npcCall({ ...said, kind: "fill", listingId: 7, item: "crumbs", amount: 2, price: 13, seller: "a.near" }),
      npcCall({ ...said, kind: "buy", item: "crumbs", amount: 2, maxBits: 27, expectBits: 26 }),
      npcCall({ ...said, kind: "sell", item: "crumbs", amount: 2, minBits: 21, expectBits: 22 }),
      npcCall({ ...said, kind: "list", item: "crumbs", amount: 2, price: 24 }),
      npcCall({ ...said, kind: "cancel", listingId: 7, item: "crumbs", amount: 2 }),
    ];
    expect(calls.map((c) => c.method).sort()).toEqual([...MARKET_METHODS].sort());
    expect(calls[1]).toEqual({ method: "market_buy", args: { item: "crumbs", amount: 2, max_bits: "27" } });
    expect(calls[2]).toEqual({ method: "market_sell", args: { item: "crumbs", amount: 2, min_bits: "21" } });
    expect(calls[3]).toEqual({ method: "list_item", args: { item: "crumbs", amount: 2, price_bits: "24" } });
    expect(calls[0]).toEqual({ method: "buy_listing", args: { listing_id: 7 } });
  });

  it("reads what a call did from the contract's own return value", () => {
    const said = { text: "", reason: "", rule: 0 };
    const pool = { item: "crumbs", virtual_bits: "480", virtual_items: "40", bits: "506", stock: "38", escrow: "0" };
    expect(outcomeOf({ ...said, kind: "buy", item: "crumbs", amount: 2, maxBits: 27, expectBits: 26 }, { item: "crumbs", amount: 2, bits: "26", fee: "1", pool }, 200)).toEqual({ bits: 26, fee: 1 });
    const listing = { id: 9, seller: "sandwich.wgpnear.near", item: "crumbs", amount: 2, price: "24", listed_at_ms: 1 };
    expect(outcomeOf({ ...said, kind: "list", item: "crumbs", amount: 2, price: 24 }, listing, 200)).toEqual({ bits: 24, listingId: 9 });
    expect(outcomeOf({ ...said, kind: "fill", listingId: 9, item: "crumbs", amount: 2, price: 24, seller: "a.near" }, listing, 200)).toEqual({ bits: 24, fee: 1 });
    expect(() => outcomeOf({ ...said, kind: "list", item: "crumbs", amount: 2, price: 24 }, null, 200)).toThrow();
  });
});
