/**
 * The one-time import of a guest's local save on first sign-in. A local save is
 * whatever the browser says it is, so it is rebuilt field by field from known ids and
 * capped: level 3 at most, powers to match the level, no patrol in progress, a small
 * capped inventory (minted once on chain with a "Day one" trophy), no quests.
 */
import { and, eq, isNull } from "drizzle-orm";

import { CAST, type CastId } from "@wgp/game-core/cast";
import { HERO_BASE_HP, HP_PER_LEVEL, MAX_LOADOUT, POWERS, STARTER_POWERS, STARTER_UNLOCK_LEVEL, SUITS, XP_TO_NEXT } from "@wgp/game-core/data";
import { newSave } from "@wgp/game-core/engine";
import type { Hero, ItemId, PowerId, Save, SuitId } from "@wgp/game-core/types";

import { IMPORT_CAPS } from "@/game/import-caps";
import { LAUNCH_ITEM_IDS, LAUNCH_SUIT_IDS } from "@/lib/market/new-stock";
import { HttpError, conflict, notFound } from "@/server/http";

import type { Db } from "./client";
import { enqueueRewardMint, itemTokenId, sha256Hex, type MintItem } from "./outbox";
import { ensureSave, getPlayer, writeSave } from "./players";
import { players } from "./schema";

export { IMPORT_CAPS };

export const DAY_ONE_TROPHY = "trophy:day-one";

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : fallback;

const POWER_IDS = new Set(Object.keys(POWERS));
// Launch items and suits only: Gwei's new stock is earned signed in (src/lib/market/new-stock.ts), never by a guest.
const SUIT_IDS = new Set<string>(LAUNCH_SUIT_IDS);
const ITEM_IDS: readonly ItemId[] = LAUNCH_ITEM_IDS;
const CAST_IDS = new Set<string>(CAST.map((c) => c.id));

/** Rebuilds a local save from scratch with only known ids and capped numbers. Null if it holds no hero. */
export function sanitizeLocalSave(input: unknown): Save | null {
  if (!isObj(input) || input.version !== 1 || !isObj(input.hero)) return null;
  const h = input.hero;
  const name = typeof h.name === "string" ? h.name.trim().slice(0, 24).trim() : "";
  if (!name) return null;

  const level = int(h.level, 1, IMPORT_CAPS.level, 1);
  const night = int(input.night, 1, IMPORT_CAPS.night, 1);

  // Powers to match the level: the three starters picked at sign-up, plus one pick per level-up.
  const localPowers = isObj(h.powers) ? h.powers : {};
  const owned = Object.keys(localPowers).filter((p): p is PowerId => POWER_IDS.has(p));
  const starters = owned.filter((p) => POWERS[p].starter).slice(0, 3);
  for (const p of STARTER_POWERS) if (starters.length < 3 && !starters.includes(p)) starters.push(p);
  const picks = owned.filter((p) => !starters.includes(p)).slice(0, level - 1);
  const kept = [...starters, ...picks];
  const masteryCap = 6 * level - 1;
  const powers: Hero["powers"] = {};
  for (const p of kept) {
    const state = localPowers[p];
    powers[p] = { mastery: int(isObj(state) ? state.mastery : 0, 0, masteryCap, 0) };
  }
  const allowed = Math.min(3 + (level - 1), POWER_IDS.size);
  const loadout = [...new Set(Array.isArray(h.loadout) ? h.loadout : [])].filter((p): p is PowerId => typeof p === "string" && kept.includes(p as PowerId)).slice(0, MAX_LOADOUT);

  // Suits: known ids the hero's level allows. The spare starter suits unlock at level 2.
  const wanted = typeof h.suit === "string" && SUIT_IDS.has(h.suit) ? (h.suit as SuitId) : "classic";
  const suits = [...new Set(Array.isArray(input.suits) ? input.suits : [])].filter((s): s is SuitId => {
    if (typeof s !== "string" || !SUIT_IDS.has(s)) return false;
    const suit = SUITS[s as SuitId];
    return suit.starter ? s === wanted || level >= STARTER_UNLOCK_LEVEL : level >= suit.minLevel;
  });
  const suit: SuitId = suits.includes(wanted) ? wanted : (suits[0] ?? (SUITS[wanted].starter ? wanted : "classic"));
  if (!suits.includes(suit)) suits.unshift(suit);

  const hero: Hero = {
    name,
    level,
    xp: int(h.xp, 0, XP_TO_NEXT(level) - 1, 0),
    maxHp: HERO_BASE_HP + (level - 1) * HP_PER_LEVEL,
    responsibility: int(h.responsibility, 0, 100, 20),
    powers,
    loadout: loadout.length > 0 ? loadout : kept.slice(0, MAX_LOADOUT),
    suit,
    pendingPicks: Math.max(0, allowed - kept.length),
    createdNight: int(h.createdNight, 1, night, 1),
  };

  // A small, capped inventory: per item, then in total.
  const localInv = isObj(input.inventory) ? input.inventory : {};
  const inventory: Save["inventory"] = {};
  let total = 0;
  for (const item of ITEM_IDS) {
    const n = Math.min(int(localInv[item], 0, IMPORT_CAPS.perItem, 0), IMPORT_CAPS.totalItems - total);
    if (n > 0) {
      inventory[item] = n;
      total += n;
    }
  }

  const localAlbum = isObj(input.album) ? input.album : {};
  const album: Save["album"] = {};
  for (const [id, n] of Object.entries(localAlbum)) {
    const count = int(n, 0, IMPORT_CAPS.albumEach, 0);
    if (CAST_IDS.has(id) && count > 0) album[id as CastId] = count;
  }

  const s = isObj(input.stats) ? input.stats : {};
  const stat = (k: string) => int(s[k], 0, IMPORT_CAPS.stat, 0);

  return {
    ...newSave(),
    hero,
    night,
    // A patrol in progress is dropped; tonight starts fresh unless it was already done.
    patrol: null,
    nightDone: input.nightDone === true && !isObj(input.patrol),
    inventory,
    suits,
    album,
    // Editions carry quests, which pay out; a local copy can't be trusted.
    editions: [],
    reputation: int(input.reputation, -100, 100, 0),
    stats: {
      villainsCaught: stat("villainsCaught"),
      errands: stat("errands"),
      knockouts: stat("knockouts"),
      perfectSwings: stat("perfectSwings"),
      nights: stat("nights"),
    },
  };
}

export interface ImportResult {
  save: Save;
  rev: number;
  /** What will be minted once on chain. */
  items: MintItem[];
  trophy: string;
}

class AlreadyMigrated extends Error {}

/** Imports a sanitized local save once per player, onto an empty server save. */
export async function importLocalSave(db: Db, input: { playerId: string; local: unknown; now?: Date }): Promise<ImportResult> {
  const now = input.now ?? new Date();
  const player = await getPlayer(db, input.playerId);
  if (!player) throw notFound("No such player");
  if (player.migratedLocalAt) throw conflict("already_migrated", "This account already imported a local save");

  const save = sanitizeLocalSave(input.local);
  if (!save) throw new HttpError(422, "nothing_to_import", "The local save has no hero to import");

  const current = await ensureSave(db, player.id);
  if (current.save.hero) throw conflict("server_save_exists", "This account already has a hero; keeping it", { save: current.save, rev: current.rev });

  const items = (Object.entries(save.inventory) as [ItemId, number][]).map(([item, amount]) => ({ tokenId: itemTokenId(item), amount }));
  try {
    const rev = await db.transaction(async (tx) => {
      const marked = await tx
        .update(players)
        .set({ migratedLocalAt: now })
        .where(and(eq(players.id, player.id), isNull(players.migratedLocalAt)))
        .returning({ id: players.id });
      if (marked.length === 0) throw new AlreadyMigrated();
      const next = await writeSave(tx, player.id, save, current.rev, now);
      if (next === null) throw conflict("rev_conflict", "Your save changed elsewhere");
      await enqueueRewardMint(
        tx,
        {
          kind: "mint_import",
          dedupeKey: `mint_import:${player.id}`,
          playerId: player.id,
          payload: {
            playerId: player.id,
            accountId: player.nearAccountId,
            items,
            trophy: DAY_ONE_TROPHY,
            level: save.hero!.level,
            // What the mint logs on chain: binds the import to the player and what was kept.
            digest: sha256Hex(["wgp-import-v1", player.id, JSON.stringify(save)].join("|")),
          },
        },
        now,
      );
      return next;
    });
    return { save, rev, items, trophy: DAY_ONE_TROPHY };
  } catch (error) {
    if (error instanceof AlreadyMigrated) throw conflict("already_migrated", "This account already imported a local save");
    throw error;
  }
}
