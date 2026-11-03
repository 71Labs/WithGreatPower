/**
 * GET /api/market/me → 200 MarketMe: the signed-in player's Bits, tradable items, what
 * the daily caps still allow and their open listing ids; from the contract when its
 * market is live (balances on chain), from the simulated market otherwise.
 * 401 when signed out.
 */
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { handle, json } from "@/server/http";
import { readChainWallet } from "@/server/market/chain";
import { MARKET_LIMITS, marketRoute } from "@/server/market/http";
import { simWallet } from "@/server/market/sim";
import { marketView } from "@/server/market/view";
import { rateLimiter } from "@/server/rate-limit";

import type { MarketMe } from "@/lib/market/api";

export const GET = handle("market/me", (request: Request) =>
  marketRoute(async () => {
    const session = await requireSession(request);
    rateLimiter.enforce("market-me", session.playerId, MARKET_LIMITS.mePerPlayer);
    const accountId = session.player.nearAccountId;
    const { onChain } = await marketView();
    const wallet = onChain ? await readChainWallet(accountId) : await simWallet(await getDb(), { playerId: session.playerId, accountId });
    const body: MarketMe = { onChain, accountId, ...wallet };
    return json(body);
  }),
);
