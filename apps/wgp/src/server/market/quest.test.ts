/**
 * The daily market quest on an in-memory database: a real simulated trade completes it
 * once per UTC day for XP only, a refused trade completes nothing, listing and taking down
 * don't count, an on-chain trade completes it through the relayer's hook, and a grant held
 * back by a ranked run goes through on the next look.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Save } from "@wgp/game-core/types";

import { MarketError } from "@/lib/market/engine";
import { MARKET_QUEST_XP } from "@/lib/market/quest";

import type { Db } from "../db/client";
import { enqueueRewardMint } from "../db/outbox";
import { ensureSave, writeSave } from "../db/players";
import { budgetCounters, chainOps, marketPrices, runs } from "../db/schema";
import { freshDb, givePlayerHero, makePlayer } from "../db/test-helpers";
import { completeMarketQuest, marketQuestStatus, QUEST_SCOPE, simActWithQuest, tradedToday, utcDay } from "./quest";
import { NPC_SIM_ACCOUNT } from "../npc/env";
import { runNpcTrader } from "../npc/runner";
import { afterMarketRelay } from "./relay";
import { mintedBits, simWallet } from "./sim";

vi.mock("next/cache", () => ({ cacheTag: () => {}, cacheLife: () => {}, revalidateTag: () => {} }));

const NOW = new Date("2026-11-12T12:00:00Z");
const LATER = new Date("2026-11-12T23:59:00Z");
const TOMORROW = new Date("2026-11-13T00:00:30Z");

let db: Db;
let alice: { id: string; account: string };

async function player(handle: string, bits: number, inventory: Save["inventory"], hero = true) {
  const p = await makePlayer(db, handle);
  if (hero) {
    await givePlayerHero(db, p.id);
    const { save, rev } = await ensureSave(db, p.id);
    await writeSave(db, p.id, { ...save, inventory }, rev);
  }
  if (bits > 0) {
    await db.transaction((tx) =>
      enqueueRewardMint(tx, { kind: "mint_reward", dedupeKey: `mint_reward:${handle}`, playerId: p.id, payload: { accountId: p.nearAccountId, items: [{ tokenId: "item:bits", amount: bits }], digest: "0".repeat(64) } }),
    );
  }
  return { id: p.id, account: p.nearAccountId };
}

const stored = (id: string) => ensureSave(db, id);
const xp = async (id: string) => (await stored(id)).save.hero!.xp;
const buy = (who: { id: string; account: string }, now: Date, amount = 1) =>
  simActWithQuest(db, { playerId: who.id, accountId: who.account, act: { action: "buy", item: "crumbs", amount, maxBits: 500 }, now });
const markers = () => db.select().from(budgetCounters).where(eq(budgetCounters.scope, QUEST_SCOPE));

beforeEach(async () => {
  db = await freshDb();
  alice = await player("alice", 200, { crumbs: 6 });
});

describe("the daily market quest", () => {
  it("completes on a real simulated trade: XP only, the save a revision on", async () => {
    const before = await stored(alice.id);
    const bitsBefore = await mintedBits(db, alice.id);
    const res = await buy(alice, NOW);

    expect(res.questXp).toBe(MARKET_QUEST_XP);
    expect(res.save.hero!.xp).toBe(before.save.hero!.xp + MARKET_QUEST_XP);
    // The answer carries the save as stored: the trade's revision, then the quest's.
    const after = await stored(alice.id);
    expect(after.save).toEqual(res.save);
    expect(after.rev).toBe(res.rev);
    expect(res.rev).toBe(before.rev + 2);
    expect(res.save.inventory).toEqual({ crumbs: 7 });

    // Nothing is minted: no new chain op, and the wallet moved only by the trade's price.
    expect(await mintedBits(db, alice.id)).toBe(bitsBefore);
    expect(await db.select().from(chainOps)).toHaveLength(1);
    const wallet = await simWallet(db, { playerId: alice.id, accountId: alice.account, now: NOW });
    expect(wallet.bits).toBe(200 - (res.receipt.kind === "trade" ? res.receipt.trade.bits : 0));
    expect(await markers()).toMatchObject([{ key: alice.id, period: "2026-11-12", count: 1 }]);
  });

  it("completes once per UTC day, however many trades land", async () => {
    const start = await xp(alice.id);
    expect((await buy(alice, NOW)).questXp).toBe(MARKET_QUEST_XP);
    const second = await buy(alice, LATER);
    expect(second.questXp).toBe(0);
    const sold = await simActWithQuest(db, { playerId: alice.id, accountId: alice.account, act: { action: "sell", item: "crumbs", amount: 1, minBits: 1 }, now: LATER });
    expect(sold.questXp).toBe(0);
    expect(await xp(alice.id)).toBe(start + MARKET_QUEST_XP);
    expect(await markers()).toHaveLength(1);

    // Midnight UTC starts a new one.
    expect((await buy(alice, TOMORROW)).questXp).toBe(MARKET_QUEST_XP);
    expect(await xp(alice.id)).toBe(start + 2 * MARKET_QUEST_XP);
    expect((await markers()).map((m) => m.period).sort()).toEqual(["2026-11-12", "2026-11-13"]);
  });

  it("two grants at once add the XP once", async () => {
    const start = await xp(alice.id);
    const outcomes = await Promise.all([completeMarketQuest(db, { playerId: alice.id, now: NOW }), completeMarketQuest(db, { playerId: alice.id, now: NOW })]);
    expect(outcomes.map((o) => o.state).sort()).toEqual(["already", "completed"]);
    expect(await xp(alice.id)).toBe(start + MARKET_QUEST_XP);
  });

  it("a refused trade completes nothing", async () => {
    const start = await stored(alice.id);
    // The price is over the trade's limit: the market refuses with the contract's rule.
    const slipped = await simActWithQuest(db, { playerId: alice.id, accountId: alice.account, act: { action: "buy", item: "crumbs", amount: 1, maxBits: 1 }, now: NOW }).catch((e: unknown) => e);
    expect(slipped).toBeInstanceOf(MarketError);
    // Selling what she doesn't hold.
    const empty = await simActWithQuest(db, { playerId: alice.id, accountId: alice.account, act: { action: "sell", item: "spare-arm", amount: 1, minBits: 1 }, now: NOW }).catch((e: unknown) => e);
    expect(empty).toBeInstanceOf(MarketError);

    expect(await markers()).toHaveLength(0);
    expect(await stored(alice.id)).toEqual(start);
    expect(await tradedToday(db, alice.account, NOW)).toBe(false);
    expect((await marketQuestStatus(db, { playerId: alice.id, accountId: alice.account, now: NOW })).view).toMatchObject({ day: "2026-11-12", done: false, xp: MARKET_QUEST_XP, resetsAt: "2026-11-13T00:00:00.000Z" });
  });

  it("listing an item and taking it down don't count; buying a listing does", async () => {
    const bob = await player("bob", 100, {});
    const start = await xp(alice.id);
    const listed = await simActWithQuest(db, { playerId: alice.id, accountId: alice.account, act: { action: "list", item: "crumbs", amount: 1, price: 12 }, now: NOW });
    expect(listed.questXp).toBe(0);
    const id = listed.receipt.kind === "listing" ? listed.receipt.listing.id : -1;
    const down = await simActWithQuest(db, { playerId: alice.id, accountId: alice.account, act: { action: "cancel", listingId: id }, now: NOW });
    expect(down.questXp).toBe(0);
    expect(await xp(alice.id)).toBe(start);
    expect(await markers()).toHaveLength(0);

    const again = await simActWithQuest(db, { playerId: alice.id, accountId: alice.account, act: { action: "list", item: "crumbs", amount: 1, price: 12 }, now: NOW });
    const lot = again.receipt.kind === "listing" ? again.receipt.listing.id : -1;
    const filled = await simActWithQuest(db, { playerId: bob.id, accountId: bob.account, act: { action: "fill", listingId: lot }, now: NOW });
    expect(filled.questXp).toBe(MARKET_QUEST_XP);
    // The buyer's quest, not the seller's.
    expect(await markers()).toMatchObject([{ key: bob.id }]);
    expect(await xp(alice.id)).toBe(start);
  });

  it("waits for a hero, then grants on the next look", async () => {
    const carol = await player("carol", 0, {}, false);
    expect(await completeMarketQuest(db, { playerId: carol.id, now: NOW })).toEqual({ state: "deferred", reason: "no_hero" });
    expect(await markers()).toHaveLength(0);
  });

  it("holds the XP back while a ranked run is in flight, and grants it once the run is over", async () => {
    const start = await xp(alice.id);
    await buy(alice, NOW);
    expect(await xp(alice.id)).toBe(start + MARKET_QUEST_XP);

    // Next day: a run starts right after the trade lands, before the quest is settled.
    const { save, rev } = await stored(alice.id);
    const [run] = await db
      .insert(runs)
      .values({ playerId: alice.id, night: 1, seed: 1, ruleset: "t", saveRevAtStart: rev, startSave: save, expiresAt: new Date(TOMORROW.getTime() + 60_000) })
      .returning({ id: runs.id });
    await afterMarketRelay(
      db,
      { playerId: alice.id, accountId: alice.account, method: "market_buy", result: { item: "crumbs", amount: 1, bits: "13", fee: "1", pool: { item: "crumbs", virtual_bits: "480", virtual_items: "40", bits: "505", stock: "38", escrow: "0" } }, txHash: "tx-held" },
      TOMORROW,
    );
    // The trade was mirrored (which the relayer does regardless), but the quest's XP waits: the run replays from its save.
    expect(await xp(alice.id)).toBe(start + MARKET_QUEST_XP);
    expect(await tradedToday(db, alice.account, TOMORROW)).toBe(true);
    const held = await marketQuestStatus(db, { playerId: alice.id, accountId: alice.account, now: TOMORROW });
    expect(held.view.done).toBe(false);

    await db.update(runs).set({ status: "verified" }).where(and(eq(runs.id, run!.id)));
    const granted = await marketQuestStatus(db, { playerId: alice.id, accountId: alice.account, now: TOMORROW });
    expect(granted.view.done).toBe(true);
    expect(granted.completed?.xp).toBe(MARKET_QUEST_XP);
    expect(await xp(alice.id)).toBe(start + 2 * MARKET_QUEST_XP);
    // And only once.
    expect((await marketQuestStatus(db, { playerId: alice.id, accountId: alice.account, now: TOMORROW })).completed).toBeNull();
    expect(await xp(alice.id)).toBe(start + 2 * MARKET_QUEST_XP);
  });
});

describe("the relayer's market hook and the quest", () => {
  const pool = { item: "crumbs", virtual_bits: "480", virtual_items: "40", bits: "518", stock: "37", escrow: "0" };

  it("an on-chain trade completes it, once", async () => {
    const start = await xp(alice.id);
    await afterMarketRelay(db, { playerId: alice.id, accountId: alice.account, method: "market_buy", result: { item: "crumbs", amount: 3, bits: "39", fee: "1", pool }, txHash: "tx1" }, NOW);
    expect(await xp(alice.id)).toBe(start + MARKET_QUEST_XP);
    await afterMarketRelay(db, { playerId: alice.id, accountId: alice.account, method: "market_sell", result: { item: "crumbs", amount: 1, bits: "11", fee: "1", pool }, txHash: "tx2" }, NOW);
    expect(await xp(alice.id)).toBe(start + MARKET_QUEST_XP);
    expect((await stored(alice.id)).save.inventory).toEqual({ crumbs: 8 });
    expect((await marketQuestStatus(db, { playerId: alice.id, accountId: alice.account, now: NOW })).view.done).toBe(true);
  });

  it("an on-chain listing or a malformed answer doesn't", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const start = await xp(alice.id);
    const listing = { id: 3, seller: alice.account, item: "crumbs", amount: 4, price: "40", listed_at_ms: 1 };
    await afterMarketRelay(db, { playerId: alice.id, accountId: alice.account, method: "list_item", result: listing, txHash: "tx3" }, NOW);
    await afterMarketRelay(db, { playerId: alice.id, accountId: alice.account, method: "cancel_listing", result: listing, txHash: "tx4" }, NOW);
    await afterMarketRelay(db, { playerId: alice.id, accountId: alice.account, method: "market_sell", result: "nope", txHash: "tx5" }, NOW);
    expect(await xp(alice.id)).toBe(start);
    expect(await markers()).toHaveLength(0);
    spy.mockRestore();
  });
});

describe("Sandwich Man and the quest", () => {
  it("his trades complete nobody's quest, and he is never a quest player", async () => {
    const start = await xp(alice.id);
    // Alice lists cheap (listing doesn't count); Sandwich Man buys it on his next look.
    const listed = await simActWithQuest(db, { playerId: alice.id, accountId: alice.account, act: { action: "list", item: "crumbs", amount: 2, price: 13 }, now: NOW });
    expect(listed.questXp).toBe(0);
    const look = await runNpcTrader(db, { now: new Date(NOW.getTime() + 1_000) });
    expect(look.event).toMatchObject({ kind: "fill", item: "crumbs", amount: 2 });

    // His fill is in the price history under his own account...
    const rows = await db.select().from(marketPrices).where(eq(marketPrices.kind, "fill"));
    expect(rows.map((r) => r.accountId)).toEqual([NPC_SIM_ACCOUNT]);
    // ...and it did nothing for Alice: no marker, no XP, the quest still open on the next look.
    expect(await markers()).toHaveLength(0);
    const status = await marketQuestStatus(db, { playerId: alice.id, accountId: alice.account, now: LATER });
    expect(status).toMatchObject({ view: { done: false }, completed: null });
    expect(await xp(alice.id)).toBe(start);

    // A trade booked under his account is nobody's, even for a player signed in to that account.
    expect(await tradedToday(db, NPC_SIM_ACCOUNT, LATER)).toBe(false);
    const imposter = await marketQuestStatus(db, { playerId: alice.id, accountId: NPC_SIM_ACCOUNT, now: LATER });
    expect(imposter.view.done).toBe(false);
    expect(await markers()).toHaveLength(0);

    // Alice's own trade still completes it, once, and only her row exists.
    const bought = await buy(alice, LATER);
    expect(bought.questXp).toBe(MARKET_QUEST_XP);
    expect((await buy(alice, LATER)).questXp).toBe(0);
    expect(await xp(alice.id)).toBe(start + MARKET_QUEST_XP);
    expect((await markers()).map((m) => m.key)).toEqual([alice.id]);
  });
});

describe("the quest's day", () => {
  it("is the UTC date", () => {
    expect(utcDay(new Date("2026-11-12T23:59:59.999Z"))).toBe("2026-11-12");
    expect(utcDay(new Date("2026-11-13T00:00:00Z"))).toBe("2026-11-13");
  });
});
