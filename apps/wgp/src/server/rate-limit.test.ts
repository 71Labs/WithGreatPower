import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDb, type Db } from "./db/client";
import { freshDb } from "./db/test-helpers";
import { HttpError } from "./http";
import { RateLimiter, budgetUsed, pruneBudgets, releaseBudget, reserveBudget, utcDay } from "./rate-limit";

describe("burst guards", () => {
  const rule = { limit: 3, windowMs: 60_000 };

  it("allows the limit per window, then answers a 429 with the wait", () => {
    const limiter = new RateLimiter();
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(limiter.hit("b", "k", rule, t + i)).toBe(0);
    expect(limiter.hit("b", "k", rule, t + 10)).toBe(60);
    expect(() => limiter.enforce("b", "k", rule, t + 20)).toThrowError(HttpError);
    try {
      limiter.enforce("b", "k", rule, t + 30_000);
    } catch (error) {
      expect(error).toMatchObject({ status: 429, code: "rate_limited", details: { retryAfterSeconds: 30 } });
    }
  });

  it("counts keys and buckets apart, and opens a new window after it ends", () => {
    const limiter = new RateLimiter();
    const t = 5_000_000;
    for (let i = 0; i < 3; i++) limiter.hit("b", "a", rule, t);
    expect(limiter.hit("b", "other", rule, t)).toBe(0);
    expect(limiter.hit("c", "a", rule, t)).toBe(0);
    expect(limiter.hit("b", "a", rule, t + 60_000)).toBe(0);
  });
});

describe("durable budgets", () => {
  let db: Db;
  const req = { scope: "runs:ranked", key: "p1", period: "2026-11-06", limit: 20 };

  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => setDb(undefined));

  it("reserves up to the limit and refuses past it without changing the count", async () => {
    for (let i = 1; i <= 20; i++) expect(await reserveBudget(db, req)).toEqual({ ok: true, count: i });
    expect(await reserveBudget(db, req)).toEqual({ ok: false, count: 20 });
    expect(await budgetUsed(db, req)).toBe(20);
    expect(await reserveBudget(db, { ...req, period: "2026-11-07" })).toEqual({ ok: true, count: 1 });
  });

  it("never overshoots under concurrent reservations", async () => {
    const results = await Promise.all(Array.from({ length: 35 }, () => reserveBudget(db, req)));
    expect(results.filter((r) => r.ok)).toHaveLength(20);
    expect(await budgetUsed(db, req)).toBe(20);
  });

  it("takes amounts, refuses one bigger than the limit, and gives back on release", async () => {
    expect(await reserveBudget(db, { ...req, amount: 15 })).toEqual({ ok: true, count: 15 });
    expect((await reserveBudget(db, { ...req, amount: 6 })).ok).toBe(false);
    expect((await reserveBudget(db, { ...req, key: "p2", amount: 21 })).ok).toBe(false);
    await releaseBudget(db, { ...req, amount: 10 });
    expect(await budgetUsed(db, req)).toBe(5);
    await releaseBudget(db, { ...req, amount: 50 });
    expect(await budgetUsed(db, req)).toBe(0);
  });

  it("prunes counters untouched for a while", async () => {
    await reserveBudget(db, req, new Date("2026-11-01T00:00:00Z"));
    await reserveBudget(db, { ...req, key: "p2" }, new Date("2026-11-08T00:00:00Z"));
    expect(await pruneBudgets(db, new Date("2026-11-05T00:00:00Z"))).toBe(1);
    expect(await budgetUsed(db, { ...req, key: "p2" })).toBe(1);
  });

  it("uses the UTC calendar day", () => {
    expect(utcDay(new Date("2026-11-06T23:59:59-05:00"))).toBe("2026-11-07");
  });
});
