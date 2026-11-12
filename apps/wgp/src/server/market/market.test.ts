/**
 * The server's market on an in-memory database: the simulated market (Bits from reward
 * mints, items from the save, the contract's rules), its price history, the view the
 * screens read, and the relayer's after-hook that mirrors on-chain trades into the save.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Save } from "@wgp/game-core/types";

import { MarketError } from "@/lib/market/engine";
import { spotMilli } from "@/lib/market/math";

import type { Db } from "../db/client";
import { enqueueRewardMint } from "../db/outbox";
import { ensureSave, writeSave } from "../db/players";
import { chainOps, marketPrices, runs } from "../db/schema";
import { freshDb, givePlayerHero, makePlayer } from "../db/test-helpers";
import { HttpError } from "../http";
import { priceStats, recordSnapshots, thin } from "./history";
import { afterMarketRelay, mirrorInventory } from "./relay";
import { mintedBits, readSim, simAct, simWallet, unsentBits } from "./sim";
import { marketListings, marketSnapshot, marketView } from "./view";

// Outside Next there is no cache to tag or expire.
vi.mock("next/cache", () => ({ cacheTag: () => {}, cacheLife: () => {}, revalidateTag: () => {} }));

const NOW = new Date("2026-11-08T12:00:00Z");

let db: Db;
let alice: { id: string; account: string };
let bob: { id: string; account: string };

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
  return { id: p.id, account: p.nearAccountId };
}

const inventory = async (playerId: string) => (await ensureSave(db, playerId)).save.inventory;

beforeEach(async () => {
  db = await freshDb();
  alice = await player("alice", 200, { crumbs: 6 });
  bob = await player("bob", 100, {});
});

describe("the simulated market", () => {
  it("counts Bits from reward mints, sent or queued", async () => {
    expect(await mintedBits(db, alice.id)).toBe(200);
    expect(await mintedBits(db, bob.id)).toBe(100);
    const w = await simWallet(db, { playerId: alice.id, accountId: alice.account, now: NOW });
    expect(w).toMatchObject({ bits: 200, items: { crumbs: 6 }, tradesLeft: 40, open: [] });
  });

  it("buys and sells on the contract's curve, moving the save and the price", async () => {
    const before = (await readSim(db)).book.pools.find((p) => p.item === "crumbs")!;
    const buy = await simAct(db, { playerId: alice.id, accountId: alice.account, act: { action: "buy", item: "crumbs", amount: 3, maxBits: 39 }, now: NOW });
    expect(buy.receipt).toMatchObject({ kind: "trade", trade: { bits: 39, fee: 1 } });
    expect(buy.bits).toBe(161);
    expect(buy.save.inventory).toEqual({ crumbs: 9 });
    expect(await inventory(alice.id)).toEqual({ crumbs: 9 });
    const after = (await readSim(db)).book.pools.find((p) => p.item === "crumbs")!;
    expect(spotMilli(after)).toBeGreaterThan(spotMilli(before));

    const sell = await simAct(db, { playerId: alice.id, accountId: alice.account, act: { action: "sell", item: "crumbs", amount: 9, minBits: 1 }, now: NOW });
    expect(sell.save.inventory).toEqual({});
    expect(spotMilli((await readSim(db)).book.pools.find((p) => p.item === "crumbs")!)).toBeLessThan(spotMilli(before));

    const rows = await db.select().from(marketPrices);
    expect(rows.map((r) => [r.item, r.kind, r.side, r.onChain])).toEqual([
      ["crumbs", "trade", "buy", false],
      ["crumbs", "trade", "sell", false],
    ]);
  });

  it("escrows a listing, fills it for another player and pays the seller less the fee", async () => {
    const listed = await simAct(db, { playerId: alice.id, accountId: alice.account, act: { action: "list", item: "crumbs", amount: 4, price: 40 }, now: NOW });
    expect(listed.save.inventory).toEqual({ crumbs: 2 });
    const id = listed.receipt.kind === "listing" ? listed.receipt.listing.id : -1;
    expect((await marketListings()).listings.map((l) => [l.id, l.unitMilli])).toEqual([[id, 10_000]]);

    const fill = await simAct(db, { playerId: bob.id, accountId: bob.account, act: { action: "fill", listingId: id }, now: NOW });
    expect(fill.bits).toBe(60);
    expect(fill.save.inventory).toEqual({ crumbs: 4 });
    expect((await simWallet(db, { playerId: alice.id, accountId: alice.account, now: NOW })).bits).toBe(200 + 39);
    expect((await marketListings()).listings).toEqual([]);

    // Cancel gives the items back.
    const again = await simAct(db, { playerId: alice.id, accountId: alice.account, act: { action: "list", item: "crumbs", amount: 2, price: 20 }, now: NOW });
    const againId = again.receipt.kind === "listing" ? again.receipt.listing.id : -1;
    const cancel = await simAct(db, { playerId: alice.id, accountId: alice.account, act: { action: "cancel", listingId: againId }, now: NOW });
    expect(cancel.save.inventory).toEqual({ crumbs: 2 });
  });

  it("refuses what the contract refuses and changes nothing", async () => {
    const tries = [
      { action: "buy", item: "crumbs", amount: 3, maxBits: 10 },
      { action: "buy", item: "goblin-glider", amount: 2, maxBits: 10_000 },
      { action: "sell", item: "sybil-goo", amount: 1, minBits: 0 },
      { action: "list", item: "crumbs", amount: 2, price: 1 },
      { action: "fill", listingId: 99 },
    ] as const;
    for (const act of tries) {
      await expect(simAct(db, { playerId: alice.id, accountId: alice.account, act, now: NOW })).rejects.toBeInstanceOf(MarketError);
    }
    expect(await inventory(alice.id)).toEqual({ crumbs: 6 });
    expect((await simWallet(db, { playerId: alice.id, accountId: alice.account, now: NOW })).bits).toBe(200);
    expect(await db.select().from(marketPrices)).toEqual([]);
  });

  it("waits while a ranked run is in flight", async () => {
    const { save, rev } = await ensureSave(db, alice.id);
    await db.insert(runs).values({ playerId: alice.id, night: 1, seed: 1, ruleset: "t", saveRevAtStart: rev, startSave: save, expiresAt: new Date(NOW.getTime() + 60_000) });
    const err = await simAct(db, { playerId: alice.id, accountId: alice.account, act: { action: "buy", item: "crumbs", amount: 1, maxBits: 100 }, now: NOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe("run_active");
  });
});

describe("the market view", () => {
  it("prices every item off chain until the contract's market is live", async () => {
    const view = await marketView();
    expect(view.onChain).toBe(false);
    expect(view.items).toHaveLength(8);
    const crumbs = view.items.find((i) => i.item === "crumbs")!;
    expect(crumbs).toMatchObject({ name: "Crumbs", rarity: "common", priceMilli: 12_000, buyOne: 14, sellOne: 10, change24h: null });
    expect(view.till).toBe(480 * 3 + 800 * 3 + 1200 * 2);
  });

  it("charts the day's moves and the 24-hour change", async () => {
    const pools = (await readSim(db)).book.pools;
    const crumbs = pools.find((p) => p.item === "crumbs")!;
    const rows = [
      { item: "crumbs", kind: "snapshot", priceMilli: 10_000, at: NOW },
      { item: "crumbs", kind: "trade", priceMilli: 11_000, at: NOW },
      { item: "crumbs", kind: "fill", priceMilli: 99_000, at: NOW },
    ];
    const s = priceStats([crumbs], rows, new Map())!.get("crumbs")!;
    expect(s.spark).toEqual([10_000, 10_000, 11_000, 12_000]);
    // The sparkline's steps: only real price changes, the fill left out, ending on the price now.
    expect(s.steps.map((step) => step[1])).toEqual([10_000, 11_000, 12_000]);
    // A known price and no rows is one flat step ("No trades in 24 h"); no price at all is no history.
    expect(priceStats([crumbs], [], new Map([["crumbs", 12_000]])).get("crumbs")!.steps).toEqual([[0, 12_000]]);
    expect(priceStats([crumbs], [], new Map()).get("crumbs")!.steps).toEqual([]);
    expect(s.change24h).toBeCloseTo(0.2);
    expect(s.trades24h).toBe(2);
    expect(thin([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 4, 7, 10]);
  });

  it("snapshots only pools that moved or went quiet for an hour", async () => {
    const pools = (await readSim(db)).book.pools;
    expect(await recordSnapshots(db, false, pools, NOW)).toBe(8);
    expect(await recordSnapshots(db, false, pools, new Date(NOW.getTime() + 60_000))).toBe(0);
    expect(await recordSnapshots(db, false, pools, new Date(NOW.getTime() + 61 * 60_000))).toBe(8);
  });
});

describe("the answer to a trade", () => {
  it("carries the market and wallet as they stand right after it (past the view's cache)", async () => {
    // The snapshot reads the real clock for its 24-hour window, so these trades happen now (a
    // fixed date here made the test fail a day later).
    const now = new Date();
    const listed = await simAct(db, { playerId: alice.id, accountId: alice.account, act: { action: "list", item: "crumbs", amount: 1, price: 12 }, now });
    await simAct(db, { playerId: alice.id, accountId: alice.account, act: { action: "buy", item: "crumbs", amount: 2, maxBits: 40 }, now });
    const snap = await marketSnapshot({ playerId: alice.id, accountId: alice.account });
    const crumbs = snap.view.items.find((i) => i.item === "crumbs")!;
    expect(crumbs.pool.stock).toBe(38);
    expect(crumbs.trades24h).toBe(1);
    expect(snap.listings.map((l) => l.id)).toEqual([listed.receipt.kind === "listing" ? listed.receipt.listing.id : -1]);
    expect(snap.me).toMatchObject({ onChain: false, accountId: alice.account, items: { crumbs: 7 }, pendingBits: 0 });
    expect(snap.me.bits).toBe(200 - 26);
  });
});

describe("Bits on the way", () => {
  it("counts a player's reward Bits until the operator lands them (not dead ones)", async () => {
    expect(await unsentBits(db, alice.id)).toBe(200);
    await db.transaction((tx) =>
      enqueueRewardMint(tx, { kind: "mint_reward", dedupeKey: "mint_reward:alice-2", playerId: alice.id, payload: { accountId: alice.account, items: [{ tokenId: "item:bits", amount: 25 }, { tokenId: "item:crumbs", amount: 2 }], digest: "0".repeat(64) } }),
    );
    expect(await unsentBits(db, alice.id)).toBe(225);
    await db.update(chainOps).set({ status: "sent" }).where(eq(chainOps.dedupeKey, "mint_reward:alice"));
    expect(await unsentBits(db, alice.id)).toBe(25);
    await db.update(chainOps).set({ status: "dead" }).where(eq(chainOps.dedupeKey, "mint_reward:alice-2"));
    expect(await unsentBits(db, alice.id)).toBe(0);
    expect(await unsentBits(db, bob.id)).toBe(100);
  });
});

describe("the relayer's market hook", () => {
  const pool = { item: "crumbs", virtual_bits: "480", virtual_items: "40", bits: "518", stock: "37", escrow: "0" };

  it("mirrors an on-chain buy into the save and records it", async () => {
    const ok = await afterMarketRelay(db, { playerId: alice.id, accountId: alice.account, method: "market_buy", result: { item: "crumbs", amount: 3, bits: "39", fee: "1", pool }, txHash: "tx1" }, NOW);
    expect(ok).toBe(true);
    expect(await inventory(alice.id)).toEqual({ crumbs: 9 });
    const [row] = await db.select().from(marketPrices).where(eq(marketPrices.txHash, "tx1"));
    expect(row).toMatchObject({ item: "crumbs", kind: "trade", side: "buy", onChain: true, priceMilli: 12_961, stock: 37, till: 518 });
  });

  it("mirrors listings out and cancels back, from the contract's answer", async () => {
    const listing = { id: 3, seller: alice.account, item: "crumbs", amount: 4, price: "40", listed_at_ms: 1 };
    await afterMarketRelay(db, { playerId: alice.id, accountId: alice.account, method: "list_item", result: listing, txHash: "tx2" }, NOW);
    expect(await inventory(alice.id)).toEqual({ crumbs: 2 });
    await afterMarketRelay(db, { playerId: alice.id, accountId: alice.account, method: "cancel_listing", result: listing, txHash: "tx3" }, NOW);
    expect(await inventory(alice.id)).toEqual({ crumbs: 6 });
  });

  it("ignores a malformed answer instead of failing the relayed call", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await afterMarketRelay(db, { playerId: alice.id, accountId: alice.account, method: "market_sell", result: "nope", txHash: "tx4" }, NOW)).toBe(false);
    expect(await inventory(alice.id)).toEqual({ crumbs: 6 });
    spy.mockRestore();
  });

  it("never takes an inventory below zero", async () => {
    await mirrorInventory(db, bob.id, "crumbs", -5, NOW);
    expect(await inventory(bob.id)).toEqual({});
    expect(await mirrorInventory(db, bob.id, "bits", 5, NOW)).toBe(false);
  });
});
