/**
 * What the chain knows about the signed-in player, for GET /api/chain/status: quick play
 * (which session keys the relayer accepts), the hero's registration, and the contract's
 * own view of the player (hero, level, suits, items) so the suit lab can say what is on
 * chain and what is only saved.
 *
 * Reading it also keeps the hero mirror honest: a player with a hero and no row gets
 * register_hero queued, and a queued row is marked registered once the contract shows
 * the hero (e.g. registered from another device, or a mirror that failed).
 */
import type { Save } from "@wgp/game-core/types";

import type { Db } from "@/server/db/client";
import type { Player } from "@/server/db/schema";

import { chainEnv, relayerEnv } from "./env";
import { heroOnChain, isOnNear, markHeroRegistered, queueHeroRegistration, type HeroOnChain } from "./heroes";
import { liveSessionKeys } from "./session-keys";

export interface OnChainPlayer {
  hero: { name: string; suit: string } | null;
  level: number;
  /** Suit ids the account holds ("stealth", not "suit:stealth"). */
  suits: string[];
  /** Item balances by item id. */
  items: Record<string, number>;
}

export interface ChainStatus {
  /** The account is a real NEAR account (test sign-ins aren't). */
  available: boolean;
  /** This server has the contract and relayer configured; until then nothing goes on chain. */
  configured: boolean;
  network: "testnet" | "mainnet" | null;
  contractId: string | null;
  accountId: string;
  hero: HeroOnChain;
  /** Public keys of the session keys the relayer accepts for this player. */
  sessionKeys: string[];
  /** The contract's view of the player; null when it couldn't be read (or nothing is on chain to read). */
  onChain: OnChainPlayer | null;
}

/** The contract's `get_player` JSON (PlayerView), or null for an account it has never seen. */
export type PlayerView = { hero: { name: string; suit: string } | null; level: number; tokens: [string, string][] } | null;

/** Reads `get_player` for an account. Injected so tests run without a chain. */
export type ReadPlayer = (accountId: string) => Promise<PlayerView>;

/** PlayerView → OnChainPlayer. A never-seen account holds nothing. Pure. */
export function toOnChainPlayer(view: PlayerView): OnChainPlayer {
  const out: OnChainPlayer = { hero: view?.hero ? { name: view.hero.name, suit: view.hero.suit } : null, level: view?.level ?? 0, suits: [], items: {} };
  for (const [token, amount] of view?.tokens ?? []) {
    if (token.startsWith("suit:")) out.suits.push(token.slice(5));
    else if (token.startsWith("item:")) out.items[token.slice(5)] = Number(amount);
  }
  return out;
}

function nearConfig(): { network: ChainStatus["network"]; contractId: string | null; configured: boolean } {
  try {
    const chain = chainEnv();
    relayerEnv();
    return { network: chain.network, contractId: chain.contractId, configured: true };
  } catch {
    return { network: null, contractId: null, configured: false };
  }
}

/** Gives up on a slow read rather than holding the screen. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export async function chainStatus(
  db: Db,
  input: { player: Pick<Player, "id" | "nearAccountId" | "authKind">; save: Save; readPlayer: ReadPlayer; now?: Date },
): Promise<ChainStatus> {
  const { player, save } = input;
  const available = isOnNear(player);
  const config = nearConfig();
  const base = { available, ...config, accountId: player.nearAccountId };
  if (!available) return { ...base, configured: false, hero: { status: "none", txHash: null, args: null }, sessionKeys: [], onChain: null };

  let hero = await queueHeroRegistration(db, player, save, input.now);
  const sessionKeys = await liveSessionKeys(db, player.id);

  let onChain: OnChainPlayer | null = null;
  if (config.configured) {
    try {
      onChain = toOnChainPlayer(await withTimeout(input.readPlayer(player.nearAccountId), 4000));
    } catch {
      onChain = null;
    }
  }
  if (onChain?.hero && hero.status !== "registered") {
    await markHeroRegistered(db, { player, args: onChain.hero }, input.now);
    hero = await heroOnChain(db, player.id);
  }
  return { ...base, hero, sessionKeys, onChain };
}
