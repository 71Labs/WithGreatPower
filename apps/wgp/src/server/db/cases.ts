/**
 * Story chapters ("case files") on the server. A chapter run is a run like any other (runs.ts:
 * issued, submitted, replayed) with `runs.mode` set to the chapter id and `runs.ruleset` to its
 * CHAPTER_RULESET, but it is unranked: never on a board, never a Bits mint. Its first verified
 * clear closes the case in the save (`save.cases[id]`, game-core rules/chapters.ts), pays the
 * case's XP and queues one soulbound badge, `trophy:badge:<id>`, through `mint_rewards`'s
 * `badges` (outbox.ts, dedupe `badge:<id>:<playerId>`, so a player can only ever queue one).
 * Later clears only lower `bestTicks`.
 */
import { and, eq, gt } from "drizzle-orm";

import { caseRecord, CHAPTER_IDS, CHAPTERS } from "@wgp/game-core/chapters";
import type { CaseRecord, ChapterId, Save } from "@wgp/game-core/types";

import type { Db } from "./client";
import { ensureSave } from "./players";
import { chainOps, runs } from "./schema";

/** Chapter runs a player may start per UTC day (their own budget, apart from ranked nights). */
export const CASE_RUNS_PER_DAY = 30;
export const CASE_BUDGET_SCOPE = "runs:case";

/** The outbox key of a player's badge for a case: one per player, ever. */
export const badgeKey = (chapter: ChapterId, playerId: string) => `badge:${chapter}:${playerId}`;

/** The badge's token on chain. */
export const badgeTokenId = (chapter: ChapterId) => `trophy:badge:${CHAPTERS[chapter].badge}`;

export interface BadgeView {
  /** none: not earned (or a guest). queued: earned, waiting in the outbox. minted: on chain (`tx`). */
  status: "none" | "queued" | "minted";
  tokenId: string;
  tx: string | null;
}

export async function badgeView(db: Db, chapter: ChapterId, playerId: string): Promise<BadgeView> {
  const [op] = await db
    .select({ status: chainOps.status, txHash: chainOps.txHash })
    .from(chainOps)
    .where(eq(chainOps.dedupeKey, badgeKey(chapter, playerId)))
    .limit(1);
  const minted = op?.status === "sent";
  return { status: !op ? "none" : minted ? "minted" : "queued", tokenId: badgeTokenId(chapter), tx: minted ? (op.txHash ?? null) : null };
}

/** What a submitted chapter run did to the case. */
export interface CaseOutcome {
  id: ChapterId;
  /** This run closed the case (Mary freed). */
  cleared: boolean;
  /** This run was the case's first verified clear: the badge was queued with it. */
  firstClear: boolean;
  /** The case in the save after this run. */
  record: CaseRecord;
  badge: BadgeView;
}

/** One case file, as GET /api/cases lists it. */
export interface CaseView {
  id: ChapterId;
  /** "001". */
  number: string;
  title: string;
  status: "new" | "cleared";
  clearedAt: string | null;
  bestTicks: number | null;
  badge: BadgeView;
  /** A run of this case in flight (resume it, or start over with `abandon`), else null. */
  active: { runId: string; expiresAt: string } | null;
}

function view(chapter: ChapterId, save: Pick<Save, "cases"> | null, badge: BadgeView, active: CaseView["active"]): CaseView {
  const info = CHAPTERS[chapter];
  const rec = save ? caseRecord(save, chapter) : null;
  const cleared = !!rec?.cleared && !!rec.verified;
  return {
    id: chapter,
    number: info.number,
    title: info.title,
    status: cleared ? "cleared" : "new",
    clearedAt: cleared ? rec!.clearedAt : null,
    bestTicks: cleared ? rec!.bestTicks : null,
    badge,
    active,
  };
}

/** Every case file for a signed-in player: closed or not, the best time, the badge, a run in flight. */
export async function listCases(db: Db, playerId: string, now = new Date()): Promise<CaseView[]> {
  const { save } = await ensureSave(db, playerId);
  const out: CaseView[] = [];
  for (const id of CHAPTER_IDS) {
    const [run] = await db
      .select({ id: runs.id, expiresAt: runs.expiresAt })
      .from(runs)
      .where(and(eq(runs.playerId, playerId), eq(runs.status, "issued"), eq(runs.mode, id), gt(runs.expiresAt, now)))
      .limit(1);
    out.push(view(id, save, await badgeView(db, id, playerId), run ? { runId: run.id, expiresAt: run.expiresAt.toISOString() } : null));
  }
  return out;
}

/** The case files a guest sees from the server: all new (a guest's clears live in their browser). */
export function guestCases(): CaseView[] {
  return CHAPTER_IDS.map((id) => view(id, null, { status: "none", tokenId: badgeTokenId(id), tx: null }, null));
}
