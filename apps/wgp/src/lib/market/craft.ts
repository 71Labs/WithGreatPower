/**
 * What crafting a suit costs in Bits, and whether a player can pay it. One rule, shared by
 * the Suit lab (what it prints and when Craft is off), the server's save-only craft
 * (src/server/market/craft.ts) and the relayer's check before it spends gas.
 *
 * The rule is the contract's (`craft_suit`, contracts/wgp/src/lib.rs): a suit with a recipe
 * burns the market's `craft_bits` on top of its loot; a starter suit, which has no recipe,
 * burns nothing. `craft_bits` is read live from the market's params (0 on mainnet today,
 * so nothing here shows or blocks anything until the owner sets it).
 */
import { SUITS } from "@wgp/game-core/data";
import type { SuitId } from "@wgp/game-core/types";

import type { MarketParams } from "./config";
import { bitsText } from "./format";

/** Error codes the server answers (HTTP 422) when it refuses a craft over Bits. */
export const CRAFT_BITS_SHORT = "craft_bits_short";
export const CRAFT_NEEDS_CHAIN = "craft_needs_chain";

/** Bits `craft_suit` burns for `suit` under these params; 0 when unknown, off, or the suit has no recipe. */
export function craftCost(suit: SuitId, params: Pick<MarketParams, "craftBits"> | null | undefined): number {
  const cost = params?.craftBits ?? 0;
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  return Object.keys(SUITS[suit].recipe).length === 0 ? 0 : Math.floor(cost);
}

/** The contract's own words when the Bits are short: "Needs bits x130". */
export const craftShortMessage = (short: number) => `Needs bits x${short}`;

/** How many Bits a refusal says are missing, or null when it isn't about Bits. */
export function bitsShortIn(raw: string): number | null {
  const m = /\bbits x(\d+)/i.exec(raw);
  return m ? Number(m[1]) : null;
}

/** Where the player's Bits are, as far as the screen knows. */
export type CraftWallet =
  /** A guest: no account, so no Bits. */
  | { kind: "guest" }
  /** Signed in, wallet not read yet. */
  | { kind: "loading" }
  /** Signed in, and the wallet couldn't be read: the server decides. */
  | { kind: "unknown" }
  | {
      kind: "known";
      bits: number;
      /** The market is the contract's, so the burn has to be a signed `craft_suit` call. */
      onChain: boolean;
      /** This player's crafts go on chain (quick play is on). Ignored in the simulated market. */
      signs: boolean;
    };

export type CraftGate =
  | { code: "bits"; text: string; short: number }
  | { code: "sign-in" | "quick-play" | "checking"; text: string };

/**
 * Why Craft is off for a suit that costs `cost` Bits, or null when the player can pay (or
 * nothing is charged). Text is ready to print next to the button.
 */
export function craftGate(cost: number, wallet: CraftWallet): CraftGate | null {
  if (cost <= 0) return null;
  switch (wallet.kind) {
    case "guest":
      return { code: "sign-in", text: `Crafting burns ${bitsText(cost)}. Bits come from ranked nights, so sign in to earn them.` };
    case "loading":
      return { code: "checking", text: "Checking your Bits…" };
    case "unknown":
      return null;
    case "known": {
      const short = cost - wallet.bits;
      if (short > 0) {
        return { code: "bits", short, text: `Crafting burns ${bitsText(cost)} and you have ${bitsText(wallet.bits)}. Sell spare loot to Gwei or finish a ranked night for the other ${short.toLocaleString("en-US")}.` };
      }
      if (wallet.onChain && !wallet.signs) {
        return { code: "quick-play", text: `Crafting burns ${bitsText(cost)} on NEAR. Turn on quick play to sign the burn.` };
      }
      return null;
    }
  }
}

/** What to tell a player whose craft the server (or the contract) refused over Bits. Null for any other refusal. */
export function craftRefusalText(code: string | undefined, raw: string | undefined): string | null {
  if (code === CRAFT_NEEDS_CHAIN) return "Crafting burns Bits on NEAR, so it has to go through quick play, and it couldn’t just now. Nothing was spent. Check quick play is on, then craft again.";
  const short = bitsShortIn(raw ?? "");
  if (code === CRAFT_BITS_SHORT || short !== null) {
    return short !== null
      ? `You’re ${bitsText(short)} short of what crafting burns, so nothing was spent. Sell spare loot to Gwei or finish a ranked night.`
      : "You don’t have the Bits crafting burns, so nothing was spent. Sell spare loot to Gwei or finish a ranked night.";
  }
  return null;
}
