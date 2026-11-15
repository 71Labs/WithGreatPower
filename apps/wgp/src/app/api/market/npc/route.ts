/**
 * GET /api/market/npc → 200 NpcTraderView (src/lib/market/npc-api.ts): Sandwich Man, the
 * market's NPC arbitrageur. His mode ("on-chain" with his own NEAR account, "simulated",
 * or "off" when he isn't configured), wallet, holdings, open listings and the last lines
 * of his ledger, each with its reason. Built at most every 10 s; his actions expire it.
 *
 * Reading the market is also one of his two triggers: at most once every five minutes he
 * takes a look after the response (src/server/background.ts `npcTraderSoon`).
 */
import { connection } from "next/server";

import { npcTraderSoon, npcVisitSoon } from "@/server/background";
import { clientIp, handle, json } from "@/server/http";
import { MARKET_LIMITS, marketRoute } from "@/server/market/http";
import { npcTraderView } from "@/server/npc/view";
import { rateLimiter } from "@/server/rate-limit";

export const GET = handle("market/npc", (request: Request) =>
  marketRoute(async () => {
    await connection();
    rateLimiter.enforce("market-ip", clientIp(request), MARKET_LIMITS.readPerIp);
    npcTraderSoon("read");
    npcVisitSoon();
    return json(await npcTraderView());
  }),
);
