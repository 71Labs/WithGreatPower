/**
 * Case File 002 on the server, with the real verifier: a chapter run issued as "case-002" on its
 * own ruleset tag, a bot's clear replayed as Case File 002, the case closed with XP and exactly
 * one `case-002` badge queued (deduped per player), unranked. Its logs never replay as a patrol
 * night or as Case File 001, nor theirs as it.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CASE_002_RULESET, CASE_XP } from "@wgp/game-core/chapters";
import { runHash, runLog, startChapterRun, stepRun } from "@wgp/game-core/replay";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";
import type { ChapterId, Save } from "@wgp/game-core/types";

import { setChapterVerifier, setVerifier } from "@/server/verify";

import { badgeKey, listCases } from "./cases";
import { setDb, type Db } from "./client";
import { rewardFromOp } from "./outbox";
import { ensureSave } from "./players";
import { activeRun, startRun, submitRun } from "./runs";
import { chainOps, leaderboardEntries, runs } from "./schema";
import { freshDb, givePlayerHero, makePlayer } from "./test-helpers";

const T0 = new Date("2026-11-07T20:00:00Z");

/** Plays a chapter as the client would: same save, same seed, the bot's inputs recorded. */
function play(save: Save, seed: number, chapter: ChapterId) {
  const run = startChapterRun(save, seed, chapter);
  if (run.error) throw new Error(run.error);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < 54_000) stepRun(run, botFrame(run.sim, mem));
  return { log: runLog(run), hash: runHash(run), ticks: run.sim.tick };
}

const after = (ticks: number, from = T0) => new Date(from.getTime() + Math.ceil(ticks / 60) * 1000 + 5000);

describe("Case File 002 on the server", () => {
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

  it("verifies a bot's clear: the case closes with XP, one case-002 badge is queued, and no board or Bits", async () => {
    await fresh("pollster");
    const { save: before } = await ensureSave(db, playerId);
    const started = await startRun(db, { playerId, chapter: "case-002", now: T0 });
    expect(started).toMatchObject({ chapter: "case-002", ruleset: CASE_002_RULESET, assist: false });
    expect(started.ruleset).toBe("c002-1");
    expect(await activeRun(db, playerId, T0)).toMatchObject({ runId: started.runId, chapter: "case-002" });
    const [row0] = await db.select().from(runs).where(eq(runs.id, started.runId));
    expect(row0.mode).toBe("case-002");
    expect(row0.ruleset).toBe("c002-1");

    const played = play(before, started.seed, "case-002");
    const at = after(played.ticks);
    const out = await submitRun(db, { playerId, runId: started.runId, log: played.log, clientHash: played.hash, now: at });
    expect(out.status).toBe("verified");
    if (out.status !== "verified") return;
    expect(out).toMatchObject({ ranked: false, bits: 0, score: 0, ticks: played.ticks });
    expect(out.chapter).toMatchObject({ id: "case-002", cleared: true, firstClear: true, badge: { status: "queued", tokenId: "trophy:badge:case-002", tx: null } });

    const { save } = await ensureSave(db, playerId);
    expect(save.cases?.["case-002"]).toEqual(out.chapter!.record);
    expect(save.cases?.["case-001"]).toBeUndefined();
    const xp = (h: Save["hero"]) => h!.level * 100_000 + h!.xp;
    expect(xp(save.hero)).toBeGreaterThan(xp(before.hero));
    expect(save.hero!.level === before.hero!.level ? save.hero!.xp - before.hero!.xp : CASE_XP).toBe(CASE_XP);

    expect(await db.select().from(leaderboardEntries)).toEqual([]);
    const ops = await db.select().from(chainOps);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "mint_reward", dedupeKey: badgeKey("case-002", playerId), status: "pending" });
    expect(ops[0].payload).toMatchObject({ runId: started.runId, items: [], badges: ["case-002"] });
    expect(rewardFromOp(ops[0])).toMatchObject({ items: [], badges: ["case-002"] });

    const listed = await listCases(db, playerId, at);
    expect(listed.map((c) => [c.id, c.status])).toEqual([
      ["case-001", "new"],
      ["case-002", "cleared"],
      ["case-003", "new"],
    ]);
    expect(listed[1]).toMatchObject({ number: "002", title: "The Sybil Vote", bestTicks: played.ticks, badge: { status: "queued" } });

    // A later clear: no XP, no second badge.
    const second = await startRun(db, { playerId, chapter: "case-002", now: at });
    const { save: now2 } = await ensureSave(db, playerId);
    const played2 = play(now2, second.seed, "case-002");
    const out2 = await submitRun(db, { playerId, runId: second.runId, log: played2.log, clientHash: played2.hash, now: after(played2.ticks, at) });
    expect(out2).toMatchObject({ status: "verified", chapter: { cleared: true, firstClear: false } });
    expect((await ensureSave(db, playerId)).save.hero).toEqual(save.hero);
    expect(await db.select().from(chainOps)).toHaveLength(1);
  }, 180_000);

  it("refuses cross-mode logs: Case File 001's for a 002 run, 002's for a 001 run and for a ranked night", async () => {
    await fresh("ballot-stuffer");
    const { save } = await ensureSave(db, playerId);
    const run2 = await startRun(db, { playerId, chapter: "case-002", now: T0 });
    const one = play(save, run2.seed, "case-001");
    const out = await submitRun(db, { playerId, runId: run2.runId, log: one.log, clientHash: one.hash, now: after(one.ticks) });
    expect(out).toMatchObject({ status: "rejected" });
    if (out.status === "rejected") expect(out.reason).toMatch(/ruleset/);

    const t1 = after(one.ticks);
    const run1 = await startRun(db, { playerId, chapter: "case-001", now: t1 });
    const two = play(save, run1.seed, "case-002");
    const out1 = await submitRun(db, { playerId, runId: run1.runId, log: two.log, clientHash: two.hash, now: after(two.ticks, t1) });
    expect(out1).toMatchObject({ status: "rejected" });
    if (out1.status === "rejected") expect(out1.reason).toMatch(/ruleset/);

    const t2 = after(two.ticks, t1);
    const ranked = await startRun(db, { playerId, now: t2 });
    const twoAgain = play(save, ranked.seed, "case-002");
    const out3 = await submitRun(db, { playerId, runId: ranked.runId, log: twoAgain.log, clientHash: twoAgain.hash, now: after(twoAgain.ticks, t2) });
    expect(out3).toMatchObject({ status: "rejected" });
    if (out3.status === "rejected") expect(out3.reason).toMatch(/ruleset/);

    expect(await db.select().from(chainOps)).toEqual([]);
    expect((await ensureSave(db, playerId)).save.cases).toBeUndefined();
  }, 180_000);
});
