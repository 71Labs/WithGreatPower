/**
 * A hero's Bits at the moment a verified night is paid: what the faucet's wallet taper reads
 * (src/lib/market/rewards.ts `nightPay`). It comes from the same place the market reads a
 * wallet:
 *
 * - **NEAR configured:** the contract's `bits_of`, plus the Bits in this player's reward
 *   mints that haven't landed yet (`unsentBits`), so nights submitted back to back can't
 *   outrun the operator.
 * - **NEAR not configured** (a local checkout): the simulated market's wallet, the Bits
 *   minted to the player plus what they made or spent trading.
 * - **Anything else** (the RPC is down, a shape we don't know, a read slower than
 *   `HELD_READ_MS`): null, and the whole night is paid. A slow read never costs a player
 *   their Bits, and never holds up the submit for long.
 */
import { z } from "zod";

import type { Db } from "../db/client";
import { NearConfigError } from "../near/env";
import { liveReader, type ChainReader } from "./chain";
import { mintedBits, readSim, unsentBits } from "./sim";

/** How long the submit waits for the balance before paying the whole night. */
export const HELD_READ_MS = 2_500;

export interface HeldPlayer {
  playerId: string;
  accountId: string;
}

/** The balance read `submitRun` uses; tests pass their own. */
export type HeldBits = (db: Db, player: HeldPlayer) => Promise<number | null>;

const u128 = z.union([z.string().regex(/^\d{1,30}$/), z.number().int().nonnegative()]).transform(Number);

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function heldBits(db: Db, player: HeldPlayer, opts: { reader?: () => ChainReader; timeoutMs?: number } = {}): Promise<number | null> {
  let reader: ChainReader;
  try {
    reader = (opts.reader ?? liveReader)();
  } catch (error) {
    if (!(error instanceof NearConfigError)) {
      console.error(`[bits] couldn't read ${player.accountId}'s Bits, paying the whole night: ${(error as Error).message}`);
      return null;
    }
    // No contract here: the simulated market's wallet, as the market screens show it.
    try {
      const [minted, sim] = await Promise.all([mintedBits(db, player.playerId), readSim(db)]);
      return Math.max(0, minted + (sim.wallets[player.accountId] ?? 0));
    } catch (simError) {
      console.error(`[bits] couldn't read ${player.accountId}'s simulated Bits, paying the whole night: ${(simError as Error).message}`);
      return null;
    }
  }
  try {
    const [onChain, unsent] = await within(Promise.all([reader.view("bits_of", { account_id: player.accountId }), unsentBits(db, player.playerId)]), opts.timeoutMs ?? HELD_READ_MS);
    const bits = u128.parse(onChain) + unsent;
    return Number.isSafeInteger(bits) ? bits : null;
  } catch (error) {
    console.error(`[bits] couldn't read ${player.accountId}'s Bits on chain, paying the whole night: ${(error as Error).message}`);
    return null;
  }
}
