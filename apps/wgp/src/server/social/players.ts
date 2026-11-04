/**
 * A player's X handle and whether they want to be tagged. Both are the player's own say:
 * the handle is self-reported and nothing proves the X account is theirs, so the admin
 * queue shows it as unverified and the owner approves every post anyway.
 *
 * Verification can come later (Privy can link a Twitter account): `xHandleVerified` is the
 * one place that would read it.
 */
import { eq, inArray } from "drizzle-orm";

import { normalizeXHandle } from "@/lib/social/x";
import { badRequest } from "@/server/http";

import type { Db } from "../db/client";
import { players, type Player } from "../db/schema";

export interface XProfile {
  /** Without the @, as the player typed it. */
  xHandle: string | null;
  xTagOk: boolean;
  /** Always false for now: there's no proof the account is theirs. */
  verified: boolean;
}

/** Whether the handle is proven to be the player's. Nothing proves it yet. */
export function xHandleVerified(player: Pick<Player, "xHandle">): boolean {
  void player;
  return false;
}

export const xProfile = (p: Pick<Player, "xHandle" | "xTagOk">): XProfile => ({ xHandle: p.xHandle, xTagOk: !!p.xHandle && p.xTagOk, verified: xHandleVerified(p) });

/**
 * Sets (or with null, removes) the player's X handle and their tagging choice. Tagging
 * needs a handle; removing the handle also turns tagging off.
 */
export async function setXProfile(db: Db, playerId: string, input: { xHandle: string | null; xTagOk: boolean }): Promise<XProfile> {
  let handle: string | null = null;
  if (input.xHandle !== null) {
    const checked = normalizeXHandle(input.xHandle);
    if (!checked.ok) throw badRequest(checked.message, { field: "xHandle" });
    handle = checked.handle;
  }
  if (input.xTagOk && !handle) throw badRequest("Add your X handle before turning on tags.", { field: "xTagOk" });
  const [row] = await db
    .update(players)
    .set({ xHandle: handle, xTagOk: !!handle && input.xTagOk })
    .where(eq(players.id, playerId))
    .returning({ xHandle: players.xHandle, xTagOk: players.xTagOk });
  if (!row) throw badRequest("No such player");
  return xProfile(row);
}

export async function getXProfile(db: Db, playerId: string): Promise<XProfile> {
  const [row] = await db.select({ xHandle: players.xHandle, xTagOk: players.xTagOk }).from(players).where(eq(players.id, playerId)).limit(1);
  return xProfile(row ?? { xHandle: null, xTagOk: false });
}

/** How drafts may name a player: their in-game handle, and their X handle only if they opted in. */
export interface Nameable {
  playerId: string;
  handle: string;
  xHandle: string | null;
  xTagOk: boolean;
}

export async function nameables(db: Db, ids: string[]): Promise<Map<string, Nameable>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ playerId: players.id, handle: players.handle, xHandle: players.xHandle, xTagOk: players.xTagOk })
    .from(players)
    .where(inArray(players.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.playerId, r]));
}
