/**
 * GET /api/market/listings?item=&from=&limit= → 200 { onChain, total, listings: ListingView[] }
 * Open player listings, newest first, with each one's price per item against the
 * vendor's. Paged with `from` and `limit` (at most 100). Cached about 10 s.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import { npcVisitSoon } from "@/server/background";
import { badRequest, clientIp, handle, json } from "@/server/http";
import { MARKET_LIMITS, marketRoute } from "@/server/market/http";
import { marketListings } from "@/server/market/view";
import { rateLimiter } from "@/server/rate-limit";

const query = z.object({
  item: z.enum(Object.keys(ITEMS) as [ItemId, ...ItemId[]]).optional(),
  from: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = handle("market/listings", (request: NextRequest) =>
  marketRoute(async () => {
    const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw badRequest("Bad listings query", { issues: parsed.error.issues.map((i) => i.message) });
    rateLimiter.enforce("market-ip", clientIp(request), MARKET_LIMITS.readPerIp);
    npcVisitSoon();
    const { item, from, limit } = parsed.data;
    const all = await marketListings();
    const rows = item ? all.listings.filter((l) => l.item === item) : all.listings;
    return json({ onChain: all.onChain, total: rows.length, listings: rows.slice(from, from + limit) }, { cacheSeconds: 10 });
  }),
);
