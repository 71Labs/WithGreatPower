/**
 * GET /api/chain/status → 200 ChainStatus (signed in; src/server/near/status.ts)
 * { available, configured, network, contractId, accountId, hero: { status, txHash, args },
 *   sessionKeys, onChain: { hero, level, suits, items } | null }
 *
 * For quick play and the suit lab: whether this server can put anything on chain, the
 * hero's registration (queued for the player's session key until it lands), the keys the
 * relayer accepts, and the contract's own view of the player. Never 503s: a server
 * without NEAR settings answers `configured: false`.
 */
import { requireSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ensureSave } from "@/server/db/players";
import { handle, json } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";
import { NEAR_RATE_LIMITS } from "@/server/near/http";
import { playerOnChain } from "@/server/near/operator";
import { chainStatus, type PlayerView } from "@/server/near/status";

export const GET = handle("chain/status", async (request: Request) => {
  const session = await requireSession(request);
  rateLimiter.enforce("chain-status", session.playerId, NEAR_RATE_LIMITS.chainStatusPerPlayer);
  const db = await getDb();
  const { save } = await ensureSave(db, session.playerId);
  const status = await chainStatus(db, {
    player: session.player,
    save,
    readPlayer: async (accountId) => (await playerOnChain(accountId)) as PlayerView,
  });
  return json(status);
});
