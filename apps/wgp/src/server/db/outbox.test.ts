import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Save } from "@wgp/game-core/types";

import { setVerifier } from "@/server/verify";

import { setDb, type Db } from "./client";
import { importLocalSave } from "./migrate-save";
import {
  claimRewardBatch,
  enqueueRewardMint,
  planRewardQueue,
  rewardFromOp,
  settleRewardResults,
} from "./outbox";
import { ensureSave, writeSave } from "./players";
import { startRun, submitRun } from "./runs";
import { chainOps, players, type ChainOp } from "./schema";
import { sweep } from "./sweep";
import { bytes, fakeVerifier, freshDb, givePlayerHero, heroSave, logHash, makePlayer } from "./test-helpers";

const T0 = new Date("2026-11-06T20:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const log = bytes(1, 2, 3, 4, 5);

/** Plays one verified night for the player (loot → a mint), then lets them sleep so another can start. */
async function playNight(db: Db, playerId: string, startAt: number): Promise<string> {
  const run = await startRun(db, { playerId, now: at(startAt) });
  const out = await submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: at(startAt + 240) });
  if (out.status !== "verified") throw new Error(`run ${out.status}`);
  const { save, rev } = await ensureSave(db, playerId);
  await writeSave(db, playerId, { ...save, nightDone: false } as Save, rev);
  return run.runId;
}

const mints = (db: Db) => db.select().from(chainOps).orderBy(asc(chainOps.rewardNonce));

async function nextNonce(db: Db, playerId: string): Promise<number> {
  const [p] = await db.select({ next: players.nextRewardNonce }).from(players).where(eq(players.id, playerId));
  return p!.next;
}

describe("reward nonces", () => {
  let db: Db;
  let peter: string;

  beforeEach(async () => {
    db = await freshDb();
    peter = (await makePlayer(db, "peter")).id;
    await givePlayerHero(db, peter);
    setVerifier(fakeVerifier({ loot: { "fee-bomb": 1 } }));
  });
  afterEach(() => {
    setVerifier(undefined);
    setDb(undefined);
  });

  it("gives each verified run the player's next nonce, starting at 1", async () => {
    await playNight(db, peter, 0);
    await playNight(db, peter, 600);
    await playNight(db, peter, 1200);
    expect((await mints(db)).map((m) => m.rewardNonce)).toEqual([1, 2, 3]);
    expect(await nextNonce(db, peter)).toBe(4);
  });

  it("shares one sequence between the import mint and run mints", async () => {
    const fresh = (await makePlayer(db, "miles")).id;
    await importLocalSave(db, { playerId: fresh, local: heroSave("Miles"), now: T0 });
    await playNight(db, fresh, 60);
    const rows = (await mints(db)).filter((m) => m.playerId === fresh);
    expect(rows.map((m) => [m.kind, m.rewardNonce])).toEqual([
      ["mint_import", 1],
      ["mint_reward", 2],
    ]);
  });

  it("hands out gapless, unique nonces when many mints for one player are queued at once", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        db.transaction((tx) => enqueueRewardMint(tx, { kind: "mint_reward", dedupeKey: `mint_reward:concurrent-${i}`, playerId: peter, payload: {} }, T0)),
      ),
    );
    expect(results.map((r) => r.nonce).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(results.every((r) => r.queued)).toBe(true);
    expect(await nextNonce(db, peter)).toBe(13);
  });

  it("keeps per-player sequences apart under concurrent submits", async () => {
    const others = await Promise.all(["gwen", "miles", "miguel"].map((h) => makePlayer(db, h)));
    for (const p of others) await givePlayerHero(db, p.id);
    const ids = [peter, ...others.map((p) => p.id)];
    const started = await Promise.all(ids.map((id) => startRun(db, { playerId: id, now: T0 })));
    const out = await Promise.all(
      started.map((run, i) => submitRun(db, { playerId: ids[i]!, runId: run.runId, log, clientHash: logHash(log), now: at(240) })),
    );
    expect(out.every((o) => o.status === "verified")).toBe(true);
    const rows = await mints(db);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.playerId))).toEqual(new Set(ids));
    expect(rows.every((r) => r.rewardNonce === 1)).toBe(true);
  });

  it("queues a run's mint once when the same run is submitted twice at the same time", async () => {
    const run = await startRun(db, { playerId: peter, now: T0 });
    const [a, b] = await Promise.all([
      submitRun(db, { playerId: peter, runId: run.runId, log, clientHash: logHash(log), now: at(240) }),
      submitRun(db, { playerId: peter, runId: run.runId, log, clientHash: logHash(log), now: at(241) }),
    ]);
    expect([a.status, b.status]).toEqual(["verified", "verified"]);
    expect((await mints(db)).map((m) => m.rewardNonce)).toEqual([1]);
    expect(await nextNonce(db, peter)).toBe(2);
  });

  it("is idempotent: re-queuing a dedupe key keeps its nonce and burns none", async () => {
    const op = { kind: "mint_reward" as const, dedupeKey: "mint_reward:run-a", playerId: peter, payload: {} };
    const first = await db.transaction((tx) => enqueueRewardMint(tx, op, T0));
    const again = await db.transaction((tx) => enqueueRewardMint(tx, op, at(5)));
    expect(first).toEqual({ queued: true, nonce: 1 });
    expect(again).toEqual({ queued: false, nonce: 1 });
    expect(await nextNonce(db, peter)).toBe(2);
    const next = await db.transaction((tx) => enqueueRewardMint(tx, { ...op, dedupeKey: "mint_reward:run-b" }, at(6)));
    expect(next.nonce).toBe(2);
  });

  it("rolls the nonce back with the transaction that failed to queue it", async () => {
    await expect(
      db.transaction(async (tx) => {
        await enqueueRewardMint(tx, { kind: "mint_reward", dedupeKey: "mint_reward:doomed", playerId: peter, payload: {} }, T0);
        throw new Error("the run write failed");
      }),
    ).rejects.toThrow("the run write failed");
    expect(await nextNonce(db, peter)).toBe(1);
    const ok = await db.transaction((tx) => enqueueRewardMint(tx, { kind: "mint_reward", dedupeKey: "mint_reward:next", playerId: peter, payload: {} }, T0));
    expect(ok.nonce).toBe(1);
  });
});

describe("reward batches", () => {
  const row = (playerId: string, nonce: number, status: ChainOp["status"] = "pending", over: Partial<ChainOp> = {}) =>
    ({ id: `${playerId}-${nonce}`, playerId, rewardNonce: nonce, status, nextAttemptAt: T0, createdAt: at(nonce), ...over }) as Pick<
      ChainOp,
      "id" | "playerId" | "rewardNonce" | "status" | "nextAttemptAt" | "createdAt"
    >;

  it("sends, per player, only an unbroken run of nonces from the lowest one not on chain", () => {
    const plan = planRewardQueue(
      [
        row("a", 2),
        row("a", 3),
        row("a", 4, "failed"),
        row("a", 5),
        row("b", 1, "sending"),
        row("b", 2),
        row("c", 1, "pending", { nextAttemptAt: at(60) }),
        row("c", 2),
        row("d", 1),
        row("d", 3),
      ],
      T0,
    );
    expect(plan.map((r) => r.id)).toEqual(["d-1", "a-2", "a-3"]);
  });

  it("orders players oldest first and cuts a batch without breaking anyone's order", () => {
    const rows = [row("a", 1, "pending", { createdAt: at(10) }), row("a", 2), row("a", 3), row("b", 1, "pending", { createdAt: at(0) }), row("b", 2)];
    expect(planRewardQueue(rows, T0, 3).map((r) => r.id)).toEqual(["b-1", "b-2", "a-1"]);
  });

  describe("claim and settle", () => {
    let db: Db;
    let peter: string;
    let gwen: string;

    beforeEach(async () => {
      db = await freshDb();
      peter = (await makePlayer(db, "peter")).id;
      gwen = (await makePlayer(db, "gwen")).id;
      // Peter's mints are queued first (seconds 0–2), Gwen's after (second 5).
      for (const [id, n, from] of [
        [peter, 3, 0],
        [gwen, 1, 5],
      ] as const) {
        for (let i = 0; i < n; i++) {
          await db.transaction((tx) =>
            enqueueRewardMint(
              tx,
              {
                kind: "mint_reward",
                dedupeKey: `mint_reward:${id}-${i}`,
                playerId: id,
                payload: { accountId: `${id}.wgp.testnet`, items: [{ tokenId: "item:fee-bomb", amount: 1 }], level: 2, digest: "ab".repeat(32) },
              },
              at(from + i),
            ),
          );
        }
      }
    });
    afterEach(() => setDb(undefined));

    it("claims in nonce order and never sends a later nonce while an earlier one is in flight", async () => {
      const batch = await claimRewardBatch(db, at(10), 2);
      expect(batch.map((r) => [r.playerId, r.rewardNonce])).toEqual([
        [peter, 1],
        [peter, 2],
      ]);
      // Peter's 1 and 2 are in flight, so his 3 waits; Gwen's 1 can go.
      expect((await claimRewardBatch(db, at(11))).map((r) => [r.playerId, r.rewardNonce])).toEqual([[gwen, 1]]);
      expect(await claimRewardBatch(db, at(12))).toEqual([]);
    });

    it("resends a failed mint with the same nonce, and moves on once the contract applies it", async () => {
      const [first] = await claimRewardBatch(db, at(10), 1);
      expect(first!.rewardNonce).toBe(1);
      await settleRewardResults(db, [{ key: first!.id, status: "failed", error: "rpc timeout" }], at(10));
      // Nothing for Peter until his nonce 1 is retried: 2 and 3 must not jump the queue.
      expect((await claimRewardBatch(db, at(11))).map((r) => r.playerId)).toEqual([gwen]);

      await sweep(db, at(120));
      const [retry] = await claimRewardBatch(db, at(120), 1);
      expect(retry).toMatchObject({ id: first!.id, rewardNonce: 1, attempts: 2 });

      // The first send had landed after all: the contract says duplicate, which is done too.
      await settleRewardResults(db, [{ key: retry!.id, status: "duplicate", txHash: "tx1" }], at(121));
      const next = await claimRewardBatch(db, at(122));
      expect(next.map((r) => r.rewardNonce)).toEqual([2, 3]);
      await settleRewardResults(db, next.map((r) => ({ key: r.id, status: "applied" as const, txHash: "tx2" })), at(123));
      const rows = await db.select().from(chainOps).where(eq(chainOps.playerId, peter));
      expect(rows.every((r) => r.status === "sent")).toBe(true);
    });

    it("puts out-of-order mints back to wait for their predecessor", async () => {
      const batch = await claimRewardBatch(db, at(10), 3);
      await settleRewardResults(
        db,
        [
          { key: batch[0]!.id, status: "failed", error: "boom" },
          { key: batch[1]!.id, status: "out_of_order" },
          { key: batch[2]!.id, status: "out_of_order" },
        ],
        at(10),
      );
      const rows = await db.select().from(chainOps).where(eq(chainOps.playerId, peter)).orderBy(asc(chainOps.rewardNonce));
      expect(rows.map((r) => r.status)).toEqual(["failed", "pending", "pending"]);
      expect(await claimRewardBatch(db, at(3600))).toEqual(expect.not.arrayContaining([expect.objectContaining({ playerId: peter })]));
    });

    it("maps a claimed row to the operator's reward with its stored nonce", async () => {
      const [op] = await claimRewardBatch(db, at(10), 1);
      expect(rewardFromOp(op!)).toEqual({
        key: op!.id,
        accountId: `${peter}.wgp.testnet`,
        nonce: 1,
        items: [{ item: "fee-bomb", amount: 1 }],
        level: 2,
        digest: "ab".repeat(32),
      });
    });
  });

  it("maps the import mint's trophy to the contract's day-one badge", async () => {
    const db = await freshDb();
    try {
      const miles = await makePlayer(db, "miles");
      await importLocalSave(db, { playerId: miles.id, local: heroSave("Miles"), now: T0 });
      const [op] = await claimRewardBatch(db, at(1));
      const reward = rewardFromOp(op!);
      expect(reward).toMatchObject({ accountId: "miles.wgp.testnet", nonce: 1, badges: ["day-one"], level: 1 });
      expect(reward.digest).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      setDb(undefined);
    }
  });
});
