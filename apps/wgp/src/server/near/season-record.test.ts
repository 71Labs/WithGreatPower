import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDb, type Db } from "@/server/db/client";
import { recordScore } from "@/server/db/leaderboard";
import { movePlayerAccount } from "@/server/db/move-account";
import { findOrCreatePlayer } from "@/server/db/players";
import { CLOSE_GRACE_MS, RECORD_SEASON_KIND, closeSeason, seasonLeaves, type SeasonStanding } from "@/server/db/season-close";
import { chainOps, runs, seasons } from "@/server/db/schema";
import { sweep } from "@/server/db/sweep";
import { freshDb, heroSave, makePlayer } from "@/server/db/test-helpers";

import type { SeasonRecord } from "./operator";
import { commitSeason } from "./season";
import { HELD_ERROR, HOLD_MS, checkRecord, sendSeasonRecords, type OnChainSeason, type ReadSeason, type SendRecord } from "./season-record";

const NOV6 = new Date("2026-11-06T20:00:00Z");
const CLOSED_AT = new Date(new Date("2026-11-15T00:00:00Z").getTime() + CLOSE_GRACE_MS);
const IMPLICIT = "a".repeat(64);

const notDeployed: ReadSeason = async () => {
  throw new Error("Account game.wgp.near does not exist while viewing");
};

/** A fake contract: remembers what was recorded, like `get_season`. */
function fakeChain() {
  const recorded = new Map<string, OnChainSeason>();
  const read: ReadSeason = async (id) => recorded.get(id) ?? null;
  const send = vi.fn<SendRecord>(async (r: SeasonRecord) => {
    if (recorded.has(r.seasonId)) throw new Error(`Season ${r.seasonId} is already recorded`);
    recorded.set(r.seasonId, { root: r.root, digest: r.digest, top10: r.top10, recorded_at_ms: 1 });
    return { txHash: `tx-${r.seasonId}` };
  });
  return { recorded, read, send };
}

describe("sending a season's record", () => {
  let db: Db;
  let tick = 0;

  async function score(playerId: string, points: number) {
    const at = new Date(NOV6.getTime() + ++tick * 1000);
    const [run] = await db
      .insert(runs)
      .values({ playerId, night: 1, seed: 1, ruleset: "test-1", saveRevAtStart: 1, startSave: heroSave(), status: "verified", issuedAt: NOV6, expiresAt: at })
      .returning({ id: runs.id });
    await db.transaction((tx) => recordScore(tx, { playerId, runId: run.id, score: points, ticks: 9000, issuedAt: NOV6, now: at }));
  }

  const op = async () => (await db.select().from(chainOps).where(eq(chainOps.kind, RECORD_SEASON_KIND)))[0]!;
  const season = async () => (await db.select().from(seasons).where(eq(seasons.id, "s1")))[0]!;

  beforeEach(async () => {
    db = await freshDb();
    tick = 0;
    await score((await makePlayer(db, "ana")).id, 5000);
    await score((await makePlayer(db, "ben")).id, 4000);
    await closeSeason(db, "s1", CLOSED_AT);
  });
  afterEach(() => setDb(undefined));

  it("holds the record while the contract isn't live, then sends it once, when it is", async () => {
    const chain = fakeChain();
    const t0 = new Date(CLOSED_AT.getTime() + 60_000);

    const held = await sendSeasonRecords(db, { read: notDeployed, send: chain.send, clock: () => t0 });
    expect(held).toMatchObject({ claimed: 1, held: 1, recorded: [] });
    expect(chain.send).not.toHaveBeenCalled();
    expect(await op()).toMatchObject({ status: "pending", attempts: 0, error: HELD_ERROR, txHash: null, nextAttemptAt: new Date(t0.getTime() + HOLD_MS) });
    expect((await season()).status).toBe("closed");

    // Not asked again until the hold is up.
    expect((await sendSeasonRecords(db, { read: chain.read, send: chain.send, clock: () => new Date(t0.getTime() + 1000) })).claimed).toBe(0);

    const t1 = new Date(t0.getTime() + HOLD_MS);
    const sent = await sendSeasonRecords(db, { read: chain.read, send: chain.send, clock: () => t1 });
    expect(sent.recorded).toEqual([{ seasonId: "s1", txHash: "tx-s1" }]);
    const row = await season();
    expect(chain.send).toHaveBeenCalledTimes(1);
    expect(chain.send).toHaveBeenCalledWith({ seasonId: "s1", root: row.root, digest: row.digest, top10: ["ana.wgp.testnet", "ben.wgp.testnet"] });
    expect(await op()).toMatchObject({ status: "sent", txHash: "tx-s1", error: null });
    expect(row).toMatchObject({ status: "recorded", recordTx: "tx-s1", recordedAt: t1 });

    // Done for good.
    expect((await sendSeasonRecords(db, { read: chain.read, send: chain.send, clock: () => new Date(t1.getTime() + HOLD_MS) })).claimed).toBe(0);
    expect(chain.send).toHaveBeenCalledTimes(1);
  });

  it("never sends twice when two workers race", async () => {
    const chain = fakeChain();
    const now = () => new Date(CLOSED_AT.getTime() + 60_000);
    const reports = await Promise.all([1, 2, 3].map(() => sendSeasonRecords(db, { read: chain.read, send: chain.send, clock: now })));
    expect(chain.send).toHaveBeenCalledTimes(1);
    expect(reports.reduce((n, r) => n + r.claimed, 0)).toBe(1);
  });

  it("settles a send whose answer was lost by finding it on chain, without sending again", async () => {
    const chain = fakeChain();
    const lost: SendRecord = async (r) => {
      await chain.send(r);
      throw new Error("timed out waiting for the outcome");
    };
    const t0 = new Date(CLOSED_AT.getTime() + 60_000);
    expect((await sendSeasonRecords(db, { read: chain.read, send: lost, clock: () => t0 })).failed).toBe(1);
    expect(await op()).toMatchObject({ status: "failed", attempts: 1, error: "timed out waiting for the outcome" });

    // The sweep puts it back once its backoff is up; the next pass reads the chain first.
    const t1 = new Date(t0.getTime() + 60 * 60_000);
    await sweep(db, t1);
    const report = await sendSeasonRecords(db, { read: chain.read, send: chain.send, clock: () => t1 });
    expect(report.alreadyOnChain).toEqual(["s1"]);
    expect(chain.send).toHaveBeenCalledTimes(1);
    expect(await op()).toMatchObject({ status: "sent", txHash: null });
    expect(await season()).toMatchObject({ status: "recorded", recordTx: null, recordedAt: new Date(1) });
  });

  it("sets it aside when the chain holds a different root for the season", async () => {
    const chain = fakeChain();
    chain.recorded.set("s1", { root: "f".repeat(64), digest: "e".repeat(64), top10: ["someone.near"], recorded_at_ms: 1 });
    const report = await sendSeasonRecords(db, { read: chain.read, send: chain.send, clock: () => new Date(CLOSED_AT.getTime() + 60_000) });
    expect(report.dead).toBe(1);
    expect(chain.send).not.toHaveBeenCalled();
    expect((await op()).status).toBe("dead");
    expect((await season()).status).toBe("closed");
  });

  it("gives the trophy to the name a player claimed after the close, and re-commits the root", async () => {
    const zed = await findOrCreatePlayer(db, { nearAccountId: IMPLICIT, authKind: "privy", authSub: "did:privy:zed", handle: "zed" });
    // A fresh season with zed on top, still on their implicit account at the close.
    await db.update(seasons).set({ status: "live", standings: null, root: null, digest: null, top10: null, closedAt: null }).where(eq(seasons.id, "s1"));
    await db.delete(chainOps);
    await score(zed.id, 9000);
    await closeSeason(db, "s1", CLOSED_AT);
    const atClose = await season();
    expect(atClose.top10).toEqual([IMPLICIT, "ana.wgp.testnet", "ben.wgp.testnet"]);

    await movePlayerAccount(db, { playerId: zed.id, from: IMPLICIT, to: "zed.wgp.testnet", handle: "zed" });
    const chain = fakeChain();
    await sendSeasonRecords(db, { read: chain.read, send: chain.send, clock: () => new Date(CLOSED_AT.getTime() + 60_000) });

    const row = await season();
    const standings = row.standings as SeasonStanding[];
    expect(standings[0]).toMatchObject({ rank: 1, playerId: zed.id, nearAccountId: "zed.wgp.testnet" });
    const commitment = commitSeason("s1", seasonLeaves(standings));
    expect(row).toMatchObject({ root: commitment.root, digest: commitment.digest, top10: ["zed.wgp.testnet", "ana.wgp.testnet", "ben.wgp.testnet"] });
    expect(row.root).not.toBe(atClose.root);
    expect(chain.send).toHaveBeenCalledWith({ seasonId: "s1", root: commitment.root, digest: commitment.digest, top10: ["zed.wgp.testnet", "ana.wgp.testnet", "ben.wgp.testnet"] });
    expect((await op()).payload).toEqual({ seasonId: "s1", root: commitment.root, digest: commitment.digest, top10: ["zed.wgp.testnet", "ana.wgp.testnet", "ben.wgp.testnet"] });
  });

  it("checks everything record_season would refuse before paying for the call", () => {
    const ok: SeasonRecord = { seasonId: "s1", root: "a".repeat(64), digest: "b".repeat(64), top10: ["ana.wgp.testnet"] };
    expect(() => checkRecord(ok)).not.toThrow();
    expect(() => checkRecord({ ...ok, seasonId: "S1" })).toThrow();
    expect(() => checkRecord({ ...ok, root: "abc" })).toThrow();
    expect(() => checkRecord({ ...ok, top10: [] })).toThrow();
    expect(() => checkRecord({ ...ok, top10: ["ana.wgp.testnet", "ana.wgp.testnet"] })).toThrow();
    expect(() => checkRecord({ ...ok, top10: Array.from({ length: 11 }, (_, i) => `p${i}.testnet`) })).toThrow();
    expect(() => checkRecord({ ...ok, top10: ["Not An Account"] })).toThrow();
  });
});
