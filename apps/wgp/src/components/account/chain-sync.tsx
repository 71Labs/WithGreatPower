"use client";

/**
 * No UI: keeps the signed-in player's chain status loaded (src/game/chain.ts) and, once
 * quick play is on, registers a hero that is only queued on chain, in the background.
 * Mounted once by AccountCenter on every /play screen. Signing out forgets the status.
 */
import { useEffect } from "react";

import { ensureHeroOnChain, refreshChain, resetChain, useChain } from "@/game/chain";
import { useAccount, useGame } from "@/game/store";

export function ChainSync() {
  const account = useAccount();
  const { save } = useGame();
  const chain = useChain();
  const player = account.status === "signed-in" ? account.me.player : null;
  const playerId = player?.id ?? null;
  const signedOut = account.status === "guest";
  const hasHero = !!save?.hero;

  useEffect(() => {
    if (signedOut) resetChain();
  }, [signedOut]);

  // A new player, or a hero just created or imported: ask again (the server queues register_hero).
  useEffect(() => {
    if (player && player.authKind !== "dev" && hasHero) void refreshChain(player);
    // `player` changes identity on every /api/me refresh; its id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, hasHero]);

  const ready = chain.owner?.id === playerId && chain.quickPlay.state === "on" && chain.status?.hero.status === "queued";
  useEffect(() => {
    if (ready) void ensureHeroOnChain();
  }, [ready]);

  return null;
}
