"use client";

/**
 * Tonight's wanted list: the items Gwei Stacy is short on today (src/lib/market/wanted.ts),
 * each with the multiplier a verified night gets on that item's drop. The list is frozen
 * for the UTC day, so what the player reads before swinging out is what the night pays.
 * Read once per visit; until it answers (or if it can't) the tile stays away.
 */
import Link from "next/link";
import { createElement, useEffect, useState } from "react";

import { AVATARS } from "@/components/cast";
import { ON_PAPER } from "@/components/game/kit";
import { ChevronRight } from "@/components/icons";
import { getWanted, wantedChip, wantedDetail, wantedLine, wantedWhy, type WantedBonus, type WantedDay } from "@/lib/market/wanted";

/** The tile's sub-line: what the list does, or why it's empty. Pure. */
export function wantedMeta(list: WantedDay): string {
  if (list.items.length === 0) return "Nothing short today. Her stalls are stocked, so no bonus tonight.";
  return "A verified night multiplies these drops. Sell her the extra and her prices come down.";
}

/** The tile, from today's list. Server-safe, so it can be tested without a browser. */
export function WantedTileView({ list, className = "" }: { list: WantedDay; className?: string }) {
  return (
    <Link
      href="/play/market"
      className={`relative flex w-full min-w-0 flex-row items-center gap-3 rounded-[20px] border-2 border-game-ink bg-game-paper p-2.5 pr-3 text-left text-game-ink shadow-[var(--game-shadow-sm)] ${ON_PAPER} focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none pointer-fine:hover:bg-game-paper-2 ${className}`}
    >
      <span aria-hidden className="block size-11 shrink-0 self-start overflow-hidden rounded-[10px] border-2 border-game-ink bg-game-paper-2 [&>svg]:size-full">
        {createElement(AVATARS.gwei)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">Gwei’s wanted list</span>
        {list.items.length > 0 ? (
          <span role="list" aria-label="Wanted today" className="flex flex-wrap gap-1.5">
            {list.items.map((w) => (
              <span
                key={w.item}
                role="listitem"
                title={wantedWhy(w)}
                className={`num inline-flex h-7 items-center whitespace-nowrap rounded-full border-2 border-game-ink px-2.5 text-[13px] font-bold leading-4 ${w.reason === "sold-out" ? "bg-game-hero text-game-paper" : "bg-game-gold text-game-ink"}`}
              >
                {wantedChip(w)}
                <span className="sr-only">: {wantedWhy(w)}</span>
              </span>
            ))}
          </span>
        ) : null}
        <span className="text-[12px] font-medium leading-4 text-game-muted [text-wrap:pretty]">{wantedMeta(list)}</span>
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
    </Link>
  );
}

/**
 * On a verified night's results: each wanted item the night brought, the multiplier and the
 * total minted ("Gwei wanted crumbs: ×2 → you brought 6"). Nothing when it brought none.
 */
export function WantedHaul({ wanted }: { wanted: WantedBonus[] }) {
  if (wanted.length === 0) return null;
  return (
    <ul aria-label="Gwei’s wanted list" className="flex flex-col gap-2 rounded-[12px] border-2 border-game-ink bg-game-paper-2 px-3 py-2.5">
      {wanted.map((b) => (
        <li key={b.item} className="flex items-start gap-2.5">
          <span aria-hidden className="mt-px block size-8 shrink-0 overflow-hidden rounded-[8px] border-2 border-game-ink bg-game-paper [&>svg]:size-full">
            {createElement(AVATARS.gwei)}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="num text-[14px] font-bold leading-5 [overflow-wrap:anywhere]">{wantedLine(b)}</span>
            <span className="num text-[12px] font-medium leading-4 text-game-muted [text-wrap:pretty]">{wantedDetail(b)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function WantedTile({ className }: { className?: string }) {
  const [list, setList] = useState<WantedDay | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    getWanted(ctrl.signal).then(
      (l) => {
        if (!ctrl.signal.aborted) setList(l);
      },
      () => {},
    );
    return () => ctrl.abort();
  }, []);
  return list ? <WantedTileView list={list} className={className} /> : null;
}
