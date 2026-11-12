/**
 * GET /api/market/quest → 200 MarketQuestView { day, done, xp, resetsAt }: the signed-in
 * player's daily market quest (src/server/market/quest.ts): one real trade a day, with Gwei
 * or by buying a listing, for XP. Reading it also grants a quest whose trade landed today
 * while the grant was held back (a ranked run in flight).
 * 401 when signed out.
 */
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { handle, json } from "@/server/http";
import { MARKET_LIMITS, marketRoute } from "@/server/market/http";
import { marketQuestStatus } from "@/server/market/quest";
import { rateLimiter } from "@/server/rate-limit";

export const GET = handle("market/quest", (request: Request) =>
  marketRoute(async () => {
    const session = await requireSession(request);
    rateLimiter.enforce("market-quest", session.playerId, MARKET_LIMITS.mePerPlayer);
    const { view } = await marketQuestStatus(await getDb(), { playerId: session.playerId, accountId: session.player.nearAccountId });
    return json(view);
  }),
);
