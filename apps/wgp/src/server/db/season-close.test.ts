import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commitSeason } from "@/server/near/season";

import { setDb, type Db } from "./client";
import { topEntries, recordScore } from "./leaderboard";
import { CLOSE_GRACE_MS, RECORD_SEASON_KIND, closeSeason, freezesAt, recordSeasonKey, runSeasonPass, seasonLeaves, type SeasonStanding } from "./season-close";
import { chainOps, leaderboardEntries, players, runs, seasons } from "./schema";
import { freshDb, givePlayerHero, heroSave, makePlayer } from "./test-helpers";

const NOV6 = new Date("2026-11-06T20:00:00Z");
const NOV7 = new Date("2026-11-07T20:00:00Z");
const S1_START = new Date("2026-11-05T00:00:00Z");
const S1_END = new Date("2026-11-15T00:00:00Z");
const FREEZE = new Date(S1_END.getTime() + CLOSE_GRACE_MS);
const AFTER = new Date(FREEZE.getTime() + 60_000);

describe("closing a season", () => {
  let db: Db;
  const ids: Record<string, string> = {};
  let tick = 0;

  /** Records a verified night for `who`, issued at `issuedAt`, each a moment after the last. */
  async function score(who: string, points: number, ticks: number, issuedAt = NOV6, now?: Date) {
    const at = now ?? new Date(issuedAt.getTime() + ++tick * 1000);
    const [run] = await db
      .insert(runs)
      .values({ playerId: ids[who], night: 1, seed: 1, ruleset: "test-1", saveRevAtStart: 1, startSave: heroSave(), status: "verified", issuedAt, expiresAt: at })
      .returning({ id: runs.id });
    return db.transaction((tx) => recordScore(tx, { playerId: ids[who], runId: run.id, score: points, ticks, issuedAt, now: at }));
  }

  const season = async () => (await db.select().from(seasons).where(eq(seasons.id, "s1")))[0]!;
  const recordOps = () => db.select().from(chainOps).where(eq(chainOps.kind, RECORD_SEASON_KIND));

  beforeEach(async () => {
    db = await freshDb();
    tick = 0;
    for (const who of ["ana", "ben", "cy", "dee", "eve"]) {
      ids[who] = (await makePlayer(db, who)).id;
      await givePlayerHero(db, ids[who], who.toUpperCase());
    }
  });
  afterEach(() => setDb(undefined));

  it("waits until the freeze: the end plus time for the last runs to land", async () => {
    await score("ana", 3000, 9000);
    expect(await closeSeason(db, "s1", new Date(S1_END.getTime() + 60_000))).toBeNull();
    expect(await closeSeason(db, "s1", new Date(FREEZE.getTime() - 1))).toBeNull();
    expect((await season()).status).toBe("scheduled");
    expect(await closeSeason(db, "s1", FREEZE)).toMatchObject({ seasonId: "s1", players: 1, queued: true });
    expect(freezesAt(await season()).toISOString()).toBe(FREEZE.toISOString());
  });

  it("freezes the board as it ranks: points, then the faster nights, then who got there first", async () => {
    await score("ana", 3000, 9000, NOV6);
    await score("ana", 2000, 7000, NOV7); // ana: 5000 in 16000 ticks
    await score("ben", 5000, 15_000, NOV6); // same points, faster: ahead of ana
    await score("cy", 2500, 8000, NOV6);
    await score("cy", 2500, 8000, NOV7); // cy: 5000 in 16000, ties ana exactly but got there later
    await score("dee", 6000, 20_000, NOV7);

    const closed = await closeSeason(db, "s1", AFTER);
    const row = await season();
    const standings = row.standings as SeasonStanding[];
    expect(standings.map((s) => [s.rank, s.handle, s.score, s.ticks])).toEqual([
      [1, "dee", 6000, 20_000],
      [2, "ben", 5000, 15_000],
      [3, "ana", 5000, 16_000],
      [4, "cy", 5000, 16_000],
    ]);
    // The same order the live board showed.
    expect(standings.map((s) => s.playerId)).toEqual((await topEntries(db, "season", "s1")).map((r) => r.playerId));

    const commitment = commitSeason("s1", seasonLeaves(standings));
    expect(row).toMatchObject({ status: "closed", closedAt: AFTER, root: commitment.root, digest: commitment.digest });
    expect(row.top10).toEqual(["dee.wgp.testnet", "ben.wgp.testnet", "ana.wgp.testnet", "cy.wgp.testnet"]);
    expect(closed).toMatchObject({ players: 4, root: commitment.root, top10: row.top10, queued: true });
  });

  it("closes exactly once, however many requests race to do it", async () => {
    await score("ana", 3000, 9000);
    await score("ben", 4000, 9000);
    const results = await Promise.all([
      ...Array.from({ length: 6 }, () => closeSeason(db, "s1", AFTER)),
      ...Array.from({ length: 3 }, () => runSeasonPass(db, AFTER)),
    ]);
    const closes = results.slice(0, 6).filter(Boolean);
    const passCloses = results.slice(6).flatMap((p) => (p && "closed" in p ? p.closed : []));
    expect(closes.length + passCloses.length).toBe(1);

    const ops = await recordOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ dedupeKey: recordSeasonKey("s1"), status: "pending", playerId: null, rewardNonce: null });
    const row = await season();
    expect(ops[0]!.payload).toEqual({ seasonId: "s1", root: row.root, digest: row.digest, top10: ["ben.wgp.testnet", "ana.wgp.testnet"] });

    // Later passes find nothing to do.
    expect(await closeSeason(db, "s1", new Date(AFTER.getTime() + 3_600_000))).toBeNull();
    expect((await runSeasonPass(db, new Date(AFTER.getTime() + 3_600_000))).closed).toEqual([]);
    expect(await recordOps()).toHaveLength(1);
  });

  it("closes a season nobody played: empty standings, no root, nothing queued", async () => {
    await score("ana", 3000, 9000, new Date("2026-10-30T20:00:00Z")); // before the season
    const closed = await closeSeason(db, "s1", AFTER);
    expect(closed).toEqual({ seasonId: "s1", players: 0, root: null, digest: null, top10: [], queued: false });
    expect(await season()).toMatchObject({ status: "closed", standings: [], root: null, digest: null, top10: [] });
    expect(await recordOps()).toEqual([]);
  });

  it("leaves the frozen standings alone when a night lands after the close", async () => {
    await score("ana", 3000, 9000, NOV6);
    await score("ben", 2000, 9000, NOV6);
    await closeSeason(db, "s1", AFTER);
    const frozen = (await season()).standings;

    // A night issued inside the season but accepted after the close.
    const tags = await score("ben", 9000, 9000, NOV7, new Date(AFTER.getTime() + 1000));
    expect(tags).not.toContain("leaderboard:season:s1");
    expect(tags).toContain("leaderboard:tonight:2026-11-07");
    const [benSeason] = await db
      .select()
      .from(leaderboardEntries)
      .where(and(eq(leaderboardEntries.board, "season"), eq(leaderboardEntries.periodKey, "s1"), eq(leaderboardEntries.playerId, ids.ben)));
    expect(benSeason.bestScore).toBe(2000);
    expect((await season()).standings).toEqual(frozen);
  });

  it("keeps banned players out of the frozen standings", async () => {
    await score("ana", 3000, 9000);
    await score("eve", 9000, 9000);
    await db.update(players).set({ bannedAt: NOV7 }).where(eq(players.id, ids.eve));
    await closeSeason(db, "s1", AFTER);
    expect(((await season()).standings as SeasonStanding[]).map((s) => s.handle)).toEqual(["ana"]);
  });

  it("marks a started season live and says when it next has work", async () => {
    const before = await runSeasonPass(db, new Date("2026-11-04T12:00:00Z"));
    expect(before).toEqual({ opened: [], closed: [], nextDueAt: S1_START });
    const during = await runSeasonPass(db, NOV6);
    expect(during).toEqual({ opened: ["s1"], closed: [], nextDueAt: FREEZE });
    expect((await season()).status).toBe("live");
    expect((await runSeasonPass(db, NOV7)).opened).toEqual([]);
    const after = await runSeasonPass(db, AFTER);
    expect(after.closed.map((c) => c.seasonId)).toEqual(["s1"]);
    expect(after.nextDueAt).toBeNull();
  });

  it("commits the same root, digest, top 10 and results file as scripts/near/record-season.ts", async () => {
    const names = ["ana", "ben", "cy", "dee", "eve"];
    for (const [i, who] of names.entries()) await score(who, 1000 * (i + 1), 9000 - i);
    await closeSeason(db, "s1", AFTER);
    const row = await season();
    const standings = row.standings as SeasonStanding[];

    // The board.json the script documents: rank, accountId and score per row.
    const dir = await mkdtemp(path.join(tmpdir(), "wgp-season-"));
    try {
      const board = path.join(dir, "board.json");
      await writeFile(board, JSON.stringify(standings.map((s) => ({ rank: s.rank, accountId: s.nearAccountId, score: s.score }))));
      const script = path.resolve(process.cwd(), "../../scripts/near/record-season.ts");
      const tsx = path.resolve(process.cwd(), "node_modules/.bin/tsx");
      const { stdout } = await promisify(execFile)(tsx, [script, "s1", board, "--out", dir], { cwd: process.cwd(), env: { ...process.env, NEAR_NETWORK: "", WGP_CONTRACT_ID: "" } });
      const field = (name: string) => stdout.match(new RegExp(`^${name}\\s+(.+)$`, "m"))?.[1]?.trim() ?? "";
      expect(field("root")).toBe(row.root);
      expect(field("digest").split(/\s+/)[0]).toBe(row.digest);
      expect(field("top 10").split(", ")).toEqual(row.top10);

      const file = await readFile(path.join(dir, "season-s1.json"), "utf8");
      expect(createHash("sha256").update(file).digest("hex")).toBe(row.digest);
      expect(file).toBe(commitSeason("s1", seasonLeaves(standings)).file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("is held in the outbox: no reward nonce, so the mint worker never claims it", async () => {
    await score("ana", 3000, 9000);
    await closeSeason(db, "s1", AFTER);
    const [op] = await recordOps();
    expect(op).toMatchObject({ status: "pending", rewardNonce: null, attempts: 0 });
    const { claimRewardBatch } = await import("./outbox");
    expect(await claimRewardBatch(db, AFTER)).toEqual([]);
  });
});
