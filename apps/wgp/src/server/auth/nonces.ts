/**
 * Single-use, short-lived nonces. The value goes to the browser; the database keeps only
 * its SHA-256, a purpose and an expiry. Redeeming deletes the row in one statement, so
 * a nonce works once even when two requests race, and never after it expires.
 *
 * NEAR Auth uses one per Google sign-in: the browser asks Auth0 to put it in the ID
 * token's `nonce` claim, and the server takes it back when the token arrives
 * (src/server/near/near-auth.ts, `redeemNearAuthNonce`).
 */
import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { authNonces } from "@/server/db/schema";

export type NoncePurpose = "near-auth";

/** Long enough to pick a Google account in a popup, short enough to be useless later. */
export const NONCE_TTL_MS = 10 * 60_000;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** A fresh nonce (32 random bytes, base64url) stored for `ttlMs`. */
export async function issueNonce(db: Db, purpose: NoncePurpose, now = new Date(), ttlMs = NONCE_TTL_MS): Promise<{ nonce: string; expiresAt: Date }> {
  const nonce = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db.insert(authNonces).values({ idHash: hash(nonce), purpose, createdAt: now, expiresAt });
  return { nonce, expiresAt };
}

/** True if `nonce` was issued for `purpose`, is unexpired and unused. Doesn't use it up. */
export async function nonceIsLive(db: Db, purpose: NoncePurpose, nonce: string, now = new Date()): Promise<boolean> {
  if (!nonce || nonce.length > 128) return false;
  const rows = await db
    .select({ id: authNonces.idHash })
    .from(authNonces)
    .where(and(eq(authNonces.idHash, hash(nonce)), eq(authNonces.purpose, purpose), gt(authNonces.expiresAt, now)))
    .limit(1);
  return rows.length > 0;
}

/** Uses a nonce up. True only for the first redemption of a live nonce issued for `purpose`. */
export async function consumeNonce(db: Db, purpose: NoncePurpose, nonce: string, now = new Date()): Promise<boolean> {
  if (!nonce || nonce.length > 128) return false;
  const rows = await db
    .delete(authNonces)
    .where(and(eq(authNonces.idHash, hash(nonce)), eq(authNonces.purpose, purpose), gt(authNonces.expiresAt, now)))
    .returning({ id: authNonces.idHash });
  return rows.length > 0;
}

/** Deletes expired nonces (the sweep cron). Returns how many. */
export async function pruneNonces(db: Db, now = new Date()): Promise<number> {
  const rows = await db.delete(authNonces).where(lt(authNonces.expiresAt, now)).returning({ id: authNonces.idHash });
  return rows.length;
}
