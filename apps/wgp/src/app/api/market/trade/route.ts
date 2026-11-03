/**
 * POST /api/market/trade → 200 { receipt, save, rev, bits, market? }: a trade in the SIMULATED
 * market, which runs the contract's rules on the server until the contract's market is
 * live (src/server/market/sim.ts). Once it is, trades are session-key calls relayed by
 * /api/relay/meta and this answers 409 on_chain.
 *
 * Body (one of):
 *   { action: "buy",    item, amount, maxBits }   pay at most maxBits, fee included
 *   { action: "sell",   item, amount, minBits }   get at least minBits, after the fee
 *   { action: "list",   item, amount, price }     escrow items at a price for the lot
 *   { action: "fill",   listingId }               buy a listing
 *   { action: "cancel", listingId }               take your listing down
 *
 * 422 <rule> (slippage, funds, stock, till, price, daily_cap, open_cap, full, gone, own,
 * not_seller, closed, amount, unknown_item) with the contract's words · 409 run_active
 * while a ranked run is in flight · 409 rev_conflict · 401 signed out.
 */
import { z } from "zod";

import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { clientIp, conflict, handle, json, readJson } from "@/server/http";
import { MARKET_LIMITS, marketRoute } from "@/server/market/http";
import { simAct } from "@/server/market/sim";
import { marketSnapshot, marketView, refreshMarket } from "@/server/market/view";
import { rateLimiter } from "@/server/rate-limit";

const item = z.enum(Object.keys(ITEMS) as [ItemId, ...ItemId[]]);
const amount = z.number().int().min(1).max(1_000);
const bits = z.number().int().min(0).max(1e12);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("buy"), item, amount, maxBits: bits }),
  z.object({ action: z.literal("sell"), item, amount, minBits: bits }),
  z.object({ action: z.literal("list"), item, amount, price: bits }),
  z.object({ action: z.literal("fill"), listingId: z.number().int().min(1) }),
  z.object({ action: z.literal("cancel"), listingId: z.number().int().min(1) }),
]);

export const POST = handle("market/trade", (request: Request) =>
  marketRoute(async () => {
    rateLimiter.enforce("market-trade-ip", clientIp(request), MARKET_LIMITS.tradePerIp);
    const session = await requireSession(request);
    rateLimiter.enforce("market-trade", session.playerId, MARKET_LIMITS.tradePerPlayer);
    const act = await readJson(request, body, 2 * 1024);
    if ((await marketView()).onChain) throw conflict("on_chain", "The market is on NEAR now; trade with quick play");
    const player = { playerId: session.playerId, accountId: session.player.nearAccountId };
    const result = await simAct(await getDb(), { ...player, act });
    refreshMarket();
    // The cached view can still be the one from before the trade: answer with the market as it is now.
    const market = await marketSnapshot(player).catch(() => null);
    return json({ ...result, ...(market ? { market } : {}) });
  }),
);
