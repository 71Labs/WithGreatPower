"use client";

/**
 * The ways into "Invite friends" (/play/invite): a paper tile for Tonight and the Hero
 * page ("Invite friends · 1/3"), and a row in the account sheet. Each reads the shared
 * referrals store, so they cost one request between them. (The dock is full: no tab.)
 */
import Link from "next/link";

import { ON_PAPER, stickerTileClass } from "@/components/game/kit";
import { ChevronRight, Users } from "@/components/icons";
import { useReferrals } from "@/lib/referrals/store";
import { inviteSummary, type InviteSummary } from "@/lib/referrals/view";

export const INVITE_PATH = "/play/invite";

function Count({ summary }: { summary: InviteSummary }) {
  if (!summary.count) return null;
  return (
    <span className="num whitespace-nowrap text-[13px] font-bold text-game-ink">
      <span aria-hidden>{summary.count}</span>
      <span className="sr-only">{summary.spoken}</span>
    </span>
  );
}

/** Presentational, for tests and fixtures. */
export function InviteTileView({ summary, className = "" }: { summary: InviteSummary; className?: string }) {
  return (
    <Link href={INVITE_PATH} className={`${stickerTileClass} w-full flex-row items-center gap-3 p-2.5 pr-3 ${className}`}>
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[12px] border-2 border-game-ink bg-game-mint text-game-paper">
        <Users className="size-6" strokeWidth={2.25} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">Invite friends</span>
        <span className="truncate text-[15px] font-bold leading-5">{summary.line}</span>
      </span>
      <Count summary={summary} />
      <ChevronRight aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
    </Link>
  );
}

/** Tonight's and the Hero page's tile. */
export function InviteTile({ className = "" }: { className?: string }) {
  return <InviteTileView summary={inviteSummary(useReferrals())} className={className} />;
}

/** The account sheet's row (signed in). Following it closes the sheet. */
export function InviteRow({ onNavigate }: { onNavigate?: () => void }) {
  const summary = inviteSummary(useReferrals());
  return (
    <Link
      href={INVITE_PATH}
      onClick={onNavigate}
      className={`flex min-h-14 items-center gap-3 rounded-[16px] border-2 border-game-ink bg-game-paper-2 px-4 py-3 text-game-ink ${ON_PAPER} focus-visible:outline-offset-2 pointer-fine:hover:bg-game-paper`}
    >
      <Users aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold leading-5">Invite friends</span>
        <span className="truncate text-[13px] leading-5 text-game-muted">{summary.line}</span>
      </span>
      <Count summary={summary} />
      <ChevronRight aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
    </Link>
  );
}
