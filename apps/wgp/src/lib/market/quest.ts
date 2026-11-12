/**
 * The daily market quest, as the browser sees it (the rules live in
 * src/server/market/quest.ts): make one real trade today, with Gwei or by buying a player's
 * listing, for XP. Once per UTC day; it resets at midnight UTC.
 */
import type { SimTradeRequest } from "./api";

/** XP the quest adds to the hero. XP only: it never mints Bits or items. */
export const MARKET_QUEST_XP = 30;

export interface MarketQuestView {
  /** The UTC day it's for, "2026-11-12". */
  day: string;
  done: boolean;
  xp: number;
  /** When the next one starts: midnight UTC, ISO. */
  resetsAt: string;
}

/** Trades that complete it: a buy or a sell with Gwei, or buying a listing. Listing and taking down move nothing. */
export const countsForQuest = (action: SimTradeRequest["action"]): boolean => action === "buy" || action === "sell" || action === "fill";

export const MARKET_QUEST_TEXT = "Make a trade with Gwei, or buy a player’s listing";

/** Signed in: today's quest. Null when signed out or unreachable. */
export async function getMarketQuest(signal?: AbortSignal): Promise<MarketQuestView | null> {
  try {
    const res = await fetch("/api/market/quest", { credentials: "same-origin", cache: "no-store", signal });
    if (!res.ok) return null;
    return (await res.json()) as MarketQuestView;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  }
}
