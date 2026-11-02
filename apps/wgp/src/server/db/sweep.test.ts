import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { issueSession, readSession } from "@/server/auth/session";
import { assertCron } from "@/server/http";
import { setVerifier } from "@/server/verify";

import { setDb, type Db } from "./client";
import { enqueueChainOp } from "./outbox";
import { RUN_TTL_MS, SUBMIT_GRACE_MS, startRun } from "./runs";
import { chainOps, runs } from "./schema";
import { OUTBOX_MAX_ATTEMPTS, OUTBOX_STUCK_MS, sweep } from "./sweep";
import { fakeVerifier, freshDb, givePlayerHero, makePlayer } from "./test-helpers";

const T0 = new Date("2026-11-06T20:00:00Z");

describe("sweep", () => {
  let db: Db;
  let playerId: string;

  beforeEach(async () => {
    db = await freshDb();
    playerId = (await makePlayer(db, "sweeper")).id;
    await givePlayerHero(db, playerId);
    setVerifier(fakeVerifier());
  });
  afterEach(() => {
    setVerifier(undefined);
    setDb(undefined);
  });

  it("expires runs past their deadline and grace", async () => {
    const run = await startRun(db, { playerId, now: T0 });
    expect((await sweep(db, new Date(T0.getTime() + RUN_TTL_MS))).expiredRuns).toBe(0);
    const report = await sweep(db, new Date(T0.getTime() + RUN_TTL_MS + SUBMIT_GRACE_MS + 1));
    expect(report.expiredRuns).toBe(1);
    const [row] = await db.select().from(runs).where(eq(runs.id, run.runId));
    expect(row).toMatchObject({ status: "expired", rejectReason: "timeout" });
  });

  it("re-queues failed and stuck outbox rows, and gives up after the last attempt", async () => {
    const op = (key: string) => enqueueChainOp(db, { kind: "mint_reward", dedupeKey: key, playerId, payload: {} }, T0);
    await op("a");
    await op("b");
    await op("c");
    expect(await op("a")).toBe(false); // deduped
    await db.update(chainOps).set({ status: "failed", attempts: 2 }).where(eq(chainOps.dedupeKey, "a"));
    await db.update(chainOps).set({ status: "failed", attempts: OUTBOX_MAX_ATTEMPTS }).where(eq(chainOps.dedupeKey, "b"));
    await db.update(chainOps).set({ status: "sending", updatedAt: T0 }).where(eq(chainOps.dedupeKey, "c"));

    const report = await sweep(db, new Date(T0.getTime() + OUTBOX_STUCK_MS + 1));
    expect(report).toMatchObject({ requeuedOps: 1, deadOps: 1, unstuckOps: 1 });
    const status = Object.fromEntries((await db.select().from(chainOps)).map((r) => [r.dedupeKey, r.status]));
    expect(status).toEqual({ a: "pending", b: "dead", c: "pending" });
  });

  it("prunes expired sessions", async () => {
    const { token } = await issueSession(db, playerId, {}, new Date("2026-09-01T00:00:00Z"));
    expect((await sweep(db, T0)).prunedSessions).toBe(1);
    expect(await readSession(db, token, new Date("2026-09-02T00:00:00Z"))).toBeNull();
  });
});

describe("cron auth", () => {
  const req = (auth?: string) => new Request("http://test/api/cron/sweep", { headers: auth ? { authorization: auth } : {} });

  it("needs the bearer secret when one is set", () => {
    const env = { NODE_ENV: "production", CRON_SECRET: "s3cret-s3cret-s3cret" };
    expect(() => assertCron(req("Bearer s3cret-s3cret-s3cret"), env)).not.toThrow();
    expect(() => assertCron(req("Bearer nope"), env)).toThrow();
    expect(() => assertCron(req(), env)).toThrow();
  });

  it("closes in production without a secret, and opens in dev", () => {
    expect(() => assertCron(req(), { NODE_ENV: "production" })).toThrow();
    expect(() => assertCron(req(), { NODE_ENV: "development" })).not.toThrow();
  });
});
