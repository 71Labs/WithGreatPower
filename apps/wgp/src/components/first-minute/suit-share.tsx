/**
 * "Share on X" for a suit just stitched from villain loot: the moment a player has something
 * to show. An intent link the player sends from their own account; nothing is posted for
 * them. It links the landing, whose card shows the game. Starter suits (free unlocks) don't
 * get one. Server-safe.
 */
import { ShareOnX } from "@/components/social/share-on-x";
import { SITE_URL } from "@/lib/site";
import { SUITS } from "@wgp/game-core/data";
import type { SuitId } from "@wgp/game-core/types";

/** "I just stitched the Sesame suit from villain loot in With Great Power 🕸️ https://…" */
export function suitShareText(suit: SuitId): string {
  return `I just stitched the ${SUITS[suit].name} suit from villain loot in With Great Power 🕸️ ${SITE_URL}`;
}

export function SuitShare({ suit, className = "" }: { suit: SuitId | null; className?: string }) {
  if (!suit || !SUITS[suit] || SUITS[suit].starter) return null;
  return <ShareOnX text={suitShareText(suit)} label={`Share your ${SUITS[suit].name} suit on X`} size="sm" className={`self-start ${className}`} />;
}
