/**
 * GET /api/market/wanted → 200 WantedDay { day, at, onChain, items }: Gwei's wanted list for
 * today (src/lib/market/wanted.ts), the items she's short on and the multiplier a verified
 * night gets on each one's drop. Frozen per UTC day: the first request of the day snapshots
 * the market and stores it (src/server/market/wanted.ts); later ones read it back.
 * 503 market_unavailable when there's no list yet and NEAR can't be reached.
 */
import { connection } from "next/server";

import { getDb } from "@/server/db/client";
import { HttpError, clientIp, handle, json } from "@/server/http";
import { MARKET_LIMITS, marketRoute } from "@/server/market/http";
import { wantedToday } from "@/server/market/wanted";
import { rateLimiter } from "@/server/rate-limit";

export const GET = handle("market/wanted", (request: Request) =>
  marketRoute(async () => {
    await connection();
    rateLimiter.enforce("market-ip", clientIp(request), MARKET_LIMITS.readPerIp);
    const list = await wantedToday(await getDb());
    if (!list) throw new HttpError(503, "market_unavailable", "Gwei’s list isn’t posted yet; try again in a moment");
    return json(list, { cacheSeconds: 30 });
  }),
);
