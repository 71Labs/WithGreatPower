/**
 * Keeps the database in step with the game calls our relayer lands. POST /api/relay/meta
 * calls `guardGameCall` before spending gas and `mirrorGameCall` once the chain answered:
 * - register_hero: the hero's outbox row is marked sent (also when the contract says the
 *   account already has a hero: either way it's on chain), see heroes.ts;
 * - craft_suit, equip_suit: the game-core reducer that serves /api/actions applies the
 *   same action to the stored save, so the save mirrors what the chain now holds.
 *
 * Craft and equip are refused while a ranked run is in flight, as /api/actions refuses
 * them: the run replays from the save it started with, so changing it would void the run.
 */
import { z } from "zod";

import { SUITS } from "@wgp/game-core/data";
import { reduce } from "@wgp/game-core/engine";
import type { ItemId, Save, SuitId } from "@wgp/game-core/types";

import type { Db } from "@/server/db/client";
import { ensureSave, writeSave } from "@/server/db/players";
import { activeRun } from "@/server/db/runs";
import type { Player } from "@/server/db/schema";
import { conflict } from "@/server/http";

import { markHeroRegistered } from "./heroes";

const suitId = z.enum(Object.keys(SUITS) as [SuitId, ...SuitId[]]);
const suitArgs = z.object({ suit: suitId });
const heroArgs = z.object({ name: z.string().max(64), suit: suitId });

/** The contract's answer when register_hero finds a hero already there. */
const ALREADY_HAS_HERO = /already has a hero/i;

/** Methods whose success changes the save, so they wait for a ranked run to end. */
const SAVE_METHODS = new Set(["craft_suit", "equip_suit"]);

/** A relayed call's JSON args, or null when they aren't a JSON object. */
export function parseCallArgs(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Refuses (409 run_active) a call that would change the save while a ranked run is in flight. */
export async function guardGameCall(db: Db, playerId: string, method: string, now = new Date()): Promise<void> {
  if (!SAVE_METHODS.has(method)) return;
  const run = await activeRun(db, playerId, now);
  if (run) throw conflict("run_active", "Finish or abandon the run in progress first", { runId: run.runId });
}

/**
 * The save after the chain crafted `suit`: the reducer's craft, or, when the save lacked what
 * the chain had, the suit owned and worn and whatever the save held of the recipe spent (the
 * chain burned all of it, so none of it may stay behind to craft with again). Pure.
 */
export function mirrorCraft(save: Save, suit: SuitId): Save {
  const crafted = reduce(save, { type: "craft-suit", suit });
  if (crafted !== save || !save.hero) return crafted;
  const worn = wearOwned(save, suit);
  const inventory = { ...worn.inventory };
  let spent = false;
  for (const [item, n] of Object.entries(SUITS[suit].recipe) as [ItemId, number][]) {
    const have = inventory[item] ?? 0;
    if (have <= 0) continue;
    spent = true;
    if (have > n) inventory[item] = have - n;
    else delete inventory[item];
  }
  return spent ? { ...worn, inventory } : worn;
}

/** The save after the chain equipped `suit`. Pure. */
export function mirrorEquip(save: Save, suit: SuitId): Save {
  const worn = reduce(save, { type: "equip-suit", suit });
  if (worn !== save || !save.hero) return worn;
  return wearOwned(save, suit);
}

/** The chain says the hero owns and wears `suit`; the save follows (the chain is authoritative for owned tokens). */
function wearOwned(save: Save, suit: SuitId): Save {
  if (!save.hero || (save.hero.suit === suit && save.suits.includes(suit))) return save;
  return { ...save, suits: save.suits.includes(suit) ? save.suits : [...save.suits, suit], hero: { ...save.hero, suit } };
}

export interface Mirrored {
  save: Save;
  rev: number;
}

/** Applies `change` to the stored save, retrying on a concurrent write. */
async function updateSave(db: Db, playerId: string, change: (save: Save) => Save, now: Date): Promise<Mirrored> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { save, rev } = await ensureSave(db, playerId);
    const next = change(save);
    if (next === save) return { save, rev };
    const written = await writeSave(db, playerId, next, rev, now);
    if (written !== null) return { save: next, rev: written };
  }
  throw new Error(`Couldn't mirror a chain call into ${playerId}'s save`);
}

export interface RelayedCall {
  player: Pick<Player, "id" | "nearAccountId">;
  method: string;
  args: Record<string, unknown> | null;
  ok: boolean;
  txHash: string;
  error?: string;
}

/**
 * Brings the database in line with a relayed game call the chain answered. Returns the
 * new save when the call changed it, for the browser to adopt.
 */
export async function mirrorGameCall(db: Db, call: RelayedCall, now = new Date()): Promise<Mirrored | null> {
  if (call.method === "register_hero") {
    if (call.ok || ALREADY_HAS_HERO.test(call.error ?? "")) {
      const args = heroArgs.safeParse(call.args);
      await markHeroRegistered(db, { player: call.player, txHash: call.ok ? call.txHash : null, args: args.success ? args.data : null }, now);
    }
    return null;
  }
  if (!call.ok || !SAVE_METHODS.has(call.method)) return null;
  const parsed = suitArgs.safeParse(call.args);
  if (!parsed.success) return null;
  const { suit } = parsed.data;
  return updateSave(db, call.player.id, (save) => (call.method === "craft_suit" ? mirrorCraft(save, suit) : mirrorEquip(save, suit)), now);
}
