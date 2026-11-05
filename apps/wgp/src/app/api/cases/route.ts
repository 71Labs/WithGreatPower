/**
 * GET /api/cases → 200 { signedIn, cases: CaseView[] } (src/server/db/cases.ts)
 *
 *   { id: "case-001", number: "001", title, status: "new" | "cleared", clearedAt, bestTicks,
 *     badge: { status: "none" | "queued" | "minted", tokenId: "trophy:badge:case-001", tx },
 *     active: { runId, expiresAt } | null }
 *
 * Signed out: every case "new" with no badge (a guest's clears live in their browser's save).
 * Never cached: a clear or a mint changes it.
 */
import { getSession } from "@/server/auth/session";
import { guestCases, listCases } from "@/server/db/cases";
import { getDb } from "@/server/db/client";
import { clientIp, handle, json } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

export const GET = handle("cases", async (request: Request) => {
  rateLimiter.enforce("cases-ip", clientIp(request), RATE_LIMITS.casesPerIp);
  const session = await getSession(request);
  if (!session) return json({ signedIn: false, cases: guestCases() });
  return json({ signedIn: true, cases: await listCases(await getDb(), session.playerId) });
});
