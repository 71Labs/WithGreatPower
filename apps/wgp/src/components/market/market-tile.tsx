"use client";

/**
 * Tonight's way into the Mempool Market: one true line about a real pool, in Gwei's own
 * words (`explainPrice`, through `marketPulse`), and today's market quest. The pool is the
 * part the player is one short of when there is one, else the price that has moved
 * furthest. It reads the market once; until then (or offline) it simply points at the stall.
 */
import Link from "next/link";
import { createElement } from "react";

import { AVATARS } from "@/components/cast";
import { ON_PAPER } from "@/components/game/kit";
import { Check, ChevronRight, Target } from "@/components/icons";
import { formatBits, formatPrice } from "@/lib/market/format";
import { holdingsOf, marketPulse, nextTrade, type MarketPulse } from "@/lib/market/prompts";
import type { MarketQuestView } from "@/lib/market/quest";

import { useMarketPeek } from "./use-market-peek";

/** The tile's line: the pool's name, what Gwei says about its price, and what she holds. Pure. */
export function pulseLine(pulse: MarketPulse): { line: string; meta: string } {
  return {
    line: `${pulse.name}: “${pulse.headline}”`,
    meta: pulse.state === "closed" ? "Closed for now" : `${formatPrice(pulse.priceMilli)} Bits · ${pulse.stock === 0 ? "none left" : `${formatBits(pulse.stock)} left`}`,
  };
}

/** The tile, from what the market said. Server-safe, so it can be tested without a browser. */
export function MarketTileView({ pulse, quest, signedIn, className = "" }: { pulse: MarketPulse | null; quest: MarketQuestView | null; signedIn: boolean; className?: string }) {
  const text = pulse ? pulseLine(pulse) : null;
  return (
    <Link
      href="/play/market"
      className={`relative flex w-full min-w-0 flex-row items-center gap-3 rounded-[20px] border-2 border-game-ink bg-game-paper p-2.5 pr-3 text-left text-game-ink shadow-[var(--game-shadow-sm)] ${ON_PAPER} focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none pointer-fine:hover:bg-game-paper-2 ${className}`}
    >
      <span aria-hidden className="block size-11 shrink-0 overflow-hidden rounded-[10px] border-2 border-game-ink bg-game-paper-2 [&>svg]:size-full">
        {createElement(AVATARS.gwei)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
          Mempool Market
          {signedIn && quest ? (
            <span className={`num inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink px-1.5 text-[10px] tracking-[0.04em] text-game-ink ${quest.done ? "bg-game-paper-2" : "bg-game-gold"}`}>
              {quest.done ? <Check aria-hidden className="size-3" strokeWidth={3} /> : <Target aria-hidden className="size-3" strokeWidth={2.5} />}
              {quest.done ? "Quest done" : `Quest +${quest.xp} XP`}
            </span>
          ) : null}
        </span>
        <span title={text?.line} className="num line-clamp-2 text-[14px] font-bold leading-[18px] [overflow-wrap:anywhere]">{text ? text.line : "Gwei Stacy’s prices move with every trade"}</span>
        {text ? <span className="num truncate text-[12px] font-medium leading-4 text-game-muted">{text.meta}</span> : null}
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
    </Link>
  );
}

export function MarketTile({ save, className }: { save: Parameters<typeof holdingsOf>[0]; className?: string }) {
  const peek = useMarketPeek();
  // The part a suit is waiting on, when there is one: that's the price this player cares about.
  const want = peek.view ? nextTrade(holdingsOf(save), peek.view, null) : null;
  const pulse = peek.view ? marketPulse(peek.view, want?.kind === "finish-suit" ? want.intent.item : null) : null;
  return <MarketTileView pulse={pulse} quest={peek.quest} signedIn={peek.signedIn} className={className} />;
}
