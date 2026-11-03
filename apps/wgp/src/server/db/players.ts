/**
 * Players and their authoritative saves. Chain's sign-in flow calls `findOrCreatePlayer`
 * and then `createSession(player.id)` (server/auth/session.ts).
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { newSave } from "@wgp/game-core/engine";
import type { Save } from "@wgp/game-core/types";

import type { Db } from "./client";
import { players, saves, type Player } from "./schema";

export interface NewPlayer {
  nearAccountId: string;
  authKind: Player["authKind"];
  authSub?: string | null;
  handle: string;
  /** A verified email (lowercased), kept so another sign-in provider finds this player. */
  email?: string | null;
}

/**
 * The player for a NEAR account, created on first sign-in. An existing row keeps its
 * handle; `authSub` is filled in if it was missing. The save row is created with it.
 */
export async function findOrCreatePlayer(db: Db, input: NewPlayer): Promise<Player> {
  const [created] = await db
    .insert(players)
    .values({ nearAccountId: input.nearAccountId, authKind: input.authKind, authSub: input.authSub ?? null, handle: input.handle, email: input.email ?? null })
    .onConflictDoNothing({ target: players.nearAccountId })
    .returning();
  if (created) {
    await ensureSave(db, created.id);
    return created;
  }
  const [existing] = await db.select().from(players).where(eq(players.nearAccountId, input.nearAccountId)).limit(1);
  if (!existing) throw new Error(`Player for ${input.nearAccountId} vanished`);
  const fill = { ...(!existing.authSub && input.authSub ? { authSub: input.authSub } : {}), ...(!existing.email && input.email ? { email: input.email } : {}) };
  if (Object.keys(fill).length > 0) {
    const [updated] = await db.update(players).set(fill).where(eq(players.id, existing.id)).returning();
    return updated ?? existing;
  }
  return existing;
}

/** A plausible email, trimmed and lowercased, as players store it; null for anything else. Pure. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * The player who signed up first with this verified email, whatever service they used.
 * This is how a player keeps their hero when Google sign-in moves between Privy and
 * NEAR Auth. Pass only emails the identity provider verified.
 */
export async function playerByEmail(db: Db, email: string): Promise<Player | null> {
  const [row] = await db.select().from(players).where(eq(players.email, email)).orderBy(asc(players.createdAt), asc(players.id)).limit(1);
  return row ?? null;
}

/**
 * The player a Google login belongs to: the one with this provider subject, else the
 * first one with this verified email (`linked`: they signed up through the other Google
 * service). Null for a new player.
 */
export async function findPlayerForLogin(db: Db, login: { authSub: string; email: string | null }): Promise<{ player: Player; linked: boolean } | null> {
  const [known] = await db.select().from(players).where(eq(players.authSub, login.authSub)).limit(1);
  if (known) return { player: known, linked: false };
  const byEmail = login.email ? await playerByEmail(db, login.email) : null;
  return byEmail ? { player: byEmail, linked: true } : null;
}

/** Records a verified email on a player who has none yet. Returns the player as stored. */
export async function rememberEmail(db: Db, player: Player, email: string | null | undefined): Promise<Player> {
  if (!email || player.email) return player;
  const [updated] = await db
    .update(players)
    .set({ email })
    .where(and(eq(players.id, player.id), isNull(players.email)))
    .returning();
  return updated ?? player;
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
