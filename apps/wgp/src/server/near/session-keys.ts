/**
 * Session keys in the database (Backend's `session_keys` table; Chain owns the flow).
 * A row means "this function-call key is on this player's account and may be relayed";
 * revoking it stops the relayer even before the key is deleted on chain.
 */
import { and, eq, isNull } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { players, sessionKeys, type Player } from "@/server/db/schema";
import { conflict } from "@/server/http";

import type { KnownSender, KnownSessionKey } from "./relay";

/** The sender and key the relayer needs to judge a delegate. */
export async function relayLookup(
  db: Db,
  accountId: string,
  publicKey: string,
): Promise<{ sender: KnownSender | null; sessionKey: KnownSessionKey | null }> {
  const [player] = await db
    .select({ id: players.id, accountId: players.nearAccountId, bannedAt: players.bannedAt })
    .from(players)
    .where(eq(players.nearAccountId, accountId))
    .limit(1);
  const [key] = await db
    .select({ playerId: sessionKeys.playerId, publicKey: sessionKeys.publicKey, revokedAt: sessionKeys.revokedAt })
    .from(sessionKeys)
    .where(eq(sessionKeys.publicKey, publicKey))
    .limit(1);
  return {
    sender: player ? { playerId: player.id, accountId: player.accountId, banned: player.bannedAt !== null } : null,
    sessionKey: key ? { playerId: key.playerId, publicKey: key.publicKey, revoked: key.revokedAt !== null } : null,
  };
}

/** Records a key as live for a player. A key already held by someone else is a conflict. */
export async function addSessionKey(
  db: Db,
  input: { playerId: string; publicKey: string; addTx?: string | null; deviceLabel?: string | null },
  now = new Date(),
): Promise<void> {
  const inserted = await db
    .insert(sessionKeys)
    .values({
      playerId: input.playerId,
      publicKey: input.publicKey,
      addTx: input.addTx ?? null,
      deviceLabel: input.deviceLabel ? input.deviceLabel.slice(0, 64) : null,
      createdAt: now,
    })
    .onConflictDoNothing({ target: sessionKeys.publicKey })
    .returning({ id: sessionKeys.id });
  if (inserted.length > 0) return;
  const [existing] = await db.select().from(sessionKeys).where(eq(sessionKeys.publicKey, input.publicKey)).limit(1);
  if (!existing || existing.playerId !== input.playerId) throw conflict("key_in_use", "That session key belongs to another player");
  if (existing.revokedAt) throw conflict("key_revoked", "That session key was revoked; make a new one");
}

export async function touchSessionKey(db: Db, publicKey: string, now = new Date()): Promise<void> {
  await db.update(sessionKeys).set({ lastUsedAt: now }).where(eq(sessionKeys.publicKey, publicKey));
}

/** Stops the relayer accepting a key. Returns false if the player had no such live key. */
export async function revokeSessionKey(db: Db, playerId: string, publicKey: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(sessionKeys)
    .set({ revokedAt: now })
    .where(and(eq(sessionKeys.playerId, playerId), eq(sessionKeys.publicKey, publicKey), isNull(sessionKeys.revokedAt)))
    .returning({ id: sessionKeys.id });
  return rows.length > 0;
}

export async function liveSessionKeys(db: Db, playerId: string): Promise<string[]> {
  const rows = await db
    .select({ publicKey: sessionKeys.publicKey })
    .from(sessionKeys)
    .where(and(eq(sessionKeys.playerId, playerId), isNull(sessionKeys.revokedAt)));
  return rows.map((r) => r.publicKey);
}

export async function playerByAuthSub(db: Db, authSub: string): Promise<Player | null> {
  const [row] = await db.select().from(players).where(eq(players.authSub, authSub)).limit(1);
  return row ?? null;
}

export async function playerByAccount(db: Db, accountId: string): Promise<Player | null> {
  const [row] = await db.select().from(players).where(eq(players.nearAccountId, accountId)).limit(1);
  return row ?? null;
}
