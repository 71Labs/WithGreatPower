/**
 * Free roam on the server: filing an outing for a signed-in player.
 *
 *   POST /api/city/outing { outingId, base, log } → replay → the city record and the XP
 *
 * An outing's log always runs from its start, so it's filed again as it grows (the browser
 * files whenever it finds something). The server keeps the outing's id and base in the
 * record (`save.city.outing`): the first filing of an outing must start from the record as
 * it stands (the base the browser sent must be the record's own), later filings of the same
 * outing replay from that same base. Anything else is refused as stale (409), so a log can
 * never claim progress it didn't play from.
 *
 * The replay is game-core's (roam-run.ts replayRoam), with the roam ruleset's log field; what
 * it found is merged into the save (rules/city.ts applyOuting): stages only move on, finds are
 * kept, and each first finish pays its XP once, ever. Never ranked, never a Bits mint, no
 * chain op: a level-up rides on the player's next night's mint, as every save change does.
 *
 * An outing played under older roam rules (a tab still running roam-1 or roam-2 after roam-3
 * shipped) is refused as stale (409 old_rules) before any replay, with the record as it stands:
 * the record keeps everything filed so far, and the browser starts a fresh outing from it (an
 * old page, which reads any 409 as "reload to pick up from there", does just that).
 */
import { and, eq } from "drizzle-orm";

import { applyOuting, cityBase, cityRecord, roamStartFrom, sameBase, type CityBase, type CityGains, type CityRecord } from "@wgp/game-core/city";
import { decodeInputCodes } from "@wgp/game-core/input";
import { replayRoam, ROAM_RULESET } from "@wgp/game-core/roam";
import { ROAM_OLD_LOG_RULESETS } from "@wgp/game-core/sim3d/roam";
import type { Save } from "@wgp/game-core/types";

import { HttpError, conflict } from "@/server/http";
import { reserveBudget, utcDay } from "@/server/rate-limit";

import type { Db } from "./client";
import { ensureSave } from "./players";
import { saves } from "./schema";

/** Filings a day per player (an outing files on every find, every two minutes, on pause). */
export const CITY_FILINGS_PER_DAY = 600;
export const CITY_BUDGET_SCOPE = "city:file";

export interface FiledOuting {
  outingId: string;
  gains: CityGains;
  city: CityRecord;
  save: Save;
  rev: number;
  ticks: number;
  ruleset: string;
}

/** The base an outing replays from: its own (filed before), or the record's (a first filing that matches it). Null: stale. */
function baseFor(rec: CityRecord, outingId: string, claimed: CityBase): CityBase | null {
  if (rec.outing?.id === outingId) return rec.outing.base;
  return sameBase(claimed, cityBase(rec)) ? cityBase(rec) : null;
}

export async function fileOuting(db: Db, input: { playerId: string; outingId: string; base: CityBase; log: Uint8Array; now?: Date }): Promise<FiledOuting> {
  const now = input.now ?? new Date();
  const { playerId, outingId, log } = input;
  const reserved = await reserveBudget(db, { scope: CITY_BUDGET_SCOPE, key: playerId, period: utcDay(now), limit: CITY_FILINGS_PER_DAY }, now);
  if (!reserved.ok) throw new HttpError(429, "daily_cap", "That’s a lot of city for one day. It’ll keep until midnight UTC.", { limit: CITY_FILINGS_PER_DAY });

  // Replay outside the lock (a long outing takes a moment), then check nothing moved under it.
  const { save: before } = await ensureSave(db, playerId);
  if (!before.hero) throw conflict("no_hero", "Create a hero first");
  // Older roam rules: a stale outing (start a fresh one from the record; nothing filed is lost).
  if (logRuleset(log) !== null && ROAM_OLD_LOG_RULESETS.includes(logRuleset(log)!)) {
    throw conflict("old_rules", "The city’s rules changed since this outing began. Carry on in a fresh outing from where it stands; everything filed is kept.", { city: cityRecord(before), ruleset: ROAM_RULESET });
  }
  const base = baseFor(cityRecord(before), outingId, input.base);
  if (!base) throw conflict("stale_city", "The city moved on since this outing began (another tab?). Start again from where it stands.");
  const result = replayRoam({ start: roamStartFrom(base), log });
  if (!result.ok) throw new HttpError(422, "outing_rejected", `The server’s replay of this outing didn’t hold up: ${result.reason ?? "rejected"}.`);

  return db.transaction(async (tx) => {
    await ensureSave(tx, playerId);
    const [row] = await tx.select({ state: saves.state, rev: saves.rev }).from(saves).where(eq(saves.playerId, playerId)).for("update");
    const save = row!.state as Save;
    const again = baseFor(cityRecord(save), outingId, input.base);
    if (!again || !sameBase(again, base)) throw conflict("stale_city", "The city moved on since this outing began (another tab?). Start again from where it stands.");
    const out = applyOuting(save, result.outing);
    const city: CityRecord = { ...out.record, outing: { id: outingId, base } };
    const next: Save = { ...out.save, city };
    const [written] = await tx
      .update(saves)
      .set({ state: next, rev: row!.rev + 1, updatedAt: now })
      .where(and(eq(saves.playerId, playerId), eq(saves.rev, row!.rev)))
      .returning({ rev: saves.rev });
    if (!written) throw conflict("stale_city", "The save moved on while this outing was being filed. Try again.");
    return { outingId, gains: out.gains, city, save: next, rev: written.rev, ticks: result.ticks, ruleset: ROAM_RULESET };
  });
}

/** The ruleset field a log carries, or null when it doesn't decode (the replay says why). */
function logRuleset(log: Uint8Array): number | null {
  try {
    return decodeInputCodes(log).ruleset;
  } catch {
    return null;
  }
}

/** The signed-in player's city record (an empty one before the first outing). */
export async function getCity(db: Db, playerId: string): Promise<CityRecord> {
  const { save } = await ensureSave(db, playerId);
  return cityRecord(save);
}
