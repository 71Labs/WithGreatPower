"use client";

/**
 * The market's first-visit coach for a signed-in player: three short steps (your Bits,
 * Gwei's price and "Why this price?", then buy or sell), each shown right above the part
 * of the screen it's about, which gets a gold ring. Skippable at every step, never modal,
 * and shown once per browser (a per-viewer convenience in localStorage; blocked storage
 * just means it can show again). A first trade also ends it: the player has done the thing.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

import { StickerButton } from "@/components/game/kit";
import { MARKET_QUEST_XP } from "@/lib/market/quest";

import { formatBits } from "./sparkline";

export type CoachTarget = "bits" | "price" | "trade";

export interface CoachStep {
  target: CoachTarget;
  title: string;
  text: string;
}

/** The three steps, with the player's own Bits in the first. Pure. */
export function coachSteps(bits: number | null): CoachStep[] {
  return [
    {
      target: "bits",
      title: "Your Bits",
      text: `${bits === null ? "Your Bits show here." : `You have ${formatBits(bits)} ${bits === 1 ? "Bit" : "Bits"}.`} Every verified night pays more, and this stall is where you spend them.`,
    },
    {
      target: "price",
      title: "Gwei’s price",
      text: "Each buy pushes a price up and each sell pulls it down. Choose “Why this price?” on any card and Gwei shows her numbers.",
    },
    {
      target: "trade",
      title: "Buy or sell",
      text: `Choose Buy or Sell on a card. You see the full cost, gas fee included, before you confirm. One trade today also completes the market quest for +${MARKET_QUEST_XP} XP.`,
    },
  ];
}

/* ------------------------------------------------------------------ seen, in this browser */

const KEY = "wgp:market-coach:v1";
const listeners = new Set<() => void>();
/** Set for this visit even when storage is blocked, so "Skip" always works. */
let seenHere = false;

function seen(): boolean {
  if (seenHere) return true;
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

/** Ends the coach for this browser. */
export function markCoachSeen() {
  if (typeof window === "undefined" || seenHere) return;
  seenHere = true;
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // Not remembered; it stays closed for this visit.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Whether this browser has finished or skipped the coach. True on the server, so it never flashes. */
export function useCoachSeen(): boolean {
  return useSyncExternalStore(subscribe, seen, () => true);
}

/* ------------------------------------------------------------------ the card */

/** The ring a coached part of the screen wears. */
export const COACH_RING = "ring-4 ring-game-gold ring-offset-2 ring-offset-game-night";

export function CoachCard({ step, index, count, onNext, onSkip }: { step: CoachStep; index: number; count: number; onNext(): void; onSkip(): void }) {
  const ref = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const last = index === count - 1;
  // Each step moves to its part of the screen: bring it into view and start readers at its title.
  useEffect(() => {
    if (index === 0) return;
    ref.current?.scrollIntoView({ block: "nearest" });
    title.current?.focus({ preventScroll: true });
  }, [index]);
  return (
    <aside
      ref={ref}
      aria-label="Market tour"
      className="wgp-rise flex scroll-mt-24 flex-col gap-3 rounded-[20px] border-2 border-game-ink bg-game-gold p-3 text-game-ink shadow-[var(--game-shadow-sm)] sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:p-3.5"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="num text-[11px] font-bold uppercase leading-4 tracking-[0.08em]">
          Market tour · step {index + 1} of {count}
        </p>
        <h2 ref={title} tabIndex={-1} className="text-[16px] font-bold leading-5 outline-none">
          {step.title}
        </h2>
        <p className="num max-w-[62ch] text-[14px] leading-5 [text-wrap:pretty]">{step.text}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {last ? null : (
          <StickerButton size="sm" onClick={onSkip} className="max-sm:flex-1">
            Skip the tour
          </StickerButton>
        )}
        <StickerButton variant="ink" size="sm" onClick={onNext} className="max-sm:flex-1">
          {last ? "Start trading" : "Next"}
        </StickerButton>
      </div>
    </aside>
  );
}
