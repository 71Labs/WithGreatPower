/**
 * GET /api/market → 200 MarketView (src/lib/market/api.ts): every item's live price, the
 * cost of buying one and the pay for selling one (gas fee included), stock, a sparkline
 * and the 24-hour change, from the contract's market when it's live and the simulated
 * one otherwise (`onChain` says which). Cached about 10 s; trades expire it.
 * 503 market_unavailable when NEAR can't be reached.
 */
import { connection } from "next/server";

import { clientIp, handle, json } from "@/server/http";
import { MARKET_LIMITS, marketRoute } from "@/server/market/http";
import { npcVisitSoon, snapshotMarketSoon } from "@/server/background";
import { marketView } from "@/server/market/view";
import { rateLimiter } from "@/server/rate-limit";

export const GET = handle("market", (request: Request) =>
  marketRoute(async () => {
    await connection();
    rateLimiter.enforce("market-ip", clientIp(request), MARKET_LIMITS.readPerIp);
    snapshotMarketSoon();
    npcVisitSoon();
    return json(await marketView(), { cacheSeconds: 10 });
  }),
);
