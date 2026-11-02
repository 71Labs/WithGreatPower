/**
 * Players and their authoritative saves. Chain's sign-in flow calls `findOrCreatePlayer`
 * and then `createSession(player.id)` (server/auth/session.ts).
 */
import { and, eq, sql } from "drizzle-orm";

import { newSave } from "@wgp/game-core/engine";
import type { Save } from "@wgp/game-core/types";

import type { Db } from "./client";
import { players, saves, type Player } from "./schema";

export interface NewPlayer {
  nearAccountId: string;
  authKind: Player["authKind"];
  authSub?: string | null;
  handle: string;
}

/**
 * The player for a NEAR account, created on first sign-in. An existing row keeps its
 * handle; `authSub` is filled in if it was missing. The save row is created with it.
 */
export async function findOrCreatePlayer(db: Db, input: NewPlayer): Promise<Player> {
  const [created] = await db
    .insert(players)
    .values({ nearAccountId: input.nearAccountId, authKind: input.authKind, authSub: input.authSub ?? null, handle: input.handle })
    .onConflictDoNothing({ target: players.nearAccountId })
    .returning();
  if (created) {
    await ensureSave(db, created.id);
    return created;
  }
  const [existing] = await db.select().from(players).where(eq(players.nearAccountId, input.nearAccountId)).limit(1);
  if (!existing) throw new Error(`Player for ${input.nearAccountId} vanished`);
  if (!existing.authSub && input.authSub) {
    const [updated] = await db.update(players).set({ authSub: input.authSub }).where(eq(players.id, existing.id)).returning();
    return updated ?? existing;
  }
  return existing;
}

export async function getPlayer(db: Db, id: string): Promise<Player | null> {
  const [row] = await db.select().from(players).where(eq(players.id, id)).limit(1);
  return row ?? null;
}

export interface StoredSave {
  save: Save;
  rev: number;
}

/** The player's save, creating a fresh one (rev 0) if there isn't one yet. */
export async function ensureSave(db: Db, playerId: string): Promise<StoredSave> {
  await db.insert(saves).values({ playerId, state: newSave(), rev: 0 }).onConflictDoNothing({ target: saves.playerId });
  const [row] = await db.select({ state: saves.state, rev: saves.rev }).from(saves).where(eq(saves.playerId, playerId)).limit(1);
  if (!row) throw new Error(`No save for player ${playerId}`);
  return { save: row.state as Save, rev: row.rev };
}

/** Writes `save` only if the stored revision is still `expectedRev`. Returns the new revision, or null on a conflict. */
export async function writeSave(db: Db, playerId: string, save: Save, expectedRev: number, now = new Date()): Promise<number | null> {
  const [row] = await db
    .update(saves)
    .set({ state: save, rev: sql`${saves.rev} + 1`, updatedAt: now })
    .where(and(eq(saves.playerId, playerId), eq(saves.rev, expectedRev)))
    .returning({ rev: saves.rev });
  return row?.rev ?? null;
}
