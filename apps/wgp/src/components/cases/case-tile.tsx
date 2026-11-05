"use client";

/**
 * Tonight's way into the case files: a folder-coloured tile with the MISSING poster, the
 * case's name and where it stands ("New" until it's opened, then its status). Once case 001
 * is closed and case 003 isn't, it shows case 003 instead (Aunt Mainnet's "Sorry: fees" sign).
 */
import Link from "next/link";

import { ON_PAPER, StickerBadge } from "@/components/game/kit";
import { ChevronRight } from "@/components/icons";
import { CASE_001, CASE_PATHS } from "@/lib/cases/content";
import { useCaseMarks, useNewCase } from "@/lib/cases/local";
import { CHAPTER_ID } from "@/lib/cases/types";
import { caseStatus, STATUS_LABEL } from "@/lib/cases/view";
import type { Save } from "@wgp/game-core/types";

import { MissingPoster } from "./art";
import { FeeSignPoster } from "./fee-strike/art";
import { CASE_003, CASE_003_ID } from "@/lib/cases/content-003";

export function CaseTile({ save, className = "" }: { save: Save; className?: string }) {
  const marks = useCaseMarks();
  const first = caseStatus({ saved: save.cases?.[CHAPTER_ID] ?? null, local: marks.cases[CHAPTER_ID] ?? null });
  const third = caseStatus({ saved: save.cases?.[CASE_003_ID] ?? null, local: marks.cases[CASE_003_ID] ?? null });
  // The newest case still open: 003 once 001 is closed.
  const next = first === "closed" && third !== "closed";
  const fresh001 = useNewCase(save);
  const fresh003 = useNewCase(save, CASE_003_ID);
  const fresh = next ? fresh003 : fresh001;
  const status = next ? third : first;
  const number = next ? CASE_003.number : CASE_001.number;
  const title = next ? CASE_003.title : CASE_001.title;
  return (
    <Link
      href={CASE_PATHS.list}
      className={`relative flex w-full min-w-0 flex-row items-center gap-3 rounded-[20px] border-2 border-game-ink bg-game-folder p-2.5 pr-3 text-left text-game-ink shadow-[var(--game-shadow-sm)] ${ON_PAPER} focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 motion-safe:ease-out active:translate-y-[2px] active:shadow-none pointer-fine:hover:bg-game-folder-2 ${className}`}
    >
      <span className="relative shrink-0">
        <span className="block w-11 -rotate-3 overflow-hidden rounded-[4px] border-2 border-game-ink">
          {next ? <FeeSignPoster label="" /> : <MissingPoster alt="" sizes="44px" />}
        </span>
        {fresh ? <StickerBadge className="absolute -left-2 -top-2">New</StickerBadge> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
          Case files<span aria-hidden> · </span>
          <span className="sr-only">, </span>
          <span className="num">{number}</span>
          {fresh ? <span className="sr-only">, new</span> : <span className="sr-only">, {STATUS_LABEL[status].toLowerCase()}</span>}
        </span>
        <span className="truncate text-[15px] font-bold leading-5">{title}</span>
      </span>
      {fresh ? null : (
        <span aria-hidden className="whitespace-nowrap text-[12px] font-semibold text-game-muted">
          {STATUS_LABEL[status]}
        </span>
      )}
      <ChevronRight aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
    </Link>
  );
}
