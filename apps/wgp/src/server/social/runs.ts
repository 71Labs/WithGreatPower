/**
 * What a run's public page and card show: a verified run's score, night, dates and who
 * played it. Unverified, unknown and banned players' runs aren't public. A verified run
 * never changes, so readers may cache it for long (src/server/social/run-cache.ts).
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import type { Save, SuitId } from "@wgp/game-core/types";

import type { Db } from "../db/client";
import { players, runs } from "../db/schema";

export interface PublicRun {
  runId: string;
  score: number;
  ticks: number;
  night: number;
  handle: string;
  nearAccountId: string;
  heroName: string | null;
  suit: SuitId | null;
  /** Assist runs are verified and saved but kept off the boards. */
  assist: boolean;
  issuedAt: string;
  submittedAt: string | null;
  digest: string | null;
}

export const isRunId = (id: string) => z.uuid().safeParse(id).success;

export async function publicRun(db: Db, runId: string): Promise<PublicRun | null> {
  if (!isRunId(runId)) return null;
  const [row] = await db
    .select({
      runId: runs.id,
      score: runs.verifiedScore,
      ticks: runs.ticks,
      night: runs.night,
      startSave: runs.startSave,
      assist: runs.assist,
      issuedAt: runs.issuedAt,
      submittedAt: runs.submittedAt,
      digest: runs.digest,
      handle: players.handle,
      nearAccountId: players.nearAccountId,
    })
    .from(runs)
    .innerJoin(players, eq(players.id, runs.playerId))
    .where(and(eq(runs.id, runId), eq(runs.status, "verified"), isNull(players.bannedAt)))
    .limit(1);
  if (!row || row.score == null) return null;
  const hero = (row.startSave as Save | null)?.hero ?? null;
  return {
    runId: row.runId,
    score: row.score,
    ticks: row.ticks ?? 0,
    night: row.night,
    handle: row.handle,
    nearAccountId: row.nearAccountId,
    heroName: hero?.name ?? null,
    suit: hero?.suit ?? null,
    assist: row.assist,
    issuedAt: row.issuedAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    digest: row.digest,
  };
}
