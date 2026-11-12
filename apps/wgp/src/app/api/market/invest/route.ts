/**
 * POST /api/market/invest → 200 { action, receipt, bits, market? }: invest in one of Gwei's
 * tills in the SIMULATED market, withdraw a stake, or claim its fee earnings. The rules are
 * contract v3's (src/lib/market/invest.ts mirrors contracts/wgp/src/invest.rs), run by the
 * server on the player's own Bits (src/server/market/sim.ts `simStake`).
 *
 * Once the contract's market is live this answers 409 on_chain: on a v3 contract investing
 * is a session-key call relayed by /api/relay/meta; on v2 (mainnet today) there is no
 * investing, and nothing here or there sends such a call.
 *
 * Body (one of):
 *   { action: "invest",   item, bits }   put Bits into that item's till
 *   { action: "withdraw", item, bits }   take that many Bits of your stake back, with any earnings
 *   { action: "claim",    item }         take the fee earnings; the stake stays
 *
 * 422 <rule> with the contract's words: invest_closed, invest_amount, invest_room,
 * daily_cap, funds, no_stake, stake_amount, locked, till_short, nothing_earned, closed,
 * unknown_item · 409 run_active while a ranked run is in flight · 401 signed out.
 */
import { z } from "zod";

import { ITEMS } from "@wgp/game-core/data";
import type { ItemId } from "@wgp/game-core/types";

import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { clientIp, conflict, handle, json, readJson } from "@/server/http";
import { MARKET_LIMITS, marketRoute } from "@/server/market/http";
import { simStake } from "@/server/market/sim";
import { marketSnapshot, marketView, refreshMarket } from "@/server/market/view";
import { rateLimiter } from "@/server/rate-limit";

const item = z.enum(Object.keys(ITEMS) as [ItemId, ...ItemId[]]);
const bits = z.number().int().min(1).max(1e12);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invest"), item, bits }),
  z.object({ action: z.literal("withdraw"), item, bits }),
  z.object({ action: z.literal("claim"), item }),
]);

export const POST = handle("market/invest", (request: Request) =>
  marketRoute(async () => {
    rateLimiter.enforce("market-invest-ip", clientIp(request), MARKET_LIMITS.investPerIp);
    const session = await requireSession(request);
    rateLimiter.enforce("market-invest", session.playerId, MARKET_LIMITS.investPerPlayer);
    const act = await readJson(request, body, 2 * 1024);
    if ((await marketView()).onChain) throw conflict("on_chain", "The market is on NEAR now; investing there needs contract v3");
    const player = { playerId: session.playerId, accountId: session.player.nearAccountId };
    const result = await simStake(await getDb(), { ...player, act });
    refreshMarket();
    // The cached view can still be the one from before: answer with the market as it is now.
    const market = await marketSnapshot(player).catch(() => null);
    return json({ ...result, ...(market ? { market } : {}) });
  }),
);
