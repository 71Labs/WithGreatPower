/**
 * Competitive runs with the real verifier (src/server/db/compete.ts): the Daily Run on the
 * day's seed and the standard hero, time trials and duels, their boards, the Daily's badges,
 * and that none of them touches the save, Tonight, the Season or All time.
 */
import { buildGhost } from "@wgp/game-core/ghost";
import { trialGoldenLog } from "@wgp/game-core/golden-trial";
import { COURSES, DAILY_ATTEMPTS, dailySave, DUEL_COURSE, trialSave } from "@wgp/game-core/compete";
import { chooseErrand, needsErrand, replayRun, runHash, runLog, startRun as startClientRun, stepRun } from "@wgp/game-core/replay";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";
import type { Save } from "@wgp/game-core/types";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { setTrialVerifier, setVerifier } from "../verify";
import {
  competeBoard,
  competeView,
  dailySeed,
  dailyStreak,
  ghostsFor,
  raceTarget,
  settleDailies,
  startCompeteRun,
  type CompeteOutcome,
} from "./compete";
import { countEntries, topEntries } from "./leaderboard";
import { ensureSave } from "./players";
import { startRun, submitRun } from "./runs";
import { chainOps, leaderboardEntries, runs } from "./schema";
import { freshDb, givePlayerHero, makePlayer } from "./test-helpers";

/** Plays a patrol night as the client would, from the save and seed the server issued. */
function playNight(save: Save, seed: number, maxTicks = 54_000) {
  const run = startClientRun(save, seed);
  if (run.error) throw new Error(run.error);
  const mem = newBotMemory();
  while (!run.over && !run.error && run.sim.tick < maxTicks) {
    if (needsErrand(run)) chooseErrand(run, 0);
    else stepRun(run, botFrame(run.sim, mem));
  }
  return { log: runLog(run), hash: runHash(run), ticks: run.sim.tick };
}

const later = (at: Date, ticks: number) => new Date(at.getTime() + Math.ceil(ticks / 60) * 1000 + 5000);
const compete = (r: Awaited<ReturnType<typeof submitRun>>): CompeteOutcome => {
  if (r.status !== "verified" || !r.compete) throw new Error(`not a verified competitive run: ${JSON.stringify(r).slice(0, 200)}`);
  return r.compete;
};

beforeEach(() => {
  setVerifier(undefined);
  setTrialVerifier(undefined);
});

describe("the Daily Run", () => {
  it("issues everyone the day's seed on the standard hero, a few times a day, and never touches the save", async () => {
    const db = await freshDb();
    const a = await makePlayer(db, "daily-a");
    const b = await makePlayer(db, "daily-b");
    await givePlayerHero(db, a.id, "Alice");
    await givePlayerHero(db, b.id, "Bob");
    const now = new Date("2026-11-05T10:00:00Z");
    const ra = await startCompeteRun(db, { playerId: a.id, spec: { mode: "daily" }, now });
    const rb = await startCompeteRun(db, { playerId: b.id, spec: { mode: "daily" }, now });
    expect(ra.seed).toBe(dailySeed("2026-11-05"));
    expect(rb.seed).toBe(ra.seed);
    expect(ra.ruleset).toBe("4");
    expect(ra.compete).toMatchObject({ kind: "daily", course: "2026-11-05", ghost: null });
    expect(ra.compete.startSave).toEqual(dailySave("2026-11-05", { name: "Alice", suit: "classic" }));
    expect(rb.compete.startSave.hero!.name).toBe("Bob");
    // Another day, another city.
    expect(dailySeed("2026-11-06")).not.toBe(ra.seed);
    // One run in flight, as for a ranked night; abandoning spends the attempt.
    await expect(startCompeteRun(db, { playerId: a.id, spec: { mode: "daily" }, now })).rejects.toMatchObject({ status: 409, code: "run_active" });
    for (let i = 1; i < DAILY_ATTEMPTS; i++) await startCompeteRun(db, { playerId: a.id, spec: { mode: "daily" }, abandon: true, now });
    await expect(startCompeteRun(db, { playerId: a.id, spec: { mode: "daily" }, abandon: true, now })).rejects.toMatchObject({ status: 429, code: "daily_cap" });
    // A ranked night is still there to start (after abandoning the Daily in flight).
    const { save, rev } = await ensureSave(db, a.id);
    expect(save.patrol).toBeNull();
    const ranked = await startRun(db, { playerId: a.id, abandon: true, now });
    expect(ranked.saveRev).toBe(rev);
  });

  it("verifies a Daily like a ranked night and ranks it on the Daily board only", async () => {
    const db = await freshDb();
    const p = await makePlayer(db, "daily-real");
    await givePlayerHero(db, p.id, "Racer");
    const before = await ensureSave(db, p.id);
    const issuedAt = new Date("2026-11-05T12:00:00Z");
    const started = await startCompeteRun(db, { playerId: p.id, spec: { mode: "daily" }, now: issuedAt });
    const played = playNight(started.compete.startSave, started.seed);
    const res = await submitRun(db, { playerId: p.id, runId: started.runId, log: played.log, clientHash: played.hash, now: later(issuedAt, played.ticks) });
    expect(res.status).toBe("verified");
    if (res.status !== "verified") return;
    expect(res.ranked).toBe(false);
    expect(res.bits).toBe(0);
    expect(res.score).toBeGreaterThan(0);
    const c = compete(res);
    expect(c).toMatchObject({ kind: "daily", course: "2026-11-05", finished: true, improved: true, rank: 1, total: 1, ghost: null, won: null, streak: 1 });
    expect(c.best).toMatchObject({ score: res.score, ticks: played.ticks, runId: started.runId });
    expect(res.tags).toEqual(["leaderboard:daily:2026-11-05"]);
    // The save is untouched; the Daily never reaches Tonight, the Season or All time.
    const after = await ensureSave(db, p.id);
    expect(after.rev).toBe(before.rev);
    expect(after.save).toEqual(before.save);
    expect(await countEntries(db, "tonight", "2026-11-05")).toBe(0);
    expect(await countEntries(db, "season", "s1")).toBe(0);
    expect(await countEntries(db, "alltime", "all")).toBe(0);
    expect((await topEntries(db, "daily", "2026-11-05"))[0]).toMatchObject({ playerId: p.id, score: res.score, runId: started.runId });
    // The same log again: the stored outcome.
    const again = await submitRun(db, { playerId: p.id, runId: started.runId, log: played.log, clientHash: played.hash, now: later(issuedAt, played.ticks) });
    expect(again.status === "verified" && again.idempotent).toBe(true);
    expect(compete(again).best?.runId).toBe(started.runId);
    // A replay anyone can fetch is a ghost that reproduces the server's checkpoints.
    const [row] = await db.select().from(runs).where(eq(runs.id, started.runId));
    const ghost = buildGhost({ save: row.startSave as Save, seed: row.seed, log: row.inputLog! });
    expect(ghost.ok).toBe(true);
    expect(ghost.checkpoints).toEqual(row.checkpoints);
    expect(ghost.hash).toBe(row.clientHash);
  }, 60_000);

  it("races another player's Daily as a ghost and says who won", async () => {
    const db = await freshDb();
    const a = await makePlayer(db, "ghost-a");
    const b = await makePlayer(db, "ghost-b");
    await givePlayerHero(db, a.id, "Ace");
    await givePlayerHero(db, b.id, "Bee");
    const at = new Date("2026-11-05T13:00:00Z");
    const ra = await startCompeteRun(db, { playerId: a.id, spec: { mode: "daily" }, now: at });
    const pa = playNight(ra.compete.startSave, ra.seed);
    await submitRun(db, { playerId: a.id, runId: ra.runId, log: pa.log, clientHash: pa.hash, now: later(at, pa.ticks) });
    // B races A's ghost: the same inputs on B's save are the same run (a dead heat isn't a win).
    const rb = await startCompeteRun(db, { playerId: b.id, spec: { mode: "daily", ghost: ra.runId }, now: at });
    expect(rb.compete.ghost).toBe(ra.runId);
    const res = await submitRun(db, { playerId: b.id, runId: rb.runId, log: pa.log, clientHash: pa.hash, now: new Date(later(at, pa.ticks).getTime() + 1000) });
    const c = compete(res);
    expect(c.ghost).toMatchObject({ runId: ra.runId, handle: "ghost-a", heroName: "Ace" });
    expect(c.won).toBe(false);
    // Level on score and time: A got there first.
    expect(c.rank).toBe(2);
    expect(c.total).toBe(2);
    // B's rivals: A.
    const view = await competeView(db, b.id, at);
    expect(view.rivals).toHaveLength(1);
    expect(view.rivals[0]).toMatchObject({ ghostRunId: ra.runId, handle: "ghost-a", kind: "daily", races: 1, won: false });
    expect(view.daily.best?.runId).toBe(rb.runId);
    expect(view.daily.attempts).toEqual({ used: 1, limit: DAILY_ATTEMPTS });
    // The ghosts B would race now: A on top, and B's own best.
    const ghosts = await ghostsFor(db, { mode: "daily", playerId: b.id, now: at });
    expect(ghosts.map((g) => g.label)).toEqual(["#1", "You"]);
    // A ghost has to be from today's Daily.
    await expect(startCompeteRun(db, { playerId: a.id, spec: { mode: "daily", ghost: rb.runId }, now: new Date("2026-11-06T01:00:00Z") })).rejects.toMatchObject({ status: 400 });
  }, 90_000);
});

describe("time trials", () => {
  it("verifies a course's run, gives its medal and ranks the finish by time", async () => {
    const db = await freshDb();
    const p = await makePlayer(db, "trialist");
    await givePlayerHero(db, p.id, "Sprinter");
    const at = new Date("2026-11-05T14:00:00Z");
    const course = "canyon-swing";
    const started = await startCompeteRun(db, { playerId: p.id, spec: { mode: "trial", course }, now: at });
    expect(started).toMatchObject({ seed: COURSES[course].seed, ruleset: "trial-1" });
    expect(started.compete).toMatchObject({ kind: "trial", course, ghost: null });
    expect(started.compete.startSave).toEqual(trialSave({ name: "Sprinter", suit: "classic" }));
    // The course designer's run, played by this hero: the same race (looks change nothing).
    const log = trialGoldenLog(course);
    const replay = replayRun({ save: started.compete.startSave, seed: started.seed, log }, { trial: course });
    const res = await submitRun(db, { playerId: p.id, runId: started.runId, log, clientHash: replay.hash, now: later(at, replay.ticks) });
    const c = compete(res);
    expect(c).toMatchObject({ kind: "trial", course, finished: true, medal: "dev", improved: true, rank: 1, total: 1 });
    expect(c.ticks).toBe(COURSES[course].medals.dev);
    const [entry] = await topEntries(db, "trial", course);
    expect(entry).toMatchObject({ playerId: p.id, score: 4, ticks: COURSES[course].medals.dev });
    expect(await countEntries(db, "tonight", "2026-11-05")).toBe(0);
    const view = await competeView(db, p.id, at);
    expect(view.trials.find((t) => t.id === course)).toMatchObject({ best: { ticks: c.ticks, medal: "dev", rank: 1 }, record: { handle: "trialist" }, total: 1 });
    // A race against that run opens the course with it as the ghost.
    expect(await raceTarget(db, started.runId, at)).toMatchObject({ kind: "trial", course, opens: "trial" });
  });

  it("refuses another mode's log, and another course's", async () => {
    const db = await freshDb();
    const p = await makePlayer(db, "mixer");
    await givePlayerHero(db, p.id, "Mixer");
    const at = new Date("2026-11-05T15:00:00Z");
    const started = await startCompeteRun(db, { playerId: p.id, spec: { mode: "trial", course: "bridge-run" }, now: at });
    const sprint = trialGoldenLog("rooftop-sprint");
    const r = replayRun({ save: started.compete.startSave, seed: 0, log: sprint }, { trial: "rooftop-sprint" });
    const res = await submitRun(db, { playerId: p.id, runId: started.runId, log: sprint, clientHash: r.hash, now: later(at, r.ticks) });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.reason).toMatch(/is not trial bridge-run/);
    // A Daily won't take a trial's log either.
    const daily = await startCompeteRun(db, { playerId: p.id, spec: { mode: "daily" }, now: at });
    const res2 = await submitRun(db, { playerId: p.id, runId: daily.runId, log: sprint, clientHash: r.hash, now: later(at, r.ticks) });
    expect(res2.status).toBe("rejected");
    if (res2.status === "rejected") expect(res2.reason).toMatch(/is not 4/);
    expect(await countEntries(db, "trial", "bridge-run")).toBe(0);
  });
});

describe("duels", () => {
  it("race a ranked night on its own seed and save, verified, on no board", async () => {
    const db = await freshDb();
    const owner = await makePlayer(db, "night-owner");
    const rival = await makePlayer(db, "night-rival");
    await givePlayerHero(db, owner.id, "Owner");
    await givePlayerHero(db, rival.id, "Rival");
    const at = new Date("2026-11-06T20:00:00Z");
    const night = await startRun(db, { playerId: owner.id, now: at });
    const { save } = await ensureSave(db, owner.id);
    const played = playNight(save, night.seed);
    const ranked = await submitRun(db, { playerId: owner.id, runId: night.runId, log: played.log, clientHash: played.hash, now: later(at, played.ticks) });
    expect(ranked.status).toBe("verified");
    const tonight = await topEntries(db, "tonight", "2026-11-06");
    const season = await topEntries(db, "season", "s1");

    expect(await raceTarget(db, night.runId, at)).toMatchObject({ kind: "night", opens: "duel", handle: "night-owner" });
    const duel = await startCompeteRun(db, { playerId: rival.id, spec: { duel: night.runId }, now: at });
    expect(duel).toMatchObject({ seed: night.seed, ruleset: "4" });
    expect(duel.compete).toMatchObject({ kind: "duel", course: DUEL_COURSE, ghost: night.runId });
    expect(duel.compete.startSave.hero!.name).toBe("Rival");
    expect({ ...duel.compete.startSave.hero, name: "Owner" }).toEqual(save.hero);
    const res = await submitRun(db, { playerId: rival.id, runId: duel.runId, log: played.log, clientHash: played.hash, now: later(at, played.ticks) });
    const c = compete(res);
    expect(c).toMatchObject({ kind: "duel", course: "duel", rank: null, total: 0, best: null, won: false, ghost: { runId: night.runId, handle: "night-owner" } });
    // The Season and Tonight boards are exactly as they were; the rival's save didn't move.
    expect(await topEntries(db, "tonight", "2026-11-06")).toEqual(tonight);
    expect(await topEntries(db, "season", "s1")).toEqual(season);
    expect((await ensureSave(db, rival.id)).save.nightDone).toBe(false);
  }, 90_000);
});

describe("the Daily's badges and streaks", () => {
  it("queue a podium badge to the day's top three and a winner's to first, once, after the day settles", async () => {
    const db = await freshDb();
    const ps = await Promise.all(["one", "two", "three", "four"].map((h) => makePlayer(db, `pod-${h}`)));
    const day = "2026-11-04";
    // Four verified Daily runs on the board (inserted as the accept path leaves them).
    for (const [i, p] of ps.entries()) {
      const runId = crypto.randomUUID();
      await db.insert(runs).values({
        id: runId,
        playerId: p.id,
        mode: "daily",
        night: 3,
        seed: 1,
        ruleset: "4",
        saveRevAtStart: 0,
        startSave: dailySave(day),
        status: "verified",
        issuedAt: new Date(`${day}T10:00:00Z`),
        expiresAt: new Date(`${day}T10:45:00Z`),
        digest: "a".repeat(64),
        course: day,
      });
      await db.insert(leaderboardEntries).values({ board: "daily", periodKey: day, playerId: p.id, bestScore: 9000 - i * 100, ticks: 6000, runId });
    }
    // Not before the day's last run could have been submitted.
    expect(await settleDailies(db, new Date("2026-11-05T00:30:00Z"))).toEqual([]);
    const queued = await settleDailies(db, new Date("2026-11-05T01:00:00Z"));
    expect(queued.map((q) => `${q.badge}:${q.playerId}`).sort()).toEqual(
      [`daily-winner:${ps[0].id}`, `daily-podium:${ps[0].id}`, `daily-podium:${ps[1].id}`, `daily-podium:${ps[2].id}`].sort(),
    );
    expect(await settleDailies(db, new Date("2026-11-05T02:00:00Z"))).toEqual([]);
    const ops = await db.select().from(chainOps).where(eq(chainOps.playerId, ps[0].id));
    expect(ops.map((o) => (o.payload as { badges: string[] }).badges).flat().sort()).toEqual(["daily-podium", "daily-winner"]);
    expect(ops.every((o) => o.kind === "mint_reward" && o.rewardNonce !== null)).toBe(true);
    const view = await competeView(db, ps[0].id, new Date("2026-11-05T02:00:00Z"));
    expect(view.daily.podiums).toBe(1);
    expect(view.daily.wins).toBe(1);
    expect(view.daily.badges?.["daily-winner"].status).toBe("queued");
  });

  it("count days in a row with a verified Daily", async () => {
    const db = await freshDb();
    const p = await makePlayer(db, "streaker");
    for (const day of ["2026-11-01", "2026-11-03", "2026-11-04", "2026-11-05"]) {
      await db.insert(leaderboardEntries).values({ board: "daily", periodKey: day, playerId: p.id, bestScore: 1, ticks: 1 });
    }
    expect(await dailyStreak(db, p.id, new Date("2026-11-05T09:00:00Z"))).toBe(3);
    // Today not played yet: the streak still stands from yesterday.
    expect(await dailyStreak(db, p.id, new Date("2026-11-06T09:00:00Z"))).toBe(3);
    expect(await dailyStreak(db, p.id, new Date("2026-11-07T09:00:00Z"))).toBe(0);
  });
});

describe("competitive boards", () => {
  it("parse daily and trial:<course>, and nothing else", () => {
    const now = new Date("2026-11-05T09:00:00Z");
    expect(competeBoard("daily", null, now)).toEqual({ board: "daily", period: "2026-11-05" });
    expect(competeBoard("daily", "2026-11-01", now)).toEqual({ board: "daily", period: "2026-11-01" });
    expect(competeBoard("trial:gauntlet", null, now)).toEqual({ board: "trial", period: "gauntlet" });
    expect(competeBoard("trial", "bridge-run", now)).toEqual({ board: "trial", period: "bridge-run" });
    expect(competeBoard("trial:nope", null, now)).toBeNull();
    expect(competeBoard("tonight", null, now)).toBeNull();
    expect(competeBoard("season", null, now)).toBeNull();
  });
});
