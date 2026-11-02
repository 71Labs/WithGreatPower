/**
 * Cached board reads and their invalidation. The top of each board is shared by every
 * viewer, so it sits in a `"use cache"` function tagged per board and period, fresh for
 * about 15 s; a verified run expires its boards' tags straight away. The viewer's own
 * rank is never cached (it's per player and cheap).
 *
 * Route Handlers can't call `updateTag` (Server Actions only), so invalidation uses
 * `revalidateTag(tag, { expire: 0 })`, which the docs give as its Route Handler
 * equivalent: the next read waits for fresh data instead of serving stale.
 */
import { cacheLife, cacheTag, revalidateTag } from "next/cache";

import { getDb } from "./client";
import { LEADERBOARD_TAG, boardTag, countEntries, topEntries, type BoardRow } from "./leaderboard";
import type { Board } from "./schema";

export const BOARD_PAGE = 50;

export async function cachedBoard(board: Board, period: string): Promise<{ rows: BoardRow[]; total: number }> {
  "use cache";
  cacheTag(LEADERBOARD_TAG, boardTag(board, period));
  cacheLife({ stale: 15, revalidate: 15, expire: 60 });
  const db = await getDb();
  const [rows, total] = await Promise.all([topEntries(db, board, period, BOARD_PAGE), countEntries(db, board, period)]);
  return { rows, total };
}

/** Expires the given board tags now. Call from a Route Handler after the write commits. */
export function refreshBoards(tags: string[]): void {
  for (const tag of new Set(tags)) revalidateTag(tag, { expire: 0 });
}
