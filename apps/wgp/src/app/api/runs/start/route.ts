/**
 * POST /api/runs/start { assist?, abandon?, chapter? } → 201 { runId, seed, ruleset, saveRev, night, expiresAt, assist, chapter }
 * Signed in. One run in flight (409 run_active with its runId; pass abandon: true to drop
 * it) and 20 runs per UTC day (429 daily_cap).
 *
 * `chapter: "case-001"` starts a story chapter's run instead (Case File 001): any night, its
 * own budget of 30 a day, ruleset "c001-1", unranked and never a Bits mint; the client plays
 * it with startChapterRun(save, seed, chapter).
 *
 * Competitive runs (src/server/db/compete.ts), any night, never the save, never a Season board:
 * - `{ mode: "daily", ghost? }`: today's Daily Run (ruleset "4", 3 a day), played with
 *   startRun(compete.startSave, seed). `ghost`: a verified run of today's Daily raced alongside.
 * - `{ mode: "trial", course, ghost? }`: a time trial (ruleset "trial-1"), played with
 *   startTrialRun(compete.startSave, course).
 * - `{ duel: runId }`: race a verified run's ghost. Today's Daily opens the Daily; a course opens
 *   that course; a ranked night (or an earlier Daily) is raced again on its own seed and save
 *   (an unranked trial run, ruleset "4", course "duel").
 * Each answers the usual fields plus `compete: { kind, course, ghost, startSave }`.
 */
import { z } from "zod";

import { CHAPTER_IDS } from "@wgp/game-core/chapters";
import { TRIAL_COURSE_IDS } from "@wgp/game-core/compete";
import type { TrialCourseId } from "@wgp/game-core/types";

import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { startCompeteRun, type CompeteSpec } from "@/server/db/compete";
import { startRun } from "@/server/db/runs";
import { badRequest, clientIp, handle, json, readJson } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { sweepSoon } from "@/server/background";

const body = z.object({
  assist: z.boolean().optional(),
  abandon: z.boolean().optional(),
  chapter: z.enum(CHAPTER_IDS as [string, ...string[]]).optional(),
  mode: z.enum(["daily", "trial"]).optional(),
  course: z.enum(TRIAL_COURSE_IDS as [TrialCourseId, ...TrialCourseId[]]).optional(),
  ghost: z.uuid().optional(),
  duel: z.uuid().optional(),
});

const COMPETE_START_PER_PLAYER = { limit: 24, windowMs: 60_000 };

/** The competitive run a body asks for, if any. */
function competeSpec(b: z.infer<typeof body>): CompeteSpec | null {
  if (b.duel) return { duel: b.duel };
  if (b.mode === "daily") return { mode: "daily", ...(b.ghost ? { ghost: b.ghost } : {}) };
  if (b.mode === "trial") {
    if (!b.course) throw badRequest("A trial needs a course");
    return { mode: "trial", course: b.course, ...(b.ghost ? { ghost: b.ghost } : {}) };
  }
  return null;
}

export const POST = handle("runs/start", async (request: Request) => {
  rateLimiter.enforce("run-start-ip", clientIp(request), RATE_LIMITS.runStartPerIp);
  const session = await requireSession(request);
  const input = await readJson(request, body, 1024);
  const { assist, abandon, chapter } = input;
  const spec = competeSpec(input);
  // A course takes seconds and players restart it often: races have their own, roomier burst guard.
  if (spec) rateLimiter.enforce("compete-start", session.playerId, COMPETE_START_PER_PLAYER);
  else rateLimiter.enforce("run-start", session.playerId, RATE_LIMITS.runStartPerPlayer);
  if (spec && chapter) throw badRequest("A run is a case or a race, not both");
  const db = await getDb();
  const run = spec
    ? await startCompeteRun(db, { playerId: session.playerId, spec, abandon })
    : await startRun(db, { playerId: session.playerId, assist, abandon, chapter: chapter as (typeof CHAPTER_IDS)[number] | undefined });
  sweepSoon();
  return json(run, { status: 201 });
});
