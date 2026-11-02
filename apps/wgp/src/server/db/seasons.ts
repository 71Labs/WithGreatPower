/** Seasons: fixed date ranges (S1 is Nov 5–14, 2026, seeded by migration). */
import { and, asc, desc, gt, lte } from "drizzle-orm";

import type { Db } from "./client";
import { seasons, type Season } from "./schema";

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

/** The live season, else the last one that started, else the next one. For the Season tab's default. */
export async function defaultSeason(db: Db, now: Date): Promise<Season | null> {
  const live = await seasonAt(db, now);
  if (live) return live;
  const [past] = await db.select().from(seasons).where(lte(seasons.startsAt, now)).orderBy(desc(seasons.startsAt)).limit(1);
  if (past) return past;
  const [next] = await db.select().from(seasons).orderBy(asc(seasons.startsAt)).limit(1);
  return next ?? null;
}

export function listSeasons(db: Db): Promise<Season[]> {
  return db.select().from(seasons).orderBy(asc(seasons.startsAt));
}
