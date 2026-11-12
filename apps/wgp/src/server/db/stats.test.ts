/**
 * The public numbers (stats.ts) on a seeded PGlite database: every field of the answer,
 * against players and runs of each mode and status, a banned player, City saves, referrals
 * that do and don't count, and outbox rows. And the promise the endpoint makes: nothing in
 * the JSON identifies anyone. Then GET /api/stats through its real route handler: the
 * shape, the cache header and the per-IP limit.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// "use cache" is a no-op outside Next; cacheLife needs Next's cache scope.
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

import { GET } from "@/app/api/stats/route";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

import { setDb, type Db } from "./client";
import { chainOps, players, referralRewards, runs, saves } from "./schema";
import { STAT_MODES, publicStats, type PublicStats } from "./stats";
import { freshDb, heroSave, makePlayer } from "./test-helpers";

const NOW = new Date("2026-11-10T12:00:00Z");
const MAINNET = { NEAR_NETWORK: "mainnet", WGP_CONTRACT_ID: "game.wgpnear.near" };
const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 10, day, hour));

let db: Db;
const ids: Record<string, string> = {};
const runIds: string[] = [];

type Status = "issued" | "verified" | "rejected" | "expired";

async function run(who: string, mode: string, status: Status, issuedAt: Date, extra: { course?: string; ticks?: number } = {}) {
  const [row] = await db
    .insert(runs)
    .values({
      playerId: ids[who],
      mode,
      course: extra.course ?? null,
      night: 1,
      seed: 1,
      ruleset: "test-1",
      saveRevAtStart: 1,
      startSave: heroSave(),
      status,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 600_000),
      ticks: status === "verified" ? (extra.ticks ?? 3600) : null,
    })
    .returning({ id: runs.id });
  runIds.push(row.id);
}

const HANDLES = ["zz_ada", "zz_bo", "zz_cy", "zz_dee", "zz_eve", "zz_fay", "zz_gus", "zz_hal", "zz_ivy", "zz_zed"];

/** Who's who: cy and zed are banned; ada invited dee, eve, fay, ivy and zed; cy invited gus; hal never played. */
async function seed() {
  runIds.length = 0;
  for (const handle of HANDLES) {
    ids[handle] = (await makePlayer(db, handle)).id;
    await db.update(players).set({ email: `${handle}@mail.test` }).where(eq(players.id, ids[handle]));
  }
  const set = (who: string, values: Partial<typeof players.$inferInsert>) => db.update(players).set(values).where(eq(players.id, ids[who]));
  await set("zz_ada", { xHandle: "ada_on_x" });
  await set("zz_cy", { bannedAt: at(9), xHandle: "cy_on_x" });
  await set("zz_dee", { referredBy: ids.zz_ada, referredAt: at(6), xHandle: "Dee_On_X" });
  await set("zz_eve", { referredBy: ids.zz_ada, referredAt: at(6) }); // no X handle
  await set("zz_fay", { referredBy: ids.zz_ada, referredAt: at(7), xHandle: "@dee_on_x " }); // dee's handle again
  await set("zz_ivy", { referredBy: ids.zz_ada, referredAt: at(7), xHandle: "ADA_on_x" }); // the referrer's own handle
  await set("zz_zed", { referredBy: ids.zz_ada, referredAt: at(7), xHandle: "zed_on_x", bannedAt: at(8) }); // banned friend
  await set("zz_gus", { referredBy: ids.zz_cy, referredAt: at(7), xHandle: "gus_on_x" }); // banned referrer

  // ada: one of everything.
  await run("zz_ada", "trial", "verified", at(3), { course: "rooftops" }); // before the season: the first run
  await run("zz_ada", "case-001", "verified", at(8), { ticks: 10800 });
  await run("zz_ada", "patrol", "rejected", at(9));
  await run("zz_ada", "daily", "verified", at(9, 10), { course: "2026-11-09", ticks: 7200 });
  await run("zz_ada", "patrol", "verified", at(10, 10), { ticks: 10800 });
  await run("zz_ada", "trial", "verified", at(10, 11), { course: "duel" });
  await run("zz_ada", "case-002", "issued", at(10, 11));
  await run("zz_bo", "patrol", "expired", at(4));
  await run("zz_bo", "case-003", "verified", at(6), { ticks: 7200 });
  await run("zz_cy", "patrol", "verified", at(7)); // banned: counts as a match, not as a player
  await run("zz_dee", "patrol", "verified", at(8));
  await run("zz_eve", "patrol", "expired", at(9));
  await run("zz_fay", "patrol", "verified", at(8));
  await run("zz_gus", "daily", "verified", at(9), { course: "2026-11-09" });
  await run("zz_ivy", "patrol", "verified", at(8));

  // Signing in made each player a save; everyone else's has no city record (they never went out).
  const city = (who: string, record: { outings: number; tasks: Record<string, number> }) =>
    db
      .insert(saves)
      .values({ playerId: ids[who], state: { city: record } })
      .onConflictDoUpdate({ target: saves.playerId, set: { state: { city: record } } });
  await city("zz_ada", { outings: 3, tasks: { groceries: 9, selfie: 2, frontrun: 9 } });
  await city("zz_bo", { outings: 0, tasks: {} });
  await city("zz_cy", { outings: 2, tasks: { groceries: 9 } }); // banned
  await db.insert(referralRewards).values({ playerId: ids.zz_ada, goal: 3, friends: [ids.zz_dee], xp: 300 });
  const op = (kind: string, status: "pending" | "sent" | "failed", key: string) => ({ kind, status, dedupeKey: key, playerId: ids.zz_ada, payload: { accountId: "zz_ada.wgp.testnet" } });
  await db.insert(chainOps).values([op("mint_reward", "sent", "k1"), op("mint_reward", "sent", "k2"), op("mint_reward", "pending", "k3"), op("mint_import", "failed", "k4"), op("record_season", "sent", "k5")]);
}

beforeEach(async () => {
  rateLimiter.reset();
  db = await freshDb();
});
afterEach(() => setDb(undefined));

describe("publicStats", () => {
  it("counts every field", async () => {
    await seed();
    const stats = await publicStats(db, { now: NOW, env: MAINNET });
    expect(stats).toEqual({
      at: "2026-11-10T12:00:00.000Z",
      since: "2026-11-03T09:00:00.000Z",
      runs: {
        started: 15,
        verified: 11,
        rejected: 1,
        unfinished: 3,
        // 61,200 verified ticks at 60 a second: 17 minutes.
        hoursVerified: 0.3,
        byMode: {
          patrol: { started: 8, verified: 5 },
          daily: { started: 2, verified: 2 },
          trial: { started: 1, verified: 1 },
          duel: { started: 1, verified: 1 },
          "case-001": { started: 1, verified: 1 },
          "case-002": { started: 1, verified: 0 },
          "case-003": { started: 1, verified: 1 },
        },
        // Season 1 opened on Nov 5: ada's trial and bo's patrol came before it.
        season: { id: "s1", started: 13, verified: 10 },
        today: { started: 3, verified: 2 },
      },
      // Ten players, two banned. hal never played; eve never finished a match.
      players: { total: 8, played: 7, withVerifiedRun: 6 },
      // Outings and tasks take every save; the banned player isn't counted as a player.
      city: { outings: 5, players: 1, tasksDone: 3 },
      // Invited: dee, eve, fay, ivy and gus (zed is banned). Only dee counts.
      referrals: { invited: 5, qualified: 1, rewards: 1 },
      chain: { network: "mainnet", contractId: "game.wgpnear.near", rewardMints: { queued: 4, sent: 2 } },
    } satisfies PublicStats);
    expect(Object.keys(stats.runs.byMode)).toEqual([...STAT_MODES]);
  });

  it("answers zeros, every mode and no chain for a fresh database", async () => {
    const stats = await publicStats(db, { now: NOW, env: {} });
    expect(stats.since).toBeNull();
    expect(stats.runs).toMatchObject({ started: 0, verified: 0, rejected: 0, unfinished: 0, hoursVerified: 0, season: { id: "s1", started: 0, verified: 0 }, today: { started: 0, verified: 0 } });
    expect(stats.runs.byMode).toEqual(Object.fromEntries(STAT_MODES.map((mode) => [mode, { started: 0, verified: 0 }])));
    expect(stats.players).toEqual({ total: 0, played: 0, withVerifiedRun: 0 });
    expect(stats.city).toEqual({ outings: 0, players: 0, tasksDone: 0 });
    expect(stats.referrals).toEqual({ invited: 0, qualified: 0, rewards: 0 });
    expect(stats.chain).toEqual({ network: null, contractId: null, rewardMints: { queued: 0, sent: 0 } });
  });

  it("lists a mode it has no name for", async () => {
    ids.zz_ada = (await makePlayer(db, "zz_ada")).id;
    await run("zz_ada", "case-099", "verified", at(9));
    const stats = await publicStats(db, { now: NOW, env: {} });
    expect(stats.runs.byMode["case-099"]).toEqual({ started: 1, verified: 1 });
  });

  it("names nobody: no handle, account, email, X handle, player id or run id", async () => {
    await seed();
    const body = JSON.stringify(await publicStats(db, { now: NOW, env: MAINNET })).toLowerCase();
    const secrets = [
      ...HANDLES,
      ...HANDLES.map((handle) => `${handle}.wgp.testnet`),
      "wgp.testnet",
      "mail.test",
      "@",
      "sub:",
      "_on_x",
      ...Object.values(ids),
      ...runIds,
    ];
    for (const secret of secrets) expect(body).not.toContain(secret.toLowerCase());
    // And nothing shaped like a UUID at all.
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });
});

describe("GET /api/stats", () => {
  const get = (ip = "203.0.113.7") => GET(new Request("http://wgp.test/api/stats", { headers: { "x-real-ip": ip } }));

  it("answers the public shape, cached for a minute", async () => {
    await seed();
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=60");
    const body = (await response.json()) as PublicStats;
    expect(Object.keys(body)).toEqual(["at", "since", "runs", "players", "city", "referrals", "chain"]);
    expect(Object.keys(body.runs)).toEqual(["started", "verified", "rejected", "unfinished", "hoursVerified", "byMode", "season", "today"]);
    expect(Number.isNaN(Date.parse(body.at))).toBe(false);
    expect(body.since).toBe("2026-11-03T09:00:00.000Z");
    expect(body.runs).toMatchObject({ started: 15, verified: 11 });
    expect(body.players).toEqual({ total: 8, played: 7, withVerifiedRun: 6 });
    expect(body.city).toEqual({ outings: 5, players: 1, tasksDone: 3 });
    expect(body.referrals).toEqual({ invited: 5, qualified: 1, rewards: 1 });
    expect(body.chain.rewardMints).toEqual({ queued: 4, sent: 2 });
  });

  it("limits each IP on its own", async () => {
    for (let i = 0; i < RATE_LIMITS.statsPerIp.limit; i++) expect((await get()).status).toBe(200);
    const refused = await get();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await refused.json()).toMatchObject({ error: "rate_limited" });
    expect((await get("203.0.113.8")).status).toBe(200);
  });
});
