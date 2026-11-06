/**
 * Case File 003 ("Fee Strike") on the server, with the real verifier: a case-003 run issued
 * under its own ruleset (c003-1), a bot's whole night (the clues, the chase, the bakery fight,
 * the cooled meter) replayed as case-003, the first clear closing the case and queueing its own
 * soulbound badge (trophy:badge:case-003), once. Its logs never replay as Case File 001's or a
 * patrol night's, nor theirs as its.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CASE_XP, CHAPTER_RULESET, FEE_STRIKE_RULESET } from "@wgp/game-core/chapters";
import { runHash, runLog, startChapterRun, stepRun } from "@wgp/game-core/replay";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";
import type { ChapterId, Save } from "@wgp/game-core/types";

import { setChapterVerifier, setVerifier } from "@/server/verify";

import { badgeKey, guestCases, listCases } from "./cases";
import { setDb, type Db } from "./client";
import { rewardFromOp } from "./outbox";
import { ensureSave } from "./players";
import { startRun, submitRun } from "./runs";
import { chainOps, leaderboardEntries, runs } from "./schema";
import { freshDb, givePlayerHero, makePlayer } from "./test-helpers";

const T0 = new Date("2026-11-07T20:00:00Z");

/** Plays a case as the client would: the same save and seed, the bot's inputs recorded. */
function playCase(save: Save, seed: number, chapter: ChapterId) {
  const run = startChapterRun(save, seed, chapter);
  if (run.error) throw new Error(run.error);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < 54_000) stepRun(run, botFrame(run.sim, mem));
  return { log: runLog(run), hash: runHash(run), ticks: run.sim.tick };
}

const after = (ticks: number, from = T0) => new Date(from.getTime() + Math.ceil(ticks / 60) * 1000 + 5000);

describe("Case File 003 on the server", () => {
  let db: Db;
  let playerId: string;

  beforeAll(() => {
    setVerifier(undefined);
    setChapterVerifier(undefined);
  });
  afterEach(() => {
    setVerifier(undefined);
    setChapterVerifier(undefined);
    setDb(undefined);
  });

  async function fresh(handle: string) {
    db = await freshDb();
    playerId = (await makePlayer(db, handle)).id;
    await givePlayerHero(db, playerId, handle);
  }

  it("verifies a bot's clear: the case closes with XP, its own badge is queued once, no board or Bits", async () => {
    await fresh("courier");
    const { save: before } = await ensureSave(db, playerId);
    const started = await startRun(db, { playerId, chapter: "case-003", now: T0 });
    expect(started).toMatchObject({ chapter: "case-003", ruleset: FEE_STRIKE_RULESET, assist: false });
    expect(FEE_STRIKE_RULESET).toBe("c003-1");
    const [row0] = await db.select().from(runs).where(eq(runs.id, started.runId));
    expect(row0.mode).toBe("case-003");
    expect(row0.ruleset).toBe("c003-1");

    const played = playCase(before, started.seed, "case-003");
    const at = after(played.ticks);
    const out = await submitRun(db, { playerId, runId: started.runId, log: played.log, clientHash: played.hash, now: at });
    expect(out.status).toBe("verified");
    if (out.status !== "verified") return;
    expect(out).toMatchObject({ ranked: false, bits: 0, score: 0, ticks: played.ticks, tags: [] });
    expect(out.chapter).toMatchObject({ id: "case-003", cleared: true, firstClear: true, badge: { status: "queued", tokenId: "trophy:badge:case-003", tx: null } });
    expect(out.chapter!.record).toEqual({ cleared: true, clearedAt: at.toISOString(), bestTicks: played.ticks, verified: true });

    const { save } = await ensureSave(db, playerId);
    expect(save.cases?.["case-003"]).toEqual(out.chapter!.record);
    expect(save.cases?.["case-001"]).toBeUndefined();
    const xp = (h: Save["hero"]) => h!.level * 100_000 + h!.xp;
    expect(xp(save.hero)).toBeGreaterThan(xp(before.hero));
    expect(save.hero!.level === before.hero!.level ? save.hero!.xp - before.hero!.xp : CASE_XP).toBe(CASE_XP);

    expect(await db.select().from(leaderboardEntries)).toEqual([]);
    const ops = await db.select().from(chainOps);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "mint_reward", dedupeKey: badgeKey("case-003", playerId), status: "pending" });
    expect(ops[0].payload).toMatchObject({ runId: started.runId, items: [], badges: ["case-003"] });
    expect(rewardFromOp(ops[0])).toMatchObject({ items: [], badges: ["case-003"] });

    const listed = await listCases(db, playerId, at);
    expect(listed.find((c) => c.id === "case-003")).toMatchObject({ id: "case-003", number: "003", title: "Fee Strike", status: "cleared", bestTicks: played.ticks, badge: { status: "queued" }, active: null });
    expect(listed.find((c) => c.id === "case-001")).toMatchObject({ status: "new", badge: { status: "none" } });

    // A later clear only improves the best time: no XP, no second badge.
    const second = await startRun(db, { playerId, chapter: "case-003", now: at });
    const { save: now2 } = await ensureSave(db, playerId);
    const played2 = playCase(now2, second.seed, "case-003");
    const at2 = after(played2.ticks, at);
    const out2 = await submitRun(db, { playerId, runId: second.runId, log: played2.log, clientHash: played2.hash, now: at2 });
    expect(out2).toMatchObject({ status: "verified", chapter: { cleared: true, firstClear: false } });
    const { save: save2 } = await ensureSave(db, playerId);
    expect(save2.hero).toEqual(save.hero);
    expect(save2.cases?.["case-003"]?.bestTicks).toBe(Math.min(played.ticks, played2.ticks));
    expect(await db.select().from(chainOps)).toHaveLength(1);
  }, 180_000);

  it("refuses Case File 001's log for a case-003 run, and a case-003 log for a case-001 run", async () => {
    await fresh("forger3");
    const { save } = await ensureSave(db, playerId);
    const run3 = await startRun(db, { playerId, chapter: "case-003", now: T0 });
    const one = playCase(save, run3.seed, "case-001");
    const out = await submitRun(db, { playerId, runId: run3.runId, log: one.log, clientHash: one.hash, now: after(one.ticks) });
    expect(out).toMatchObject({ status: "rejected" });
    if (out.status === "rejected") expect(out.reason).toMatch(/ruleset 201330948 is not chapter case-003/);

    const t1 = after(one.ticks);
    const run1 = await startRun(db, { playerId, chapter: "case-001", now: t1 });
    expect(run1.ruleset).toBe(CHAPTER_RULESET);
    const three = playCase(save, run1.seed, "case-003");
    const out2 = await submitRun(db, { playerId, runId: run1.runId, log: three.log, clientHash: three.hash, now: after(three.ticks, t1) });
    expect(out2).toMatchObject({ status: "rejected" });
    if (out2.status === "rejected") expect(out2.reason).toMatch(/ruleset 201339140 is not chapter case-001/);

    const t2 = after(three.ticks, t1);
    const ranked = await startRun(db, { playerId, now: t2 });
    const asNight = playCase(save, ranked.seed, "case-003");
    const out3 = await submitRun(db, { playerId, runId: ranked.runId, log: asNight.log, clientHash: asNight.hash, now: after(asNight.ticks, t2) });
    expect(out3).toMatchObject({ status: "rejected" });
    if (out3.status === "rejected") expect(out3.reason).toMatch(/ruleset 201339140 is not 4/);
    expect(await db.select().from(chainOps)).toEqual([]);
    expect((await ensureSave(db, playerId)).save.cases).toBeUndefined();
  }, 180_000);

  it("lists case 003 as new for a guest, with its own badge", () => {
    expect(guestCases()).toContainEqual({
      id: "case-003",
      number: "003",
      title: "Fee Strike",
      status: "new",
      clearedAt: null,
      bestTicks: null,
      badge: { status: "none", tokenId: "trophy:badge:case-003", tx: null },
      active: null,
    });
  });
});
