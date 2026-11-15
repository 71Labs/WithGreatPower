/**
 * GET /api/me → 200 { signedIn: false } or { signedIn: true, player, save, rev, activeRun, runsToday, social }
 * (`social`: the player's X handle and tag opt-in, src/server/social/players.ts)
 * DELETE /api/me → 200 { signedIn: false } (signs out)
 */
import { destroySession, getSession } from "@/server/auth/session";
import { npcVisitSoon } from "@/server/background";
import { getDb } from "@/server/db/client";
import { ensureSave } from "@/server/db/players";
import { RUNS_PER_DAY, RUN_BUDGET_SCOPE, activeRun } from "@/server/db/runs";
import { clientIp, handle, json } from "@/server/http";
import { RATE_LIMITS, budgetUsed, rateLimiter, utcDay } from "@/server/rate-limit";
import { getXProfile } from "@/server/social/players";

export const GET = handle("me", async (request: Request) => {
  rateLimiter.enforce("me-ip", clientIp(request), RATE_LIMITS.mePerIp);
  npcVisitSoon();
  const session = await getSession(request);
  if (!session) return json({ signedIn: false });
  const db = await getDb();
  const now = new Date();
  const [{ save, rev }, run, used, social] = await Promise.all([
    ensureSave(db, session.playerId),
    activeRun(db, session.playerId, now),
    budgetUsed(db, { scope: RUN_BUDGET_SCOPE, key: session.playerId, period: utcDay(now) }),
    getXProfile(db, session.playerId),
  ]);
  const p = session.player;
  return json({
    signedIn: true,
    player: {
      id: p.id,
      handle: p.handle,
      nearAccountId: p.nearAccountId,
      authKind: p.authKind,
      createdAt: p.createdAt.toISOString(),
      banned: !!p.bannedAt,
      migrated: !!p.migratedLocalAt,
    },
    save,
    rev,
    activeRun: run,
    runsToday: { used, limit: RUNS_PER_DAY },
    social,
  });
});

export const DELETE = handle("me", async (request: Request) => {
  await destroySession(request);
  return json({ signedIn: false });
});
