import { createHmac } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Save } from "@wgp/game-core/types";

import { secret } from "@/server/auth/secrets";
import { HttpError } from "@/server/http";
import { setVerifier, startPatrol } from "@/server/verify";

import { setDb, type Db } from "./client";
import { ensureSave, writeSave } from "./players";
import { RUNS_PER_DAY, RUN_TTL_MS, SUBMIT_GRACE_MS, activeRun, getReplay, seedFor, startRun, submitRun } from "./runs";
import { chainOps, leaderboardEntries, runs } from "./schema";
import { bytes, fakeVerifier, freshDb, givePlayerHero, logHash, makePlayer } from "./test-helpers";

const T0 = new Date("2026-11-06T20:00:00Z");
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

describe("runs", () => {
  let db: Db;
  let playerId: string;
  let rev: number;
  const verifier = fakeVerifier({ score: 4200, ticks: 60 * 200, loot: { "fee-bomb": 2, "goblin-glider": 1 } });

  beforeEach(async () => {
    db = await freshDb();
    playerId = (await makePlayer(db, "peter")).id;
    rev = await givePlayerHero(db, playerId);
    verifier.calls.length = 0;
    setVerifier(verifier);
  });
  afterEach(() => {
    setVerifier(undefined);
    setDb(undefined);
  });

  describe("start", () => {
    it("issues a run with an HMAC seed, the ruleset and the save revision", async () => {
      const run = await startRun(db, { playerId, now: T0 });
      expect(run.ruleset).toBe("test-1");
      expect(run.saveRev).toBe(rev);
      expect(run.night).toBe(1);
      expect(new Date(run.expiresAt).getTime()).toBe(T0.getTime() + RUN_TTL_MS);
      const expected = createHmac("sha256", secret("SEED_SECRET")).update(`run-seed\0${run.runId}`).digest().readUInt32BE(0);
      expect(run.seed).toBe(expected);
      expect(seedFor(run.runId)).toBe(expected);
      expect(await activeRun(db, playerId, T0)).toMatchObject({ runId: run.runId });
    });

    it("allows one run in flight, unless the old one is abandoned", async () => {
      const first = await startRun(db, { playerId, now: T0 });
      const error = await rejection(startRun(db, { playerId, now: later(5) }));
      expect(error.status).toBe(409);
      expect(error.code).toBe("run_active");
      expect(error.details?.runId).toBe(first.runId);

      const second = await startRun(db, { playerId, abandon: true, now: later(10) });
      const [old] = await db.select().from(runs).where(eq(runs.id, first.runId));
      expect(old.status).toBe("expired");
      expect(old.rejectReason).toBe("abandoned");
      expect(second.runId).not.toBe(first.runId);
    });

    it("lets a new run start once the old one's deadline has passed", async () => {
      await startRun(db, { playerId, now: T0 });
      await expect(startRun(db, { playerId, now: new Date(T0.getTime() + RUN_TTL_MS + 1) })).resolves.toBeTruthy();
    });

    it(`caps a player at ${RUNS_PER_DAY} runs a UTC day`, async () => {
      for (let i = 0; i < RUNS_PER_DAY; i++) await startRun(db, { playerId, abandon: true, now: later(i) });
      const error = await rejection(startRun(db, { playerId, abandon: true, now: later(100) }));
      expect(error.status).toBe(429);
      expect(error.code).toBe("daily_cap");
      // The next UTC day has a fresh budget.
      await expect(startRun(db, { playerId, abandon: true, now: new Date("2026-11-07T00:00:01Z") })).resolves.toBeTruthy();
    });

    it("needs a hero and an unfinished night", async () => {
      const other = await makePlayer(db, "mj");
      expect((await rejection(startRun(db, { playerId: other.id, now: T0 }))).code).toBe("no_hero");
      const { save, rev: r } = await ensureSave(db, playerId);
      await writeSave(db, playerId, { ...save, nightDone: true }, r);
      expect((await rejection(startRun(db, { playerId, now: T0 }))).code).toBe("night_done");
    });
  });

  describe("submit", () => {
    const log = bytes(1, 2, 3, 4, 5);

    it("verifies a run: save, boards, outbox and run row in one go", async () => {
      const run = await startRun(db, { playerId, now: T0 });
      const out = await submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: later(240) });

      // 4,200 points: 42 Bits, plus 5 for showing up.
      expect(out).toMatchObject({ status: "verified", score: 4200, ticks: 12000, bits: 47, ranked: true, rev: rev + 1, idempotent: false });
      if (out.status !== "verified") throw new Error("unreachable");
      expect(out.tags.sort()).toEqual(["leaderboard:alltime:all", "leaderboard:season:s1", "leaderboard:tonight:2026-11-06"]);

      // The replay started from the stored save with the patrol seeded by the server.
      const { save: stored } = await ensureSave(db, playerId);
      expect(verifier.calls[0].seed).toBe(run.seed);
      expect(verifier.calls[0].save).toEqual(startPatrol((await db.select().from(runs).where(eq(runs.id, run.runId)))[0].startSave as Save, run.seed));
      expect(stored.nightDone).toBe(true);
      expect(stored.inventory).toEqual({ "fee-bomb": 2, "goblin-glider": 1 });

      const [row] = await db.select().from(runs).where(eq(runs.id, run.runId));
      expect(row).toMatchObject({ status: "verified", verifiedScore: 4200, ticks: 12000, logBytes: 5, clientHash: logHash(log) });
      expect(row.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(Array.from(row.inputLog!)).toEqual([1, 2, 3, 4, 5]);

      const boards = await db.select().from(leaderboardEntries).where(eq(leaderboardEntries.playerId, playerId));
      expect(boards.map((b) => `${b.board}:${b.periodKey}:${b.bestScore}`).sort()).toEqual(["alltime:all:4200", "season:s1:4200", "tonight:2026-11-06:4200"]);

      const [op] = await db.select().from(chainOps);
      expect(op).toMatchObject({ kind: "mint_reward", dedupeKey: `mint_reward:${run.runId}`, status: "pending" });
      expect(op.payload).toMatchObject({
        runId: run.runId,
        accountId: "peter.wgp.testnet",
        digest: row.digest,
        items: [
          { tokenId: "item:bits", amount: 47 },
          { tokenId: "item:fee-bomb", amount: 2 },
          { tokenId: "item:goblin-glider", amount: 1 },
        ],
      });

      const replay = await getReplay(db, run.runId);
      expect(replay).toMatchObject({ runId: run.runId, seed: run.seed, score: 4200, log: Buffer.from(log).toString("base64") });
    });

    it("is idempotent: the same log returns the stored outcome without replaying again", async () => {
      const run = await startRun(db, { playerId, now: T0 });
      const first = await submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: later(240) });
      const again = await submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: later(250) });
      expect(again).toMatchObject({ status: "verified", score: 4200, bits: 47, idempotent: true });
      expect(first.status === "verified" && again.status === "verified" && again.rev).toBe(rev + 1);
      expect(verifier.calls).toHaveLength(1);
      expect(await db.select().from(chainOps)).toHaveLength(1);

      const different = await rejection(submitRun(db, { playerId, runId: run.runId, log: bytes(9), clientHash: logHash(bytes(9)), now: later(260) }));
      expect(different.code).toBe("already_submitted");
    });

    it("pays the night through the wallet taper, reading the hero's Bits, and says why it paid less", async () => {
      const run = await startRun(db, { playerId, now: T0 });
      const asked: { playerId: string; accountId: string }[] = [];
      // 4,200 points is 47 Bits; holding 275, halfway between 150 and 400, pays 5 + half of the other 42.
      const held = async (_: Db, player: { playerId: string; accountId: string }) => (asked.push(player), 275);
      const out = await submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: later(240), held });
      expect(asked).toEqual([{ playerId, accountId: "peter.wgp.testnet" }]);
      expect(out).toMatchObject({ status: "verified", score: 4200, bits: 26, taper: { full: 47, held: 275 } });
      // The score, the board and the save are the verified run's, whatever the taper paid.
      const [row] = await db.select().from(runs).where(eq(runs.id, run.runId));
      expect(row).toMatchObject({ status: "verified", verifiedScore: 4200 });
      expect((await db.select().from(leaderboardEntries).where(eq(leaderboardEntries.playerId, playerId))).every((b) => b.bestScore === 4200)).toBe(true);
      const [op] = await db.select().from(chainOps);
      expect(op.payload).toMatchObject({ items: [{ tokenId: "item:bits", amount: 26 }, { tokenId: "item:fee-bomb", amount: 2 }, { tokenId: "item:goblin-glider", amount: 1 }], taper: { full: 47, held: 275 } });
      // A resubmit answers the same number and the same reason, from the queued mint.
      const again = await submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: later(250), held: async () => 0 });
      expect(again).toMatchObject({ status: "verified", bits: 26, taper: { full: 47, held: 275 }, idempotent: true });
    });

    it("pays the whole night, with no reason attached, under the taper's lower mark or when the balance can't be read", async () => {
      for (const balance of [150, null]) {
        const run = await startRun(db, { playerId, abandon: true, now: T0 });
        const out = await submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: later(240), held: async () => balance });
        expect(out).toMatchObject({ status: "verified", bits: 47 });
        expect(out).not.toHaveProperty("taper");
        const { save, rev: r } = await ensureSave(db, playerId);
        await writeSave(db, playerId, { ...save, nightDone: false }, r);
        await db.delete(chainOps);
      }
    });

    it("never pays less than the 5 for showing up, however many Bits the hero holds", async () => {
      const run = await startRun(db, { playerId, now: T0 });
      const out = await submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: later(240), held: async () => 1_000_000 });
      expect(out).toMatchObject({ status: "verified", bits: 5, taper: { full: 47, held: 1_000_000 } });
    });

    it.each([
      ["hash_mismatch", {}, "not-the-hash", 240],
      ["too_short", { ticks: 60 * 19 }, undefined, 240],
      ["faster_than_wall_clock", { ticks: 60 * 200 }, undefined, 100],
      ["didnt_finish", { ok: false, reason: "didnt_finish" }, undefined, 240],
    ] as const)("rejects %s and stores the reason", async (reason, fake, clientHash, wallSeconds) => {
      setVerifier(fakeVerifier(fake));
      const run = await startRun(db, { playerId, now: T0 });
      const out = await submitRun(db, { playerId, runId: run.runId, log, clientHash: clientHash ?? logHash(log), now: later(wallSeconds) });
      expect(out).toEqual({ status: "rejected", runId: run.runId, reason, idempotent: false });

      const [row] = await db.select().from(runs).where(eq(runs.id, run.runId));
      expect(row.status).toBe("rejected");
      expect(row.rejectReason).toBe(reason);
      expect((await ensureSave(db, playerId)).rev).toBe(rev);
      expect(await db.select().from(leaderboardEntries)).toHaveLength(0);
      expect(await db.select().from(chainOps)).toHaveLength(0);

      // Resubmitting the same log gives the same answer.
      expect(await submitRun(db, { playerId, runId: run.runId, log, clientHash: clientHash ?? logHash(log), now: later(wallSeconds + 5) })).toMatchObject({
        status: "rejected",
        reason,
        idempotent: true,
      });
    });

    it("rejects a run issued under another ruleset", async () => {
      const run = await startRun(db, { playerId, now: T0 });
      setVerifier(fakeVerifier({}, "test-2"));
      const out = await submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: later(240) });
      expect(out).toMatchObject({ status: "rejected", reason: "ruleset_mismatch" });
    });

    it("rejects with rev_conflict when the save moved on during the run, leaving the save alone", async () => {
      const run = await startRun(db, { playerId, now: T0 });
      const { save } = await ensureSave(db, playerId);
      await writeSave(db, playerId, { ...save, reputation: 9 }, rev);

      const out = await submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: later(240) });
      expect(out).toMatchObject({ status: "rejected", reason: "rev_conflict" });
      const after = await ensureSave(db, playerId);
      expect(after.rev).toBe(rev + 1);
      expect(after.save.reputation).toBe(9);
      expect(await db.select().from(leaderboardEntries)).toHaveLength(0);
      expect(await db.select().from(chainOps)).toHaveLength(0);
      const [row] = await db.select().from(runs).where(eq(runs.id, run.runId));
      expect(row.status).toBe("rejected");
    });

    it("refuses expired runs, other players' runs and oversized logs", async () => {
      const run = await startRun(db, { playerId, now: T0 });
      const other = await makePlayer(db, "harry");
      expect((await rejection(submitRun(db, { playerId: other.id, runId: run.runId, log, clientHash: "x", now: later(240) }))).status).toBe(404);

      const big = new Uint8Array(64 * 1024 + 1);
      expect(await submitRun(db, { playerId, runId: run.runId, log: big, clientHash: logHash(big), now: later(240) })).toMatchObject({ reason: "log_too_large" });

      const run2 = await startRun(db, { playerId, now: later(300) });
      const late = new Date(later(300).getTime() + RUN_TTL_MS + SUBMIT_GRACE_MS + 1);
      expect((await rejection(submitRun(db, { playerId, runId: run2.runId, log, clientHash: logHash(log), now: late }))).status).toBe(410);
      const [row] = await db.select().from(runs).where(and(eq(runs.id, run2.runId)));
      expect(row.status).toBe("expired");
    });

    it("saves assist runs but keeps them off the boards", async () => {
      const run = await startRun(db, { playerId, assist: true, now: T0 });
      const out = await submitRun(db, { playerId, runId: run.runId, log, clientHash: logHash(log), now: later(240) });
      expect(out).toMatchObject({ status: "verified", ranked: false });
      expect(await db.select().from(leaderboardEntries)).toHaveLength(0);
      expect((await ensureSave(db, playerId)).save.nightDone).toBe(true);
    });
  });
});
