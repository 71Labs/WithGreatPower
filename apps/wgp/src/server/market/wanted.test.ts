import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Save } from "@wgp/game-core/types";

import { seededPools } from "@/lib/market/config";
import { deriveWanted, WANTED_CAPS, type WantedInput } from "@/lib/market/wanted";
import { setVerifier } from "@/server/verify";

import { setDb, type Db } from "../db/client";
import { ensureSave, writeSave } from "../db/players";
import { startRun, submitRun } from "../db/runs";
import { budgetCounters, chainOps, marketSim } from "../db/schema";
import { bytes, fakeVerifier, freshDb, givePlayerHero, logHash, makePlayer } from "../db/test-helpers";
import { storedWanted, WANTED_SCOPE, wantedForRun, wantedRowId, wantedToday, type MarketReader, type WantedRow } from "./wanted";

const T0 = new Date("2026-11-15T20:00:00Z");
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

/** The seeded market with crumbs sold out and press passes low. */
function shortMarket(): WantedInput {
  const pools = seededPools().map((p) => (p.item === "crumbs" ? { ...p, stock: 0, bits: 900 } : p.item === "press-pass" ? { ...p, stock: 15, bits: 1029 } : p));
  return { pools, open: true, feeBps: 200 };
}

/** A reader that counts its calls and answers what it's given. */
function reader(input: WantedInput | null | Error): MarketReader & { calls: number } {
  const r = Object.assign(
    async () => {
      r.calls += 1;
      if (input instanceof Error) throw input;
      return input ? { onChain: true, input } : null;
    },
    { calls: 0 },
  );
  return r;
}

describe("the wanted list, frozen per day", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("snapshots the market on the day's first request and stores the snapshot with the list", async () => {
    const read = reader(shortMarket());
    const list = await wantedToday(db, T0, read);
    expect(list).toMatchObject({ day: "2026-11-15", at: T0.toISOString(), onChain: true });
    expect(list!.items.map((w) => `${w.item}×${w.multiplier}`)).toEqual(["crumbs×3", "press-pass×2"]);

    const [row] = await db.select().from(marketSim).where(eq(marketSim.id, wantedRowId("2026-11-15")));
    const stored = row.state as WantedRow;
    // Reproducible: the stored list is exactly what the stored snapshot gives.
    expect(stored.items).toEqual(deriveWanted(stored.snapshot));
  });

  it("keeps the day's list however the market moves after it, and reads the market once", async () => {
    const read = reader(shortMarket());
    const first = await wantedToday(db, T0, read);
    const calm = reader({ pools: seededPools(), open: true, feeBps: 200 });
    expect(await wantedToday(db, later(3600), calm)).toEqual(first);
    expect(calm.calls).toBe(0);
    // A new day takes a new snapshot.
    const tomorrow = await wantedToday(db, new Date("2026-11-16T00:00:01Z"), calm);
    expect(tomorrow).toMatchObject({ day: "2026-11-16", items: [] });
  });

  it("stores one list when two first requests race", async () => {
    const [a, b] = await Promise.all([wantedToday(db, T0, reader(shortMarket())), wantedToday(db, T0, reader({ pools: seededPools(), open: true, feeBps: 200 }))]);
    expect(a).toEqual(b);
  });

  it("stores nothing when the market can't be read, so the next request tries again", async () => {
    expect(await wantedToday(db, T0, reader(new Error("fetch failed")))).toBeNull();
    expect(await wantedToday(db, T0, reader(null))).toBeNull();
    expect(await storedWanted(db, "2026-11-15")).toBeNull();
    expect(await wantedToday(db, T0, reader(shortMarket()))).not.toBeNull();
  });

  it("pays a night started on an earlier day only against what that day stored", async () => {
    const read = reader(shortMarket());
    expect(await wantedForRun(db, new Date("2026-11-14T23:50:00Z"), T0, read)).toBeNull();
    expect(read.calls).toBe(0);
    await wantedToday(db, new Date("2026-11-14T12:00:00Z"), read);
    expect(await wantedForRun(db, new Date("2026-11-14T23:50:00Z"), T0, read)).toMatchObject({ day: "2026-11-14" });
  });
});

describe("a verified night and the wanted list", () => {
  let db: Db;
  let playerId: string;
  const log = bytes(1, 2, 3);
  const market = reader(shortMarket());

  beforeEach(async () => {
    db = await freshDb();
    playerId = (await makePlayer(db, "peter")).id;
    await givePlayerHero(db, playerId);
    setVerifier(fakeVerifier({ score: 4200, ticks: 60 * 200, loot: { crumbs: 3, "fee-bomb": 2 } }));
  });
  afterEach(() => {
    setVerifier(undefined);
    setDb(undefined);
  });

  async function night(at: Date) {
    const run = await startRun(db, { playerId, now: at });
    return submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: new Date(at.getTime() + 240_000), market });
  }

  /** Sleep: the next night, without the engine. */
  async function sleep() {
    const { save, rev } = await ensureSave(db, playerId);
    await writeSave(db, playerId, { ...save, night: save.night + 1, nightDone: false, patrol: null } as Save, rev, T0);
  }

  it("mints the multiplier on the wanted item only, never on the score or the Bits, and mirrors it in the save", async () => {
    const out = await night(T0);
    expect(out).toMatchObject({ status: "verified", score: 4200, bits: 47 });
    if (out.status !== "verified") throw new Error("unreachable");
    // Crumbs are sold out (×3): 3 dropped, +6 wanted, capped at +4 a night for a common.
    expect(out.wanted).toEqual([{ item: "crumbs", name: "Crumbs", multiplier: 3, brought: 3, bonus: 4, capped: "night" }]);
    expect(out.save.inventory).toEqual({ crumbs: 7, "fee-bomb": 2 });
    expect((await ensureSave(db, playerId)).save.inventory).toEqual({ crumbs: 7, "fee-bomb": 2 });

    const [op] = await db.select().from(chainOps);
    expect(op.payload).toMatchObject({
      items: [
        { tokenId: "item:bits", amount: 47 },
        { tokenId: "item:crumbs", amount: 7 },
        { tokenId: "item:fee-bomb", amount: 2 },
      ],
      wanted: out.wanted,
    });

    // An idempotent resubmit says the same.
    const run = (await db.select({ payload: chainOps.payload }).from(chainOps))[0].payload as { runId: string };
    const again = await submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: later(400), market });
    expect(again).toMatchObject({ status: "verified", idempotent: true, wanted: out.wanted });
  });

  it("holds the day's cap across nights: 8 extra commons a player a day", async () => {
    await night(T0);
    await sleep();
    const second = await night(later(600));
    await sleep();
    const third = await night(later(1200));
    if (second.status !== "verified" || third.status !== "verified") throw new Error("unreachable");
    expect(second.wanted).toEqual([expect.objectContaining({ item: "crumbs", bonus: 4, capped: "night" })]);
    expect(third.wanted).toEqual([expect.objectContaining({ item: "crumbs", bonus: 0, capped: "day" })]);
    const [used] = await db.select().from(budgetCounters).where(eq(budgetCounters.scope, WANTED_SCOPE));
    expect(used).toMatchObject({ key: `${playerId}:crumbs`, period: "2026-11-15", count: WANTED_CAPS.common.day });
  });

  it("pays a night as usual when there's no list", async () => {
    const out = await submitRun(db, {
      playerId,
      runId: (await startRun(db, { playerId, now: T0 })).runId,
      log,
      clientHash: logHash(log),
      now: later(240),
      market: reader(new Error("fetch failed")),
    });
    expect(out).toMatchObject({ status: "verified", wanted: [] });
    expect((await ensureSave(db, playerId)).save.inventory).toEqual({ crumbs: 3, "fee-bomb": 2 });
  });
});
