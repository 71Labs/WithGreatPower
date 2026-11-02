/**
 * GET /api/me → 200 { signedIn: false } or { signedIn: true, player, save, rev, activeRun, runsToday }
 * DELETE /api/me → 200 { signedIn: false } (signs out)
 */
import { destroySession, getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ensureSave } from "@/server/db/players";
import { RUNS_PER_DAY, RUN_BUDGET_SCOPE, activeRun } from "@/server/db/runs";
import { clientIp, handle, json } from "@/server/http";
import { RATE_LIMITS, budgetUsed, rateLimiter, utcDay } from "@/server/rate-limit";

export const GET = handle("me", async (request: Request) => {
  rateLimiter.enforce("me-ip", clientIp(request), RATE_LIMITS.mePerIp);
  const session = await getSession(request);
  if (!session) return json({ signedIn: false });
  const db = await getDb();
  const now = new Date();
  const [{ save, rev }, run, used] = await Promise.all([
    ensureSave(db, session.playerId),
    activeRun(db, session.playerId, now),
    budgetUsed(db, { scope: RUN_BUDGET_SCOPE, key: session.playerId, period: utcDay(now) }),
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
  });
});

export const DELETE = handle("me", async (request: Request) => {
  await destroySession(request);
  return json({ signedIn: false });
});
