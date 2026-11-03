/**
 * Moving a player to a new NEAR account id: an unclaimed Google player (on their key's
 * implicit account id) who just claimed `<handle>.<parent>`. Everything keyed by the
 * player's id (save, runs, boards, sessions) stays as it is; what is keyed by the
 * account id moves in one transaction:
 * - the player row (account id and handle);
 * - unsent outbox rows: held mints now target the new account. The contract counts
 *   reward nonces per account and none of these were ever sent (unclaimed mints are
 *   held, src/server/db/outbox.ts), so their nonces 1, 2, … are exactly what the fresh
 *   account expects;
 * - the chain mirror, the market's price history and the simulated market's book.
 */
import { and, eq, ne, sql } from "drizzle-orm";

import { conflict } from "@/server/http";
import { moveSimAccount } from "@/server/market/sim";

import type { Db } from "./client";
import { chainOps, itemsMirror, marketPrices, players, type Player } from "./schema";

export async function movePlayerAccount(db: Db, input: { playerId: string; from: string; to: string; handle: string; now?: Date }): Promise<Player> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    // Locked like a mint locks it, so a mint queued meanwhile waits and then takes the new account.
    const [player] = await tx.select().from(players).where(eq(players.id, input.playerId)).for("update");
    if (!player) throw new Error(`No player ${input.playerId}`);
    if (player.nearAccountId === input.to) return player;
    if (player.nearAccountId !== input.from) throw conflict("account_changed", "Your account changed in the meantime; reload and try again");

    const [moved] = await tx.update(players).set({ nearAccountId: input.to, handle: input.handle }).where(eq(players.id, player.id)).returning();
    await tx
      .update(chainOps)
      .set({ payload: sql`jsonb_set(${chainOps.payload}, '{accountId}', to_jsonb(${input.to}::text))`, updatedAt: now })
      .where(and(eq(chainOps.playerId, player.id), ne(chainOps.status, "sent"), sql`${chainOps.payload}->>'accountId' = ${input.from}`));
    await tx.update(itemsMirror).set({ accountId: input.to, updatedAt: now }).where(eq(itemsMirror.accountId, input.from));
    await tx.update(marketPrices).set({ accountId: input.to }).where(eq(marketPrices.accountId, input.from));
    await moveSimAccount(tx, input.from, input.to, now);
    return moved ?? player;
  });
}
