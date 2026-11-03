/**
 * The mint worker and GET /api/cron/mint against a fake chain that keeps nonces the way
 * the contract does: nonce order, every contract outcome, idempotent resends, malformed
 * rows, and failing closed without a secret or NEAR settings.
 */
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as mintRoute } from "@/app/api/cron/mint/route";
import { setDb, type Db } from "@/server/db/client";
import { enqueueRewardMint } from "@/server/db/outbox";
import { chainOps, type Player } from "@/server/db/schema";
import { sweep } from "@/server/db/sweep";
import { freshDb, makePlayer } from "@/server/db/test-helpers";
import { assertCron } from "@/server/http";

import { drainRewards, prepareRewards, type SendRewards } from "./mint-worker";
import type { Reward, RewardResult, RewardStatus } from "./operator";

const operator = vi.hoisted(() => ({ send: vi.fn<(rewards: Reward[]) => Promise<RewardResult[]>>() }));
vi.mock("./operator", async (importOriginal) => ({ ...(await importOriginal<typeof import("./operator")>()), sendRewards: operator.send }));

const T0 = new Date("2026-11-06T20:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const digest = (n: number) => n.toString(16).padStart(64, "0");
const KEY = `ed25519:${"3".repeat(20)}${"A".repeat(40)}`;

let seq = 0;
async function queueMint(db: Db, player: Player, payload: Record<string, unknown> = {}, now = T0) {
  seq += 1;
  return db.transaction((tx) =>
    enqueueRewardMint(
      tx,
      {
        kind: "mint_reward",
        dedupeKey: `mint_reward:run-${seq}`,
        playerId: player.id,
        payload: { accountId: player.nearAccountId, items: [{ tokenId: "item:fee-bomb", amount: 1 }], level: 2, digest: digest(seq), ...payload },
      },
      now,
    ),
  );
}

/** Applies a reward only at the account's nonce + 1, like `mint_rewards`. */
function fakeChain(override?: (r: Reward) => RewardStatus | null) {
  const nonces = new Map<string, number>();
  const calls: Reward[][] = [];
  const send: SendRewards = async (rewards) => {
    calls.push(rewards);
    const txHash = `tx-${calls.length}`;
    return rewards.map((r) => {
      const forced = override?.(r);
      if (forced) return { key: r.key, status: forced, txHash };
      const last = nonces.get(r.accountId) ?? 0;
      if (r.nonce <= last) return { key: r.key, status: "duplicate" as const, txHash };
      if (r.nonce !== last + 1) return { key: r.key, status: "out_of_order" as const, txHash };
      nonces.set(r.accountId, r.nonce);
      return { key: r.key, status: "applied" as const, txHash };
    });
  };
  return { send, nonces, calls };
}

const rows = (db: Db) => db.select().from(chainOps).orderBy(asc(chainOps.playerId), asc(chainOps.rewardNonce));

describe("the mint worker", () => {
  let db: Db;
  let peter: Player;
  let miles: Player;

  beforeEach(async () => {
    db = await freshDb();
    peter = await makePlayer(db, "peter");
    miles = await makePlayer(db, "miles");
  });
  afterEach(() => setDb(undefined));

  it("sends queued mints in one batch, each account's nonces ascending, and marks them sent", async () => {
    for (let i = 0; i < 3; i++) await queueMint(db, peter);
    for (let i = 0; i < 2; i++) await queueMint(db, miles);
    const chain = fakeChain();

    const report = await drainRewards(db, { send: chain.send, clock: () => at(1) });

    expect(chain.calls).toHaveLength(1);
    const sent = chain.calls[0]!;
    expect(sent.filter((r) => r.accountId === peter.nearAccountId).map((r) => r.nonce)).toEqual([1, 2, 3]);
    expect(sent.filter((r) => r.accountId === miles.nearAccountId).map((r) => r.nonce)).toEqual([1, 2]);
    expect(sent[0]).toMatchObject({ items: [{ item: "fee-bomb", amount: 1 }], level: 2 });
    expect(report).toMatchObject({ batches: 1, claimed: 5, applied: 5, failed: 0, txHashes: ["tx-1"] });
    expect((await rows(db)).every((r) => r.status === "sent" && r.txHash === "tx-1")).toBe(true);
  });

  it("is idempotent: another pass sends nothing, and a resend after a lost answer is a duplicate", async () => {
    await queueMint(db, peter);
    const chain = fakeChain();
    await drainRewards(db, { send: chain.send, clock: () => at(1) });
    expect((await drainRewards(db, { send: chain.send, clock: () => at(2) })).claimed).toBe(0);
    expect(chain.calls).toHaveLength(1);

    // The chain applies the next mint, but the answer never arrives.
    await queueMint(db, peter);
    const lost: SendRewards = async (rewards) => {
      await chain.send(rewards);
      throw new Error("socket hang up");
    };
    expect(await drainRewards(db, { send: lost, clock: () => at(10) })).toMatchObject({ claimed: 1, failed: 1 });
    expect((await rows(db))[1]).toMatchObject({ status: "failed", error: "socket hang up" });

    await sweep(db, at(120));
    const report = await drainRewards(db, { send: chain.send, clock: () => at(121) });
    expect(report).toMatchObject({ claimed: 1, duplicate: 1, applied: 0 });
    expect((await rows(db)).map((r) => r.status)).toEqual(["sent", "sent"]);
    expect(chain.nonces.get(peter.nearAccountId)).toBe(2);
  });

  it("sends at most 20 per batch and drains a backlog over several batches", async () => {
    const third = await makePlayer(db, "gwen");
    for (const p of [peter, miles, third]) for (let i = 0; i < 15; i++) await queueMint(db, p);
    const chain = fakeChain();

    const report = await drainRewards(db, { send: chain.send, clock: () => at(1) });

    expect(chain.calls.map((c) => c.length)).toEqual([20, 20, 5]);
    expect(report).toMatchObject({ batches: 3, claimed: 45, applied: 45, outOfOrder: 0 });
    for (const p of [peter, miles, third]) expect(chain.nonces.get(p.nearAccountId)).toBe(15);
  });

  it("stops after MAX_BATCHES_PER_PASS batches and leaves the rest for the next pass", async () => {
    for (let i = 0; i < 7; i++) await queueMint(db, peter);
    const chain = fakeChain();
    const report = await drainRewards(db, { send: chain.send, clock: () => at(1), batchSize: 2, maxBatches: 2 });
    expect(report).toMatchObject({ batches: 2, applied: 4 });
    expect((await rows(db)).filter((r) => r.status === "pending")).toHaveLength(3);
  });

  it("records out_of_order as waiting, and full as a failure that backs off", async () => {
    await queueMint(db, peter);
    await queueMint(db, miles);
    const chain = fakeChain((r) => (r.accountId === peter.nearAccountId ? "out_of_order" : "full"));

    const report = await drainRewards(db, { send: chain.send, clock: () => at(1) });

    expect(report).toMatchObject({ outOfOrder: 1, full: 1, applied: 0 });
    const [p, m] = [(await rows(db)).find((r) => r.playerId === peter.id)!, (await rows(db)).find((r) => r.playerId === miles.id)!];
    expect(p).toMatchObject({ status: "pending", error: expect.stringMatching(/^out_of_order/) });
    expect(p.nextAttemptAt.getTime()).toBeGreaterThan(at(1).getTime());
    expect(m).toMatchObject({ status: "failed", error: expect.stringMatching(/^full/) });
    // Neither is due again in this pass.
    expect((await drainRewards(db, { send: chain.send, clock: () => at(2) })).claimed).toBe(0);
  });

  it("fails the whole batch when the send throws, and stops the pass", async () => {
    for (let i = 0; i < 3; i++) await queueMint(db, peter);
    const boom = vi.fn<SendRewards>(async () => {
      throw new Error("rpc down");
    });
    const report = await drainRewards(db, { send: boom, clock: () => at(1), batchSize: 2 });
    expect(boom).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ batches: 1, claimed: 2, failed: 2 });
    expect((await rows(db)).map((r) => r.status)).toEqual(["failed", "failed", "pending"]);
  });

  it("treats a reward the chain didn't answer for as failed", async () => {
    await queueMint(db, peter);
    await queueMint(db, miles);
    const partial: SendRewards = async (rewards) => [{ key: rewards[0]!.key, status: "applied", txHash: "tx" }];
    expect(await drainRewards(db, { send: partial, clock: () => at(1) })).toMatchObject({ applied: 1, failed: 1 });
  });

  it("sets a malformed mint aside as dead, holds back that player's later mints, and sends everyone else", async () => {
    await queueMint(db, peter, { digest: "not-hex" });
    await queueMint(db, peter);
    await queueMint(db, miles);
    const chain = fakeChain();

    const report = await drainRewards(db, { send: chain.send, clock: () => at(1) });

    expect(report).toMatchObject({ claimed: 3, dead: 1, released: 1, applied: 1 });
    expect(chain.calls[0]!.map((r) => r.accountId)).toEqual([miles.nearAccountId]);
    const mine = (await rows(db)).filter((r) => r.playerId === peter.id);
    expect(mine.map((r) => [r.rewardNonce, r.status, r.attempts])).toEqual([
      [1, "dead", 1],
      [2, "pending", 0],
    ]);
    expect(mine[0]!.error).toMatch(/^malformed: .*Digest/);
    // The dead nonce keeps blocking: nonce 2 never leaves before 1.
    expect((await drainRewards(db, { send: chain.send, clock: () => at(600) })).claimed).toBe(0);
  });

  it("checks everything the contract would refuse before sending", () => {
    const op = (payload: Record<string, unknown>) =>
      ({ id: "op", kind: "mint_reward", playerId: "p", rewardNonce: 1, payload: { accountId: "a.near", digest: digest(1), ...payload } }) as never;
    expect(prepareRewards([op({ items: [{ tokenId: "item:fee-bomb", amount: 2 }], level: 3 })]).send).toHaveLength(1);
    for (const bad of [
      { items: [{ tokenId: "item:fee-bomb", amount: 0 }] },
      { items: [{ tokenId: "item:fee-bomb", amount: 1001 }] },
      { items: [{ tokenId: "item:Fee Bomb", amount: 1 }] },
      { items: [{ tokenId: "suit:stealth", amount: 1 }] },
      { level: 0.5 },
      { digest: "AB".repeat(32) },
      { accountId: undefined },
    ]) {
      expect(prepareRewards([op(bad)]).dead, JSON.stringify(bad)).toHaveLength(1);
    }
  });
});

describe("GET /api/cron/mint", () => {
  let db: Db;
  let peter: Player;
  const call = (auth?: string) => mintRoute(new Request("http://test/api/cron/mint", { headers: auth ? { authorization: auth } : {} }));

  beforeEach(async () => {
    db = await freshDb();
    peter = await makePlayer(db, "peter");
    // The route runs on the wall clock, so the mint must already be due.
    await queueMint(db, peter, {}, new Date(Date.now() - 60_000));
    operator.send.mockReset();
    vi.stubEnv("CRON_SECRET", "cron-secret-cron-secret");
    for (const name of ["NEAR_NETWORK", "WGP_CONTRACT_ID", "OPERATOR_ACCOUNT_ID", "OPERATOR_PRIVATE_KEY"]) vi.stubEnv(name, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setDb(undefined);
  });

  const configure = () => {
    vi.stubEnv("NEAR_NETWORK", "mainnet");
    vi.stubEnv("WGP_CONTRACT_ID", "game.wgpnear.near");
    vi.stubEnv("OPERATOR_ACCOUNT_ID", "operator.wgpnear.near");
    vi.stubEnv("OPERATOR_PRIVATE_KEY", KEY);
  };

  it("refuses a missing, wrong or scheme-less secret", async () => {
    configure();
    for (const auth of [undefined, "Bearer nope", "cron-secret-cron-secret", "Basic cron-secret-cron-secret"]) {
      const res = await call(auth);
      expect(res.status, String(auth)).toBe(401);
    }
    expect(operator.send).not.toHaveBeenCalled();
  });

  it("answers 503 near_not_configured before claiming anything", async () => {
    const res = await call("Bearer cron-secret-cron-secret");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "near_not_configured" });
    expect((await rows(db))[0]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("sends with the operator and reports what the contract said", async () => {
    configure();
    operator.send.mockImplementation(async (rewards) => rewards.map((r) => ({ key: r.key, status: "applied" as const, txHash: "tx-op" })));
    const res = await call("Bearer cron-secret-cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed: 1, applied: 1, txHashes: ["tx-op"] });
    expect(operator.send.mock.calls[0]![0]).toMatchObject([{ accountId: peter.nearAccountId, nonce: 1 }]);
    expect((await db.select().from(chainOps).where(eq(chainOps.playerId, peter.id)))[0]).toMatchObject({ status: "sent", txHash: "tx-op" });
  });
});

describe("cron auth", () => {
  const req = (auth?: string) => new Request("http://test/api/cron/sweep", { headers: auth ? { authorization: auth } : {} });
  const env = { NODE_ENV: "production", CRON_SECRET: "s3cret-s3cret-s3cret" };

  it("accepts exactly what Vercel Cron sends", () => {
    expect(() => assertCron(req("Bearer s3cret-s3cret-s3cret"), env)).not.toThrow();
  });

  it("refuses anything else", () => {
    for (const auth of ["s3cret-s3cret-s3cret", "bearer  s3cret-s3cret-s3cret", "Bearer s3cret-s3cret-s3cre", "Bearer s3cret-s3cret-s3cret-and-more", "Token s3cret-s3cret-s3cret"]) {
      expect(() => assertCron(req(auth), env), auth).toThrow(/cron secret/);
    }
  });
});
