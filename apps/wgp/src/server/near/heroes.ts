/**
 * Heroes on chain. The contract's `register_hero(name, suit)` mints `hero:<account>` and a
 * starter suit, and only the player's own account can call it, so the server never sends
 * it. Instead:
 * - a signed-in player with a hero and a real NEAR account gets one `register_hero`
 *   outbox row (pending: it waits for their session key; it carries no reward nonce, so
 *   the mint worker never touches it);
 * - the browser, once quick play is on, signs the call with the session key and our
 *   relayer submits it (POST /api/relay/meta);
 * - the relayer, having seen the call land, or the contract answer that the account
 *   already has a hero, marks the row sent with the transaction hash. That row is the
 *   database's mirror of "this hero is on chain".
 */
import { eq, sql } from "drizzle-orm";

import { SUITS } from "@wgp/game-core/data";
import type { Save, SuitId } from "@wgp/game-core/types";

import { isUnclaimed } from "@/lib/near/policy";
import type { Db } from "@/server/db/client";
import { enqueueChainOp } from "@/server/db/outbox";
import { chainOps, type Player } from "@/server/db/schema";

export const REGISTER_HERO = "register_hero";
export const heroOpKey = (playerId: string) => `register_hero:${playerId}`;

/** The contract's limit on hero names, in characters. */
export const MAX_HERO_NAME = 24;

export type HeroChainStatus = "none" | "queued" | "registered";

export interface HeroArgs {
  name: string;
  suit: SuitId;
}

export interface HeroOnChain {
  status: HeroChainStatus;
  txHash: string | null;
  /** What the browser passes to register_hero while it's queued. */
  args: HeroArgs | null;
}

type ChainPlayer = Pick<Player, "id" | "nearAccountId" | "authKind">;

/**
 * Test sign-ins aren't NEAR accounts, and an unclaimed Google player's implicit account
 * doesn't exist on NEAR yet (src/lib/near/policy.ts): nothing goes on chain for either.
 */
export const isOnNear = (player: Pick<Player, "authKind" | "nearAccountId">) => player.authKind !== "dev" && !isUnclaimed(player);

/** A name the contract accepts: no control characters, trimmed, at most 24 characters. Pure. */
export function cleanHeroName(raw: string): string {
  return Array.from(raw.replace(/\p{Cc}/gu, "").trim())
    .slice(0, MAX_HERO_NAME)
    .join("")
    .trim();
}

/**
 * register_hero's arguments for a save, or null without a hero. The suit must be a
 * starter: the one being worn if it is one (so chain and save agree), else the first the
 * hero owns, else Classic. Pure.
 */
export function registerHeroArgs(save: Save): HeroArgs | null {
  if (!save.hero) return null;
  const name = cleanHeroName(save.hero.name);
  if (!name) return null;
  const suit = [save.hero.suit, ...save.suits].find((s) => SUITS[s]?.starter) ?? "classic";
  return { name, suit };
}

/** The hero's chain status as the database mirrors it. */
export async function heroOnChain(db: Db, playerId: string): Promise<HeroOnChain> {
  const [row] = await db
    .select({ status: chainOps.status, txHash: chainOps.txHash, payload: chainOps.payload })
    .from(chainOps)
    .where(eq(chainOps.dedupeKey, heroOpKey(playerId)))
    .limit(1);
  if (!row) return { status: "none", txHash: null, args: null };
  if (row.status === "sent") return { status: "registered", txHash: row.txHash, args: null };
  const p = row.payload as Partial<HeroArgs>;
  return { status: "queued", txHash: null, args: p.name && p.suit ? { name: p.name, suit: p.suit } : null };
}

/**
 * Queues register_hero once for a player who has a hero and a real NEAR account. Safe to
 * call on every read: an existing row (queued or registered) is left as it is.
 */
export async function queueHeroRegistration(db: Db, player: ChainPlayer, save: Save, now = new Date()): Promise<HeroOnChain> {
  const args = isOnNear(player) ? registerHeroArgs(save) : null;
  if (args) {
    await enqueueChainOp(db, { kind: REGISTER_HERO, dedupeKey: heroOpKey(player.id), playerId: player.id, payload: { accountId: player.nearAccountId, ...args } }, now);
  }
  return heroOnChain(db, player.id);
}

/** The relayer saw register_hero land, or the chain already shows the hero: mirror it. */
export async function markHeroRegistered(
  db: Db,
  input: { player: Pick<Player, "id" | "nearAccountId">; txHash?: string | null; args?: { name: string; suit: string } | null },
  now = new Date(),
): Promise<void> {
  const txHash = input.txHash ?? null;
  await db
    .insert(chainOps)
    .values({
      kind: REGISTER_HERO,
      dedupeKey: heroOpKey(input.player.id),
      playerId: input.player.id,
      payload: { accountId: input.player.nearAccountId, ...(input.args ?? {}) },
      status: "sent",
      txHash,
      attempts: 1,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: chainOps.dedupeKey,
      set: { status: "sent", txHash: sql`coalesce(${txHash}::text, ${chainOps.txHash})`, error: null, updatedAt: now },
    });
}
