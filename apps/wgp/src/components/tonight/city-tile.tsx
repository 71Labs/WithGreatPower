"use client";

/**
 * Tonight's way into free roam: a paper tile for the city at your own pace, with what you've
 * found so far (tasks, Daily Rug pages, viewpoints). Any night, done or not.
 */
import Link from "next/link";

import { ON_PAPER } from "@/components/game/kit";
import { ChevronRight, Compass } from "@/components/icons";
import { cityRecord, cityTotals, TASK_IDS } from "@wgp/game-core/city";
import type { Save } from "@wgp/game-core/types";

/** The roam city's counts (rules/city.ts PAGES and the five districts' masts). */
const COUNTS = { pages: 12, views: 5 };

export function CityTile({ save, className = "" }: { save: Save; className?: string }) {
  const t = cityTotals(cityRecord(save), COUNTS);
  const fresh = !save.city;
  return (
    <Link
      href="/play/city"
      className={`relative flex w-full min-w-0 flex-row items-center gap-3 rounded-[20px] border-2 border-game-ink bg-game-paper p-2.5 pr-3 text-left text-game-ink shadow-[var(--game-shadow-sm)] ${ON_PAPER} focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none pointer-fine:hover:bg-game-paper-2 ${className}`}
    >
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[12px] border-2 border-game-ink bg-game-gold">
        <Compass className="size-6" strokeWidth={2.25} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">Free roam</span>
        <span className="truncate text-[15px] font-bold leading-5">{fresh ? "Roam the city" : "Back into the city"}</span>
      </span>
      <span className="num whitespace-nowrap text-[12px] font-semibold text-game-muted">
        {fresh ? "No timer" : `${t.tasks}/${TASK_IDS.length} tasks · ${t.pages}/${COUNTS.pages} pages`}
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
    </Link>
  );
}
