import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDb, type Db } from "./client";
import { ALLTIME_PERIOD, aroundPlayer, countEntries, rankOf, recordScore, resolvePeriod, topEntries } from "./leaderboard";
import { players, runs } from "./schema";
import { freshDb, givePlayerHero, heroSave, makePlayer } from "./test-helpers";

const NOV6 = new Date("2026-11-06T20:00:00Z");
const NOV7 = new Date("2026-11-07T20:00:00Z");
const OCT30 = new Date("2026-10-30T20:00:00Z"); // before Season 1

describe("leaderboard", () => {
  let db: Db;
  const ids: Record<string, string> = {};
  let tick = 0;

  /** Records a run for `who` issued at `issuedAt`, each one a moment after the last. */
  async function score(who: string, points: number, ticks: number, issuedAt = NOV6) {
    const now = new Date(issuedAt.getTime() + ++tick * 1000);
    const [run] = await db
      .insert(runs)
      .values({ playerId: ids[who], night: 1, seed: 1, ruleset: "test-1", saveRevAtStart: 1, startSave: heroSave(), status: "verified", issuedAt, expiresAt: now })
      .returning({ id: runs.id });
    return db.transaction((tx) => recordScore(tx, { playerId: ids[who], runId: run.id, score: points, ticks, issuedAt, now }));
  }

  beforeEach(async () => {
    db = await freshDb();
    tick = 0;
    for (const who of ["ana", "ben", "cy", "dee", "eve", "fox", "gus"]) {
      ids[who] = (await makePlayer(db, who)).id;
      await givePlayerHero(db, ids[who], who.toUpperCase());
    }
  });
  afterEach(() => setDb(undefined));

  it("ranks by score, then fewer ticks, then who got there first", async () => {
    await score("ana", 3000, 9000);
    await score("ben", 5000, 9000);
    await score("cy", 3000, 8000); // same score as ana, faster
    await score("dee", 3000, 9000); // ties ana exactly, later

    const rows = await topEntries(db, "tonight", "2026-11-06");
    expect(rows.map((r) => [r.rank, r.handle, r.score])).toEqual([
      [1, "ben", 5000],
      [2, "cy", 3000],
      [3, "ana", 3000],
      [4, "dee", 3000],
    ]);
    expect(rows[0]).toMatchObject({ heroName: "BEN", suit: "classic", nearAccountId: "ben.wgp.testnet" });
    expect(await rankOf(db, "tonight", "2026-11-06", ids.dee)).toBe(4);
    expect(await rankOf(db, "tonight", "2026-11-06", ids.eve)).toBeNull();
    expect(await countEntries(db, "tonight", "2026-11-06")).toBe(4);
  });

  it("keeps the best run per night and only improves", async () => {
    expect(await score("ana", 3000, 9000)).toContain("leaderboard:tonight:2026-11-06");
    expect(await score("ana", 2000, 5000)).toEqual([]); // worse: nothing changes
    await score("ana", 4000, 9500);
    const [row] = await topEntries(db, "tonight", "2026-11-06");
    expect(row).toMatchObject({ score: 4000, ticks: 9500 });
  });

  it("sums nightly bests into the season, and keeps the best single run all time", async () => {
    await score("ana", 3000, 9000, NOV6);
    await score("ana", 3500, 9000, NOV6); // improves Nov 6 by 500
    await score("ana", 1000, 9000, NOV6); // no change
    await score("ana", 2000, 7000, NOV7);
    await score("ana", 9000, 7000, OCT30); // before the season: tonight and all time only

    const [season] = await topEntries(db, "season", "s1");
    expect(season).toMatchObject({ score: 3500 + 2000, ticks: 9000 + 7000 });
    const [alltime] = await topEntries(db, "alltime", ALLTIME_PERIOD);
    expect(alltime.score).toBe(9000);
    expect((await topEntries(db, "tonight", "2026-11-07"))[0].score).toBe(2000);
  });

  it("returns the viewer's row with neighbours either side", async () => {
    const order = ["ana", "ben", "cy", "dee", "eve", "fox", "gus"];
    for (const [i, who] of order.entries()) await score(who, 7000 - i * 1000, 9000);

    const around = await aroundPlayer(db, "tonight", "2026-11-06", ids.dee);
    expect(around?.me).toMatchObject({ rank: 4, handle: "dee" });
    expect(around?.rows.map((r) => r.handle)).toEqual(["ben", "cy", "dee", "eve", "fox"]);

    const top = await aroundPlayer(db, "tonight", "2026-11-06", ids.ana);
    expect(top?.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(await aroundPlayer(db, "tonight", "2026-11-07", ids.ana)).toBeNull();
  });

  it("hides banned players and closes the gap they leave", async () => {
    await score("ana", 5000, 9000);
    await score("ben", 4000, 9000);
    await score("cy", 3000, 9000);
    await db.update(players).set({ bannedAt: new Date() }).where(eq(players.id, ids.ana));
    expect((await topEntries(db, "tonight", "2026-11-06")).map((r) => r.handle)).toEqual(["ben", "cy"]);
    expect(await rankOf(db, "tonight", "2026-11-06", ids.cy)).toBe(2);
    expect(await rankOf(db, "tonight", "2026-11-06", ids.ana)).toBeNull();
  });

  it("resolves the period each board means", async () => {
    expect(await resolvePeriod(db, "tonight", null, NOV6)).toBe("2026-11-06");
    expect(await resolvePeriod(db, "tonight", "2026-11-05", NOV6)).toBe("2026-11-05");
    expect(await resolvePeriod(db, "tonight", "garbage", NOV6)).toBe("2026-11-06");
    expect(await resolvePeriod(db, "season", null, NOV6)).toBe("s1");
    expect(await resolvePeriod(db, "season", null, OCT30)).toBe("s1"); // the next season, before it starts
    expect(await resolvePeriod(db, "alltime", "whatever", NOV6)).toBe("all");
  });
});
