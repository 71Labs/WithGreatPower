import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { XP_TO_NEXT } from "@wgp/game-core/data";
import { newSave, reduce } from "@wgp/game-core/engine";
import type { Save } from "@wgp/game-core/types";

import { HttpError } from "@/server/http";

import { setDb, type Db } from "./client";
import { DAY_ONE_TROPHY, IMPORT_CAPS, importLocalSave, sanitizeLocalSave } from "./migrate-save";
import { ensureSave } from "./players";
import { chainOps } from "./schema";
import { freshDb, givePlayerHero, heroSave, makePlayer } from "./test-helpers";

/** A local save someone has edited by hand. */
function forged(): Record<string, unknown> {
  const base = heroSave("  Miles Morales the Amazing Spectacular  ");
  return {
    ...base,
    night: 40,
    nightDone: false,
    hero: {
      ...base.hero,
      level: 12,
      xp: 99_999,
      maxHp: 999,
      responsibility: 500,
      suit: "octo",
      pendingPicks: 9,
      powers: {
        "web-sling": { mastery: 999 },
        "web-shield": { mastery: 3 },
        "node-sense": { mastery: 0 },
        finality: { mastery: 40 },
        "web-bomb": { mastery: 2 },
        "validator-slam": { mastery: 2 },
        "laser-eyes": { mastery: 50 },
      },
      loadout: ["web-bomb", "validator-slam", "laser-eyes", "web-sling", "finality"],
    },
    patrol: { night: 40, phase: "stop", stops: [] },
    inventory: { "fee-bomb": 50, "goblin-glider": 9, "spare-arm": 9, "sybil-goo": 9, "press-pass": 9, "gold-bar": 100 },
    suits: ["classic", "midnight", "octo", "sesame", "golden"],
    album: { "gas-goblin": 4, sybil: 400, nobody: 3 },
    editions: [{ night: 39, quest: { villain: "sybil", night: 40, rewardXp: 9999, rewardItem: "spare-arm", done: false } }],
    reputation: -900,
    stats: { villainsCaught: 1e9, errands: -4, knockouts: "lots", perfectSwings: 3, nights: 2 },
  };
}

describe("sanitizeLocalSave", () => {
  it("caps the level, matches powers to it and drops what can't be trusted", () => {
    const save = sanitizeLocalSave(forged())!;
    const hero = save.hero!;

    expect(hero.name).toBe("Miles Morales the Amazin");
    expect(hero.level).toBe(IMPORT_CAPS.level);
    expect(hero.xp).toBe(XP_TO_NEXT(3) - 1);
    expect(hero.maxHp).toBe(100 + 2 * 6);
    expect(hero.responsibility).toBe(100);
    // Three starters plus one pick per level-up; the unknown power is gone.
    expect(Object.keys(hero.powers)).toEqual(["web-sling", "web-shield", "node-sense", "finality", "web-bomb"]);
    expect(hero.powers["web-sling"]?.mastery).toBe(17);
    expect(hero.pendingPicks).toBe(0);
    expect(hero.loadout).toEqual(["web-bomb", "web-sling", "finality"]);
    // Octo needs level 3 (allowed at 3); golden isn't a suit.
    expect(save.suits).toEqual(["classic", "midnight", "octo", "sesame"]);
    expect(hero.suit).toBe("octo");

    expect(save.night).toBe(IMPORT_CAPS.night);
    expect(save.patrol).toBeNull();
    expect(save.nightDone).toBe(false);
    expect(save.editions).toEqual([]);
    expect(save.reputation).toBe(-100);
    expect(save.album).toEqual({ "gas-goblin": 4, sybil: IMPORT_CAPS.albumEach });
    expect(save.stats).toEqual({ villainsCaught: 1000, errands: 0, knockouts: 0, perfectSwings: 3, nights: 2 });

    const items = Object.values(save.inventory) as number[];
    expect(Math.max(...items)).toBeLessThanOrEqual(IMPORT_CAPS.perItem);
    expect(items.reduce((a, b) => a + b, 0)).toBe(IMPORT_CAPS.totalItems);
    expect(save.inventory).not.toHaveProperty("gold-bar");
  });

  it("keeps an honest level-1 save as it was, minus the patrol", () => {
    const honest = reduce(heroSave("Gwen"), { type: "start-patrol" });
    const save = sanitizeLocalSave(honest)!;
    expect(save.hero).toEqual(honest.hero);
    expect(save.patrol).toBeNull();
    expect(save.suits).toEqual(["classic"]);
  });

  it("gives a level-2 hero with spare picks the picks back", () => {
    const base = heroSave("Gwen");
    const save = sanitizeLocalSave({ ...base, hero: { ...base.hero!, level: 2, pendingPicks: 0 } })!;
    expect(save.hero?.pendingPicks).toBe(1);
  });

  it("answers null for anything without a hero", () => {
    expect(sanitizeLocalSave(null)).toBeNull();
    expect(sanitizeLocalSave("save")).toBeNull();
    expect(sanitizeLocalSave(newSave())).toBeNull();
    expect(sanitizeLocalSave({ ...heroSave(), version: 2 })).toBeNull();
    expect(sanitizeLocalSave({ ...heroSave(), hero: { name: "   " } })).toBeNull();
  });
});

describe("importLocalSave", () => {
  let db: Db;
  let playerId: string;

  beforeEach(async () => {
    db = await freshDb();
    playerId = (await makePlayer(db, "miles")).id;
  });
  afterEach(() => setDb(undefined));

  it("imports once, queuing a capped mint and the Day one trophy", async () => {
    const out = await importLocalSave(db, { playerId, local: forged() });
    expect(out.trophy).toBe(DAY_ONE_TROPHY);
    expect(out.rev).toBe(1);
    expect((await ensureSave(db, playerId)).save.hero?.level).toBe(3);

    const [op] = await db.select().from(chainOps);
    expect(op).toMatchObject({ kind: "mint_import", dedupeKey: `mint_import:${playerId}` });
    expect((op.payload as { items: { amount: number }[] }).items.reduce((a, i) => a + i.amount, 0)).toBe(IMPORT_CAPS.totalItems);

    const again = await importLocalSave(db, { playerId, local: forged() }).catch((e: unknown) => e);
    expect(again).toMatchObject({ status: 409, code: "already_migrated" });
  });

  it("won't overwrite a hero the server already has, and refuses an empty save", async () => {
    await givePlayerHero(db, playerId, "Server Hero");
    expect(await importLocalSave(db, { playerId, local: forged() }).catch((e: unknown) => e)).toMatchObject({ code: "server_save_exists" });

    const other = await makePlayer(db, "nobody");
    const empty = await importLocalSave(db, { playerId: other.id, local: newSave() as Save }).catch((e: unknown) => e);
    expect(empty).toBeInstanceOf(HttpError);
    expect(empty).toMatchObject({ status: 422, code: "nothing_to_import" });
  });
});
