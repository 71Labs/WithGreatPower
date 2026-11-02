import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NONCE_TTL_MS, consumeNonce, issueNonce, nonceIsLive, pruneNonces } from "@/server/auth/nonces";
import { setDb, type Db } from "@/server/db/client";
import { authNonces } from "@/server/db/schema";
import { freshDb } from "@/server/db/test-helpers";
import { HttpError } from "@/server/http";

import { nearAuthNonceCookieName, readCookie, redeemNearAuthNonce } from "./login-nonce";

const T0 = new Date("2026-11-07T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

async function code(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(401);
  return (error as HttpError).code;
}

describe("sign-in nonces", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => setDb(undefined));

  it("stores only a hash, and lives for ten minutes", async () => {
    const { nonce, expiresAt } = await issueNonce(db, "near-auth", T0);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime()).toBe(T0.getTime() + NONCE_TTL_MS);
    const [row] = await db.select().from(authNonces);
    expect(row!.idHash).not.toContain(nonce);
    expect(row!.idHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await nonceIsLive(db, "near-auth", nonce, later(NONCE_TTL_MS - 1))).toBe(true);
    expect(await nonceIsLive(db, "near-auth", nonce, later(NONCE_TTL_MS))).toBe(false);
  });

  it("can be redeemed once, even by two requests racing", async () => {
    const { nonce } = await issueNonce(db, "near-auth", T0);
    const results = await Promise.all([consumeNonce(db, "near-auth", nonce, T0), consumeNonce(db, "near-auth", nonce, T0)]);
    expect(results.sort()).toEqual([false, true]);
    expect(await consumeNonce(db, "near-auth", nonce, T0)).toBe(false);
  });

  it("is pruned once expired", async () => {
    await issueNonce(db, "near-auth", T0);
    await issueNonce(db, "near-auth", later(NONCE_TTL_MS));
    expect(await pruneNonces(db, later(NONCE_TTL_MS + 1))).toBe(1);
    expect(await db.select().from(authNonces)).toHaveLength(1);
  });
});

describe("binding a NEAR Auth ID token to a sign-in", () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(() => setDb(undefined));

  it("accepts the nonce this browser was given, once", async () => {
    const { nonce } = await issueNonce(db, "near-auth", T0);
    await expect(redeemNearAuthNonce(db, { tokenNonce: nonce, cookieNonce: nonce, consume: false, now: later(1000) })).resolves.toBeUndefined();
    // Checking doesn't spend it; signing in does.
    await expect(redeemNearAuthNonce(db, { tokenNonce: nonce, cookieNonce: nonce, consume: true, now: later(2000) })).resolves.toBeUndefined();
  });

  it("rejects a replayed token", async () => {
    const { nonce } = await issueNonce(db, "near-auth", T0);
    await redeemNearAuthNonce(db, { tokenNonce: nonce, cookieNonce: nonce, consume: true, now: later(1000) });
    expect(await code(redeemNearAuthNonce(db, { tokenNonce: nonce, cookieNonce: nonce, consume: true, now: later(2000) }))).toBe("nonce_spent");
    expect(await code(redeemNearAuthNonce(db, { tokenNonce: nonce, cookieNonce: nonce, consume: false, now: later(2000) }))).toBe("nonce_spent");
  });

  it("rejects an expired nonce", async () => {
    const { nonce } = await issueNonce(db, "near-auth", T0);
    expect(await code(redeemNearAuthNonce(db, { tokenNonce: nonce, cookieNonce: nonce, consume: true, now: later(NONCE_TTL_MS + 1) }))).toBe("nonce_spent");
  });

  it("rejects a token whose nonce isn't this browser's, or that we never issued, or that has none", async () => {
    const mine = await issueNonce(db, "near-auth", T0);
    const theirs = await issueNonce(db, "near-auth", T0);
    // A token from another tab or device: its nonce is live, but this browser holds another.
    expect(await code(redeemNearAuthNonce(db, { tokenNonce: theirs.nonce, cookieNonce: mine.nonce, consume: true, now: T0 }))).toBe("nonce_mismatch");
    // No cookie at all (e.g. the token was minted elsewhere and posted here).
    expect(await code(redeemNearAuthNonce(db, { tokenNonce: mine.nonce, cookieNonce: null, consume: true, now: T0 }))).toBe("nonce_mismatch");
    // Another app on the shared Auth0 client: a nonce we never issued, even if a cookie says the same.
    const forged = "x".repeat(43);
    expect(await code(redeemNearAuthNonce(db, { tokenNonce: forged, cookieNonce: forged, consume: true, now: T0 }))).toBe("nonce_spent");
    expect(await code(redeemNearAuthNonce(db, { tokenNonce: undefined, cookieNonce: mine.nonce, consume: true, now: T0 }))).toBe("nonce_missing");
    // None of that spent the real ones.
    expect(await nonceIsLive(db, "near-auth", mine.nonce, T0)).toBe(true);
    expect(await nonceIsLive(db, "near-auth", theirs.nonce, T0)).toBe(true);
  });

  it("reads the nonce cookie by name", () => {
    const name = nearAuthNonceCookieName({ NODE_ENV: "development" });
    expect(name).toBe("wgp_near_auth_nonce");
    expect(nearAuthNonceCookieName({ NODE_ENV: "production" })).toBe("__Host-wgp_near_auth_nonce");
    const req = new Request("http://test/", { headers: { cookie: `wgp_session=abc; ${name}=n0nce_-x; other=1` } });
    expect(readCookie(req, name)).toBe("n0nce_-x");
    expect(readCookie(new Request("http://test/"), name)).toBeNull();
  });
});
