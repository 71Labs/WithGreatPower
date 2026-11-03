/**
 * GET /api/cron/market-snapshot (Authorization: Bearer $CRON_SECRET) → 200 { onChain, written }
 * Writes a price-history snapshot of every pool whose price moved, or whose last row is
 * over an hour old, so charts keep a point even when nobody trades. Point a cron at it
 * (every 10 to 60 minutes); trades write their own rows as they happen.
 */
import { getDb } from "@/server/db/client";
import { assertCron, handle, json } from "@/server/http";
import { recordSnapshots } from "@/server/market/history";
import { marketRoute } from "@/server/market/http";
import { marketSource, poolsOf } from "@/server/market/view";

export const GET = handle("cron/market-snapshot", (request: Request) =>
  marketRoute(async () => {
    assertCron(request);
    const source = await marketSource();
    const written = await recordSnapshots(await getDb(), source.onChain, poolsOf(source).pools);
    return json({ onChain: source.onChain, written });
  }),
);
