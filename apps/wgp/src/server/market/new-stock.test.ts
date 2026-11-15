import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { dailyAward, podiumAward } from "@/lib/market/new-stock";

import type { Db } from "../db/client";
import { ensureSave } from "../db/players";
import { rewardFromOp } from "../db/outbox";
import { chainOps } from "../db/schema";
import { freshDb, givePlayerHero, makePlayer } from "../db/test-helpers";
import type { ChainReader } from "./chain";
import { grantNewStock, openStockNow } from "./new-stock";

const LIVE = JSON.parse(readFileSync(join(__dirname, "../../lib/market/live-2026-11-15.json"), "utf8")) as { market_state: { pools: Record<string, unknown>[] } & Record<string, unknown> };
const NOW = new Date("2026-11-16T12:00:00Z");
const ALL = new Set(["gas-receipt", "finality-flag", "evidence-bag", "seed-phrase"]);

/** The contract as mainnet had it on Nov 15 (eight pools), plus any `extra` pools. */
function reader(extra: string[] = []): ChainReader {
  const pool = (item: string) => ({ item, virtual_bits: "480", virtual_items: "40", bits: "120", stock: "10", escrow: "0" });
  const state = { ...LIVE.market_state, pools: [...LIVE.market_state.pools, ...extra.map(pool)], prices_milli: [] };
  return {
    contractId: "game.wgpnear.near",
    network: "mainnet",
    view: async (method) => {
      if (method === "market_state") return state;
      throw new Error(`no ${method} here`);
    },
  };
}

describe("Gwei's new stock on the server", () => {
  let db: Db;
  let playerId: string;
  beforeEach(async () => {
    db = await freshDb();
    playerId = (await makePlayer(db, "detective")).id;
    await givePlayerHero(db, playerId);
  });

  it("is closed while the contract has no pool for it, and open once it does", async () => {
    expect([...(await openStockNow(db, reader()))]).toEqual([]);
    expect([...(await openStockNow(db, reader(["gas-receipt", "evidence-bag"])))]).toEqual(["gas-receipt", "evidence-bag"]);
    // An unreadable market awards nothing rather than guess.
    const down: ChainReader = { contractId: "x", network: "mainnet", view: async () => Promise.reject(new Error("503")) };
    expect([...(await openStockNow(db, down))]).toEqual([]);
  });

  it("awards nothing before the owner's calls: no save change, no mint", async () => {
    const before = await ensureSave(db, playerId);
    const granted = await grantNewStock(db, { playerId, awards: dailyAward({ fightsWon: 4 }), open: new Set(), day: "2026-11-16", runId: "r1", digest: "a".repeat(64), now: NOW });
    expect(granted).toEqual([]);
    expect((await ensureSave(db, playerId)).rev).toBe(before.rev);
    expect(await db.select().from(chainOps)).toEqual([]);
  });

  it("once open, writes the item into the save and queues its mint, once per item per day", async () => {
    const before = await ensureSave(db, playerId);
    const input = { playerId, awards: dailyAward({ fightsWon: 4 }), open: ALL, day: "2026-11-16", runId: "r1", digest: "b".repeat(64), now: NOW };
    expect((await grantNewStock(db, input)).map((a) => a.item)).toEqual(["gas-receipt", "finality-flag"]);
    const after = await ensureSave(db, playerId);
    expect(after.save.inventory).toMatchObject({ "gas-receipt": 1, "finality-flag": 1 });
    expect({ ...after.save, inventory: before.save.inventory }).toEqual(before.save);
    const ops = (await db.select().from(chainOps).where(eq(chainOps.playerId, playerId))).sort((a, b) => (a.rewardNonce ?? 0) - (b.rewardNonce ?? 0));
    expect(ops.map((o) => o.dedupeKey).sort()).toEqual([`new-stock:finality-flag:${playerId}:2026-11-16`, `new-stock:gas-receipt:${playerId}:2026-11-16`]);
    expect(ops.map((o) => rewardFromOp(o).items)).toEqual([[{ tokenId: "item:gas-receipt", amount: 1 }], [{ tokenId: "item:finality-flag", amount: 1 }]]);
    expect(ops.map((o) => o.rewardNonce)).toEqual([1, 2]);
    // A second Daily that day, or a retried submit: nothing more.
    expect(await grantNewStock(db, { ...input, runId: "r2" })).toEqual([]);
    expect((await ensureSave(db, playerId)).save.inventory["gas-receipt"]).toBe(1);
    // The next day earns again.
    expect((await grantNewStock(db, { ...input, day: "2026-11-17", runId: "r3" })).length).toBe(2);
  });

  it("awards only the items that are open", async () => {
    const granted = await grantNewStock(db, { playerId, awards: [...dailyAward({ fightsWon: 4 }), ...podiumAward(1)], open: new Set(["seed-phrase"]), day: "2026-11-16", runId: "r1", digest: "c".repeat(64), now: NOW });
    expect(granted.map((a) => a.item)).toEqual(["seed-phrase"]);
    expect((await ensureSave(db, playerId)).save.inventory).toMatchObject({ "seed-phrase": 1 });
  });
});
