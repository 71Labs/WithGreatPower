/**
 * Opening and closing seasons, without a cron job. `runSeasonPass` runs in the background
 * of player requests (src/server/background.ts, `closeSeasonsSoon`):
 *
 * - a scheduled season whose start has passed is marked live;
 * - a season whose end passed more than CLOSE_GRACE_MS ago is closed, exactly once. One
 *   transaction locks its row, freezes the Season board as it stands (ties to the faster
 *   night, as the boards rank them), commits it the way scripts/near/record-season.ts
 *   does (`commitSeason`), writes standings, root, digest and top 10 to the row, and
 *   queues `record_season` in the outbox. A second closer waits on the lock, then finds
 *   the season closed and does nothing.
 *
 * The contract's `record_season` mints `trophy:<season>:<rank>` to each of the top 10
 * itself, so that one outbox row carries the record and the trophies. It waits, pending,
 * until the operator can send it and the contract answers (src/server/near/season-record.ts).
 *
 * A season nobody finished a ranked night in closes with empty standings and queues
 * nothing: the contract can't record an empty top 10.
 */
import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { commitSeason, type SeasonLeaf } from "@/server/near/season";

import type { Db } from "./client";
import { allEntries, type BoardRow } from "./leaderboard";
import { enqueueChainOp } from "./outbox";
import { RUN_TTL_MS, SUBMIT_GRACE_MS } from "./runs";
import { seasons, type Season } from "./schema";
import { OPEN_STATUSES } from "./seasons";

/**
 * How long after its end a season waits to close: long enough for a run issued in the
 * last second to be submitted (its TTL plus the submit grace) and verified.
 */
export const CLOSE_GRACE_MS = RUN_TTL_MS + SUBMIT_GRACE_MS + 3 * 60_000;

/** When a season's standings freeze. */
export const freezesAt = (s: Pick<Season, "endsAt">): Date => new Date(s.endsAt.getTime() + CLOSE_GRACE_MS);

/** A row of the frozen standings: the Season board's row at the close. */
export type SeasonStanding = BoardRow;

/** How many places `record_season` gives a trophy (contracts/wgp MAX_TOP). */
export const TROPHY_PLACES = 10;

export const RECORD_SEASON_KIND = "record_season";
export const recordSeasonKey = (seasonId: string) => `${RECORD_SEASON_KIND}:${seasonId}`;

/** The outbox payload: what `record_season` will be called with, as of the close. */
export interface RecordSeasonPayload {
  seasonId: string;
  root: string;
  digest: string;
  top10: string[];
}

/** The leaves the script commits for a ranked board: rank, account and score per standing. */
export function seasonLeaves(standings: SeasonStanding[]): SeasonLeaf[] {
  return standings.map((r) => ({ rank: r.rank, accountId: r.nearAccountId, score: r.score }));
}

export interface ClosedSeason {
  seasonId: string;
  players: number;
  root: string | null;
  digest: string | null;
  top10: string[];
  /** True when this close queued `record_season` (false for an empty season). */
  queued: boolean;
}

/**
 * Closes a season if it is open and past its freeze time; null if it isn't (already
 * closed, not due, or no such season). Safe to call any number of times, concurrently.
 */
export async function closeSeason(db: Db, seasonId: string, now = new Date()): Promise<ClosedSeason | null> {
  const dueBefore = new Date(now.getTime() - CLOSE_GRACE_MS);
  return db.transaction(async (tx) => {
    const [season] = await tx
      .select({ id: seasons.id })
      .from(seasons)
      .where(and(eq(seasons.id, seasonId), inArray(seasons.status, OPEN_STATUSES), lte(seasons.endsAt, dueBefore)))
      .for("update");
    if (!season) return null;

    const standings = await allEntries(tx, "season", seasonId);
    const commitment = standings.length > 0 ? commitSeason(seasonId, seasonLeaves(standings)) : null;
    await tx
      .update(seasons)
      .set({
        status: "closed",
        closedAt: now,
        standings,
        root: commitment?.root ?? null,
        digest: commitment?.digest ?? null,
        top10: commitment?.top10 ?? [],
      })
      .where(eq(seasons.id, seasonId));

    let queued = false;
    if (commitment) {
      const payload: RecordSeasonPayload = { seasonId, root: commitment.root, digest: commitment.digest, top10: commitment.top10 };
      queued = await enqueueChainOp(tx, { kind: RECORD_SEASON_KIND, dedupeKey: recordSeasonKey(seasonId), playerId: null, payload: { ...payload } }, now);
    }
    return { seasonId, players: standings.length, root: commitment?.root ?? null, digest: commitment?.digest ?? null, top10: commitment?.top10 ?? [], queued };
  });
}

export interface SeasonPass {
  /** Seasons marked live by this pass. */
  opened: string[];
  closed: ClosedSeason[];
  /** The next moment this pass has anything to do (a start or a freeze), or null if none. */
  nextDueAt: Date | null;
}

/** Marks started seasons live and closes every season past its freeze time. Idempotent. */
export async function runSeasonPass(db: Db, now = new Date()): Promise<SeasonPass> {
  const opened = await db
    .update(seasons)
    .set({ status: "live" })
    .where(and(eq(seasons.status, "scheduled"), lte(seasons.startsAt, now)))
    .returning({ id: seasons.id });

  const open = await db
    .select({ id: seasons.id, status: seasons.status, startsAt: seasons.startsAt, endsAt: seasons.endsAt })
    .from(seasons)
    .where(inArray(seasons.status, OPEN_STATUSES))
    .orderBy(asc(seasons.endsAt));

  const closed: ClosedSeason[] = [];
  let next: number | null = null;
  for (const s of open) {
    const freeze = freezesAt(s).getTime();
    if (freeze <= now.getTime()) {
      const c = await closeSeason(db, s.id, now);
      if (c) closed.push(c);
      continue;
    }
    const due = s.status === "scheduled" && s.startsAt.getTime() > now.getTime() ? s.startsAt.getTime() : freeze;
    next = next === null ? due : Math.min(next, due);
  }
  return { opened: opened.map((o) => o.id), closed, nextDueAt: next === null ? null : new Date(next) };
}
