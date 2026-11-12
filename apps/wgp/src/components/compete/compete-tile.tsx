"use client";

/**
 * Tonight's way into Compete: today's Daily Run in one line (your best and rank, or that it's
 * waiting) and your streak. It reads the hub once; until then (or offline) it simply points
 * at today's Daily.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import { ON_PAPER, StickerBadge } from "@/components/game/kit";
import { ChevronRight, Flame, Zap } from "@/components/icons";
import { useAccount } from "@/game/store";
import { getCompete, type CompeteView } from "@/lib/compete/api";
import { formatScore } from "@/lib/compete/format";

export function CompeteTile({ className = "" }: { className?: string }) {
  const account = useAccount();
  const [view, setView] = useState<CompeteView | null>(null);
  const key = account.status === "signed-in" ? account.me.player.id : account.status;
  useEffect(() => {
    if (key === "loading") return;
    const ctrl = new AbortController();
    getCompete(ctrl.signal).then(
      (res) => setView(res.ok ? res.data : null),
      () => {},
    );
    return () => ctrl.abort();
  }, [key]);
  const d = view?.daily ?? null;
  const fresh = !!view?.signedIn && !d?.best && (d?.attempts.used ?? 0) === 0;
  const line = d?.best ? `Your best ${formatScore(d.best.score)}${d.best.rank ? `, #${d.best.rank} of ${d.total}` : ""}` : d && d.total > 0 ? `${d.total} ${d.total === 1 ? "runner" : "runners"} today. Beat them` : "Same city for everyone today";
  return (
    <Link
      href="/play/compete"
      className={`relative flex w-full min-w-0 flex-row items-center gap-3 rounded-[20px] border-2 border-game-ink bg-game-paper p-2.5 pr-3 text-left text-game-ink shadow-[var(--game-shadow-sm)] ${ON_PAPER} focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none pointer-fine:hover:bg-game-paper-2 ${className}`}
    >
      <span className="relative shrink-0">
        <span aria-hidden className="grid size-11 place-items-center rounded-[10px] border-2 border-game-ink bg-[#8fe7ff]">
          <Zap className="size-5" strokeWidth={2.25} />
        </span>
        {fresh ? <StickerBadge className="absolute -left-2 -top-2">New</StickerBadge> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
          Compete<span aria-hidden> · </span>
          <span className="sr-only">, </span>Daily Run{fresh ? <span className="sr-only">, not run yet today</span> : null}
        </span>
        <span className="num line-clamp-2 text-[15px] font-bold leading-5">{line}</span>
      </span>
      {d && d.streak > 0 ? (
        <span className="num inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold text-game-muted">
          <Flame aria-hidden className="size-4" strokeWidth={2.25} />
          {d.streak}
          <span className="sr-only"> day streak</span>
        </span>
      ) : null}
      <ChevronRight aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
    </Link>
  );
}
