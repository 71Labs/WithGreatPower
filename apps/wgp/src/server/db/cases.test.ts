/**
 * Case File 001 on the server, with the real verifier: the server issues a chapter run, a bot
 * plays the chapter through game-core in "the browser", the log is submitted and replayed as
 * the chapter, and the first clear closes the case in the save and queues exactly one badge.
 * Chapter runs never reach a board or a Bits mint, and neither log replays as the other.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CASE_XP, CHAPTER_RULESET } from "@wgp/game-core/chapters";
import { chooseErrand, needsErrand, runHash, runLog, startChapterRun, startRun as startClientRun, stepRun } from "@wgp/game-core/replay";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";
import type { Save } from "@wgp/game-core/types";

import { HttpError } from "@/server/http";
import { setChapterVerifier, setVerifier } from "@/server/verify";

import { badgeKey, CASE_RUNS_PER_DAY, guestCases, listCases } from "./cases";
import { setDb, type Db } from "./client";
import { rewardFromOp } from "./outbox";
import { ensureSave, writeSave } from "./players";
import { activeRun, startRun, submitRun } from "./runs";
import { chainOps, leaderboardEntries, runs } from "./schema";
import { fakeVerifier, freshDb, givePlayerHero, logHash, makePlayer } from "./test-helpers";

const T0 = new Date("2026-11-06T20:00:00Z");

/** Plays the chapter as the client would: same save, same seed, the bot's inputs recorded. */
function playCase(save: Save, seed: number) {
  const run = startChapterRun(save, seed, "case-001");
  if (run.error) throw new Error(run.error);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < 54_000) stepRun(run, botFrame(run.sim, mem));
  return { log: runLog(run), hash: runHash(run), ticks: run.sim.tick };
}

function playNight(save: Save, seed: number) {
  const run = startClientRun(save, seed);
  if (run.error) throw new Error(run.error);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < 54_000) {
    if (needsErrand(run)) chooseErrand(run, 0);
    else stepRun(run, botFrame(run.sim, mem));
  }
  return { log: runLog(run), hash: runHash(run), ticks: run.sim.tick };
}

const after = (ticks: number, from = T0) => new Date(from.getTime() + Math.ceil(ticks / 60) * 1000 + 5000);

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

describe("Case File 001 on the server", () => {
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

  it("verifies a bot's clear: the case closes with XP, one badge is queued, and no board or Bits", async () => {
    await fresh("detective");
    const { save: before } = await ensureSave(db, playerId);
    const started = await startRun(db, { playerId, chapter: "case-001", now: T0 });
    expect(started).toMatchObject({ chapter: "case-001", ruleset: CHAPTER_RULESET, assist: false });
    expect(await activeRun(db, playerId, T0)).toMatchObject({ runId: started.runId, chapter: "case-001" });
    const [row0] = await db.select().from(runs).where(eq(runs.id, started.runId));
    expect(row0.mode).toBe("case-001");

    const played = playCase(before, started.seed);
    const at = after(played.ticks);
    const out = await submitRun(db, { playerId, runId: started.runId, log: played.log, clientHash: played.hash, now: at });
    expect(out.status).toBe("verified");
    if (out.status !== "verified") return;
    expect(out).toMatchObject({ ranked: false, bits: 0, score: 0, ticks: played.ticks, tags: [] });
    expect(out.chapter).toMatchObject({ id: "case-001", cleared: true, firstClear: true, badge: { status: "queued", tokenId: "trophy:badge:case-001", tx: null } });
    expect(out.chapter!.record).toEqual({ cleared: true, clearedAt: at.toISOString(), bestTicks: played.ticks, verified: true });

    const { save } = await ensureSave(db, playerId);
    expect(save.cases?.["case-001"]).toEqual(out.chapter!.record);
    const xp = (h: Save["hero"]) => h!.level * 100_000 + h!.xp;
    expect(xp(save.hero)).toBeGreaterThan(xp(before.hero));
    expect(save.hero!.level === before.hero!.level ? save.hero!.xp - before.hero!.xp : CASE_XP).toBe(CASE_XP);
    // The patrol is untouched: a case is played on any night.
    expect(save.nightDone).toBe(before.nightDone);
    expect(save.patrol).toEqual(before.patrol);

    // Unranked: nothing on any board, no Bits mint; one badge mint.
    expect(await db.select().from(leaderboardEntries)).toEqual([]);
    const ops = await db.select().from(chainOps);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "mint_reward", dedupeKey: badgeKey("case-001", playerId), status: "pending", rewardNonce: 1 });
    expect(ops[0].payload).toMatchObject({ runId: started.runId, items: [], badges: ["case-001"], accountId: "detective.wgp.testnet" });
    expect(rewardFromOp(ops[0])).toMatchObject({ items: [], badges: ["case-001"], nonce: 1 });

    const [listed] = await listCases(db, playerId, at);
    expect(listed).toMatchObject({ id: "case-001", number: "001", status: "cleared", bestTicks: played.ticks, badge: { status: "queued" }, active: null });

    // The same log again: the stored outcome.
    const again = await submitRun(db, { playerId, runId: started.runId, log: played.log, clientHash: played.hash, now: at });
    expect(again).toMatchObject({ status: "verified", idempotent: true, ranked: false, bits: 0, chapter: { cleared: true, firstClear: true } });

    // A later clear only improves the best time: no XP, no second badge.
    const second = await startRun(db, { playerId, chapter: "case-001", now: at });
    const { save: now2 } = await ensureSave(db, playerId);
    const played2 = playCase(now2, second.seed);
    const at2 = after(played2.ticks, at);
    const out2 = await submitRun(db, { playerId, runId: second.runId, log: played2.log, clientHash: played2.hash, now: at2 });
    expect(out2).toMatchObject({ status: "verified", chapter: { cleared: true, firstClear: false } });
    const { save: save2 } = await ensureSave(db, playerId);
    expect(save2.hero).toEqual(save.hero);
    expect(save2.cases?.["case-001"]).toEqual({ ...save.cases!["case-001"]!, bestTicks: Math.min(played.ticks, played2.ticks) });
    expect(await db.select().from(chainOps)).toHaveLength(1);
  }, 120_000);

  it("refuses a patrol log for a chapter run, and a chapter log for a ranked night", async () => {
    await fresh("forger");
    const { save } = await ensureSave(db, playerId);
    const chapterRun = await startRun(db, { playerId, chapter: "case-001", now: T0 });
    const night = playNight(save, chapterRun.seed);
    const out = await submitRun(db, { playerId, runId: chapterRun.runId, log: night.log, clientHash: night.hash, now: after(night.ticks) });
    expect(out).toMatchObject({ status: "rejected" });
    if (out.status === "rejected") expect(out.reason).toMatch(/ruleset/);

    const ranked = await startRun(db, { playerId, now: after(night.ticks) });
    const played = playCase(save, ranked.seed);
    const out2 = await submitRun(db, { playerId, runId: ranked.runId, log: played.log, clientHash: played.hash, now: after(played.ticks, after(night.ticks)) });
    expect(out2).toMatchObject({ status: "rejected" });
    if (out2.status === "rejected") expect(out2.reason).toMatch(/ruleset/);
    expect(await db.select().from(chainOps)).toEqual([]);
    expect((await ensureSave(db, playerId)).save.cases).toBeUndefined();
  }, 120_000);

  it("starts on any night, on its own budget, but shares the one-run-in-flight rule", async () => {
    await fresh("insomniac");
    // One run in flight, whichever kind: a ranked night blocks a case, and the other way round.
    const ranked = await startRun(db, { playerId, now: T0 });
    expect((await rejection(startRun(db, { playerId, chapter: "case-001", now: T0 }))).code).toBe("run_active");
    const first = await startRun(db, { playerId, chapter: "case-001", abandon: true, now: T0 });
    expect(first.chapter).toBe("case-001");
    expect((await db.select().from(runs).where(eq(runs.id, ranked.runId)))[0].status).toBe("expired");
    // Tonight done (or a patrol under way): a case still opens.
    const { save, rev } = await ensureSave(db, playerId);
    await writeSave(db, playerId, { ...save, nightDone: true }, rev);
    expect((await rejection(startRun(db, { playerId, abandon: true, now: T0 }))).code).toBe("night_done");
    for (let i = 1; i < CASE_RUNS_PER_DAY; i++) await startRun(db, { playerId, chapter: "case-001", abandon: true, now: new Date(T0.getTime() + i * 1000) });
    const capped = await rejection(startRun(db, { playerId, chapter: "case-001", abandon: true, now: new Date(T0.getTime() + 60_000) }));
    expect(capped.status).toBe(429);
    expect(capped.code).toBe("daily_cap");
    expect((await rejection(startRun(db, { playerId, chapter: "case-999" as "case-001", now: T0 }))).code).toBe("no_chapter");
  });

  it("an uncleared attempt is verified but closes nothing", async () => {
    await fresh("unlucky");
    setChapterVerifier(fakeVerifier({ score: 0, ticks: 60 * 90, loot: {}, stats: { chapter: 1, cleared: 0 } }, CHAPTER_RULESET));
    const started = await startRun(db, { playerId, chapter: "case-001", now: T0 });
    const log = new Uint8Array([1, 2, 3]);
    const out = await submitRun(db, { playerId, runId: started.runId, log, clientHash: logHash(log), now: after(60 * 90) });
    expect(out).toMatchObject({ status: "verified", ranked: false, bits: 0, chapter: { cleared: false, firstClear: false, badge: { status: "none" } } });
    expect((await ensureSave(db, playerId)).save.cases).toBeUndefined();
    expect(await db.select().from(chainOps)).toEqual([]);
    const [listed] = await listCases(db, playerId, T0);
    expect(listed.status).toBe("new");
  });

  it("lists every case as new for a guest", () => {
    expect(guestCases()).toEqual([
      { id: "case-001", number: "001", title: "Missing: Mary Jpeg", status: "new", clearedAt: null, bestTicks: null, badge: { status: "none", tokenId: "trophy:badge:case-001", tx: null }, active: null },
    ]);
  });
});
