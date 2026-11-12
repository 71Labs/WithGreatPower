/**
 * The /stats page: the night city behind one paper panel holding the numbers
 * (./stats-body.tsx), laid out like the invite landing. Server-safe.
 */
import Link from "next/link";

import { GameBackdrop } from "@/components/game/backdrop";
import { KitStyles, ON_PAPER, StickerPanel } from "@/components/game/kit";
import type { PublicStats } from "@/server/db/stats";

import { StatsBody } from "./stats-body";

export function StatsView({ stats }: { stats: PublicStats }) {
  return (
    <div data-wgp-night="" className="relative isolate min-h-dvh bg-game-night text-game-paper [--vs-focus:var(--game-gold)]">
      <KitStyles />
      <GameBackdrop variant="flow" />
      <main id="main" className="flex min-h-dvh flex-col items-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="flex w-full max-w-[760px] flex-col gap-5">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center self-start rounded-full text-[13px] font-bold uppercase tracking-[0.08em] text-game-paper/85 underline-offset-4 pointer-fine:hover:underline"
          >
            With Great Power
          </Link>
          <StickerPanel as="article" aria-labelledby="stats-title" className={`wgp-rise flex flex-col gap-8 p-5 sm:p-7 ${ON_PAPER}`}>
            <StatsBody stats={stats} />
          </StickerPanel>
        </div>
      </main>
    </div>
  );
}
