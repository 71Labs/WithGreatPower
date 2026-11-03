/**
 * GET /api/market/me → 200 MarketMe: the signed-in player's Bits, tradable items, what
 * the daily caps still allow and their open listing ids; from the contract when its
 * market is live (balances on chain), from the simulated market otherwise. On chain,
 * `pendingBits` counts Bits from verified nights the operator hasn't landed yet, and
 * reading this nudges those mints out (the market screen polls it), so a night's Bits
 * arrive while the player is looking at the stall.
 * 401 when signed out.
 */
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { handle, json } from "@/server/http";
import { readChainWallet } from "@/server/market/chain";
import { MARKET_LIMITS, marketRoute } from "@/server/market/http";
import { simWallet, unsentBits } from "@/server/market/sim";
import { marketView } from "@/server/market/view";
import { rateLimiter } from "@/server/rate-limit";
import { sendMintsSoon } from "@/server/background";

import type { MarketMe } from "@/lib/market/api";

export const GET = handle("market/me", (request: Request) =>
  marketRoute(async () => {
    const session = await requireSession(request);
    rateLimiter.enforce("market-me", session.playerId, MARKET_LIMITS.mePerPlayer);
    const accountId = session.player.nearAccountId;
    const { onChain } = await marketView();
    const db = await getDb();
    const [wallet, pendingBits] = onChain
      ? await Promise.all([readChainWallet(accountId), unsentBits(db, session.playerId)])
      : [await simWallet(db, { playerId: session.playerId, accountId }), 0];
    if (onChain && pendingBits > 0) sendMintsSoon();
    const body: MarketMe = { onChain, accountId, ...wallet, pendingBits };
    return json(body);
  }),
);
