/**
 * Crafting a suit costs Bits when the market's `craft_bits` is above 0 (the contract's
 * `craft_suit` burns them with the recipe; src/lib/market/craft.ts has the rule). The
 * server refuses any craft the contract would refuse, reading the Bits from the same place
 * the market does:
 *
 * - **Simulated market** (no contract market here): the save-only craft (/api/actions) checks
 *   the player's simulated wallet and burns the Bits in the same transaction that writes
 *   the save, on the locked `market_sim` row, so local play matches the chain.
 * - **Contract's market, quick play on:** the craft is a relayed `craft_suit`, and the
 *   contract burns the Bits. `assertCraftAffordable` checks the on-chain wallet first, so a
 *   craft that would be refused never spends the relayer's gas.
 * - **Contract's market, save-only craft** (quick play off, or the relayer can't take it):
 *   the server can't burn a player's Bits on chain, so with a cost set it refuses the
 *   craft (`craft_needs_chain`) rather than hand out a suit the contract would have charged
 *   for. With `craft_bits` 0 (mainnet today) this path saves the craft exactly as before.
 *
 * Starter suits have no recipe and never cost Bits.
 */
import { eq, sql } from "drizzle-orm";

import { reduce } from "@wgp/game-core/engine";
import type { SuitId } from "@wgp/game-core/types";

import { CRAFT_BITS_SHORT, CRAFT_NEEDS_CHAIN, craftCost, craftShortMessage } from "@/lib/market/craft";
import { bitsText } from "@/lib/market/format";

import { applyAction, type ActionResult, type MenuAction } from "../db/actions";
import type { Db } from "../db/client";
import { ensureSave } from "../db/players";
import { marketSim } from "../db/schema";
import { HttpError } from "../http";
import { readChainMarket, readChainWallet } from "./chain";
import { mintedBits, seedSim, SIM_ID, simStateOf, type SimState } from "./sim";

export type CraftAction = Extract<MenuAction, { type: "craft-suit" }>;

/** The contract's market as far as crafting needs it; tests swap in a fake. */
export interface CraftChain {
  /** The market's params when the contract's market is live, else null. */
  market(): Promise<{ params: { craftBits: number } } | null>;
  /** The account's Bits on chain. */
  bits(accountId: string): Promise<number>;
}

const realChain: CraftChain = {
  market: readChainMarket,
  bits: async (accountId) => (await readChainWallet(accountId)).bits,
};

const short = (cost: number, bits: number) => new HttpError(422, CRAFT_BITS_SHORT, craftShortMessage(cost - bits), { cost, bits });

export interface CraftResult extends ActionResult {
  /** Bits this craft burned in the simulated market (0 when nothing was charged). */
  burned: number;
}

/**
 * The save-only craft, cost-aware: what POST /api/actions runs for `craft-suit`.
 * Throws 422 `craft_bits_short` ("Needs bits xN", the contract's words) when the player's
 * Bits don't cover the cost, and 422 `craft_needs_chain` when the cost can only be burned
 * by a signed call. Otherwise it is `applyAction`, plus the burn in the simulated market.
 */
export async function craftSuitAction(
  db: Db,
  input: { playerId: string; accountId: string; action: CraftAction; rev: number; now?: Date },
  chain: CraftChain = realChain,
): Promise<CraftResult> {
  const now = input.now ?? new Date();
  const suit = input.action.suit as SuitId;
  const apply = (on: Db) => applyAction(on, { playerId: input.playerId, action: input.action, rev: input.rev, now });

  const live = await chain.market();
  if (live) {
    const cost = craftCost(suit, live.params);
    if (cost === 0) return { ...(await apply(db)), burned: 0 };
    // A craft the reducer would refuse anyway (already owned, under level, no loot) answers as it always has.
    const { save } = await ensureSave(db, input.playerId);
    if (reduce(save, input.action) === save) return { ...(await apply(db)), burned: 0 };
    const bits = await chain.bits(input.accountId);
    if (bits < cost) throw short(cost, bits);
    throw new HttpError(422, CRAFT_NEEDS_CHAIN, `Crafting burns ${bitsText(cost)} on NEAR; turn on quick play to craft`, { cost });
  }

  return db.transaction(async (tx): Promise<CraftResult> => {
    await tx.insert(marketSim).values({ id: SIM_ID, state: seedSim(), rev: 0, updatedAt: now }).onConflictDoNothing({ target: marketSim.id });
    const [row] = await tx.select().from(marketSim).where(eq(marketSim.id, SIM_ID)).for("update");
    const state = simStateOf(row!.state);
    const cost = craftCost(suit, state.book.params);
    if (cost === 0) return { ...(await apply(tx)), burned: 0 };

    // The contract's order: ownership, level and loot first (the reducer's rules), then the Bits.
    const result = await apply(tx);
    // The reducer refused (already owned, under level, no loot): nothing crafted, nothing burned.
    if (!result.applied) return { ...result, burned: 0 };
    const bits = (await mintedBits(tx, input.playerId)) + (state.wallets[input.accountId] ?? 0);
    // Throwing rolls the transaction back, so the save the reducer just wrote is undone.
    if (bits < cost) throw short(cost, bits);

    const wallets = { ...state.wallets, [input.accountId]: (state.wallets[input.accountId] ?? 0) - cost };
    await tx
      .update(marketSim)
      .set({ state: { ...state, wallets, craftBurned: (state.craftBurned ?? 0) + cost } satisfies SimState, rev: sql`${marketSim.rev} + 1`, updatedAt: now })
      .where(eq(marketSim.id, SIM_ID));
    return { ...result, burned: cost };
  });
}

/**
 * Before the relayer pays for a `craft_suit`: refuses (422 `craft_bits_short`, the
 * contract's words) when the account's on-chain Bits don't cover the cost. A read that
 * fails lets the call through; the contract checks again and has the last word.
 */
export async function assertCraftAffordable(input: { accountId: string; suit: SuitId }, chain: CraftChain = realChain): Promise<void> {
  let cost: number;
  let bits: number;
  try {
    const live = await chain.market();
    if (!live) return;
    cost = craftCost(input.suit, live.params);
    if (cost === 0) return;
    bits = await chain.bits(input.accountId);
  } catch (error) {
    console.error(`[craft] couldn't read ${input.accountId}'s Bits before a craft: ${(error as Error).message}`);
    return;
  }
  if (bits < cost) throw short(cost, bits);
}
