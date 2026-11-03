/**
 * Seasons: fixed date ranges seeded by migration (S1 is Nov 5–14, 2026). Nothing opens
 * the next one on its own: a new season is a new row. The close lives in season-close.ts.
 */
import { and, asc, desc, getTableColumns, gt, inArray, lte } from "drizzle-orm";

import type { Db } from "./client";
import { seasons, type Season } from "./schema";

/** Statuses of a season whose board still moves. */
export const OPEN_STATUSES = ["scheduled", "live"] as const satisfies readonly Season["status"][];

/** The season a moment falls in (starts_at ≤ at < ends_at), if any. */
export async function seasonAt(db: Db, at: Date): Promise<Season | null> {
  const [row] = await db
    .select()
    .from(seasons)
    .where(and(lte(seasons.startsAt, at), gt(seasons.endsAt, at)))
    .orderBy(desc(seasons.startsAt))
    .limit(1);
  return row ?? null;
}

/**
 * The season a run issued at `at` counts toward, if it hasn't closed. For the accept
 * transaction: the row is key-share locked, so a close that is running waits for this
 * accept to commit (and freezes it in), and an accept that comes after the close sees
 * it closed and leaves the frozen standings alone.
 */
export async function openSeasonAt(tx: Db, at: Date): Promise<Season | null> {
  const [row] = await tx
    .select()
    .from(seasons)
    .where(and(lte(seasons.startsAt, at), gt(seasons.endsAt, at), inArray(seasons.status, OPEN_STATUSES)))
    .orderBy(desc(seasons.startsAt))
    .limit(1)
    .for("key share");
  return row ?? null;
}

/** The live season, else the last one that started, else the next one. For the Season tab's default. */
export async function defaultSeason(db: Db, now: Date): Promise<Season | null> {
  const live = await seasonAt(db, now);
  if (live) return live;
  const [past] = await db.select().from(seasons).where(lte(seasons.startsAt, now)).orderBy(desc(seasons.startsAt)).limit(1);
  if (past) return past;
  const [next] = await db.select().from(seasons).orderBy(asc(seasons.startsAt)).limit(1);
  return next ?? null;
}

/** Every season, oldest first, without the frozen standings (read those per season). */
export function listSeasons(db: Db): Promise<Omit<Season, "standings">[]> {
  const { standings, ...columns } = getTableColumns(seasons);
  void standings;
  return db.select(columns).from(seasons).orderBy(asc(seasons.startsAt));
}
