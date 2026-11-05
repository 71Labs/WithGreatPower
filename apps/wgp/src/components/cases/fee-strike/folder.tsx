"use client";

/**
 * Case file 003's folder on the case files page (/play/cases), laid out like case 001's: the
 * folder's tab, Aunt Mainnet's "Sorry: fees" sign clipped in, the case's status, story and
 * suspect, the best time once closed, the "Fee Strike" badge's state, and the way in.
 */
import { useEffect, type ReactNode } from "react";

import { StickerLink, ON_PAPER } from "@/components/game/kit";
import { ArrowRight, FileText } from "@/components/icons";
import { CASE_003, CASE_003_ID, CASE_003_PATHS, GAS_GOBLIN } from "@/lib/cases/content-003";
import { useCase003, type Case003File } from "@/lib/cases/data-003";
import { markCaseSeen, markCaseStarted } from "@/lib/cases/local";
import { formatTicks, spokenTicks } from "@/lib/cases/view";

import { BadgeBlock, CaseTime, StatusPill } from "../shared";
import { FeeSignPoster } from "./art";

function FolderTab({ children }: { children: ReactNode }) {
  return (
    <span className="relative z-[1] -mb-[2.5px] inline-flex h-9 items-center gap-2 self-start rounded-t-[14px] border-[2.5px] border-b-0 border-game-ink bg-game-folder-2 px-4 text-[12px] font-bold uppercase leading-4 tracking-[0.1em] text-game-ink">
      {children}
    </span>
  );
}

function Actions({ file }: { file: Case003File }) {
  if (file.status === "new")
    return (
      <StickerLink href={CASE_003_PATHS.intro} variant="hero" size="lg" className="w-full sm:w-auto">
        Open the case
        <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
      </StickerLink>
    );
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
      <StickerLink href={CASE_003_PATHS.play} onClick={() => markCaseStarted(file.id)} variant="hero" size="lg" className="w-full sm:w-auto">
        {file.status === "closed" ? "Replay the case" : "Resume the case"}
        <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
      </StickerLink>
      <StickerLink href={CASE_003_PATHS.intro} size="lg" className="w-full sm:w-auto">
        <FileText aria-hidden className="size-5" strokeWidth={2.25} />
        Read the case file
      </StickerLink>
    </div>
  );
}

/** Case 003's folder, reading its own status (lib/cases/data-003.ts). */
export function FeeStrikeFolder() {
  const file = useCase003();
  // Seeing the folder is enough for the case to stop being new.
  useEffect(() => markCaseSeen(CASE_003_ID), []);
  return (
    <article aria-labelledby="case-003-title" className="flex flex-col">
      <FolderTab>
        <span className="num">Case {CASE_003.number}</span>
      </FolderTab>
      <div className={`rounded-[22px] rounded-tl-none border-[2.5px] border-game-ink bg-game-folder p-2.5 shadow-[var(--game-shadow)] sm:p-3 ${ON_PAPER}`}>
        {/* The case sheet: 22 − 10 padding → 12px corners, as case 001's. */}
        <div className="grid grid-cols-[118px_minmax(0,1fr)] gap-x-3.5 gap-y-4 rounded-[12px] border-2 border-game-ink bg-game-paper p-3.5 text-game-ink [grid-template-areas:'poster_head'_'body_body'] sm:grid-cols-[220px_minmax(0,1fr)] sm:grid-rows-[auto_1fr] sm:gap-x-6 sm:p-5 sm:[grid-template-areas:'poster_head'_'poster_body'] lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Aunt Mainnet's sign, clipped in at a tilt. */}
          <div className="relative rotate-2 self-start [grid-area:poster]">
            <span aria-hidden className="absolute -top-2 left-1/2 z-[1] h-5 w-12 -translate-x-1/2 -rotate-3 rounded-[3px] border-2 border-game-ink/30 bg-game-gold/70" />
            <div className="overflow-hidden rounded-[6px] border-2 border-game-ink shadow-[var(--game-shadow-sm)]">
              <FeeSignPoster />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2 self-center [grid-area:head] sm:self-start">
            {file.checking ? (
              <span className="inline-flex h-7 w-fit items-center rounded-full border-2 border-dashed border-game-ink/40 px-2.5 text-[12px] font-bold uppercase leading-4 tracking-[0.06em] text-game-muted">
                Checking…
              </span>
            ) : (
              <StatusPill status={file.status} className="w-fit" />
            )}
            <h2 id="case-003-title" className="font-display text-[22px] font-bold leading-6 tracking-[-0.02em] text-balance sm:text-[34px] sm:leading-9 sm:tracking-[-0.03em]">
              {CASE_003.title}
            </h2>
            <p className="text-[13px] leading-[18px] text-game-muted sm:hidden">
              {CASE_003.district} · {GAS_GOBLIN.name}
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-4 [grid-area:body]">
            <p className="max-w-[60ch] text-[15px] leading-[22px] text-pretty">{CASE_003.summary}</p>

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-y-2 border-dashed border-game-ink/25 py-3 text-[13px] leading-[18px]">
              <dt className="font-bold uppercase tracking-[0.06em] text-game-muted">Where</dt>
              <dd>{CASE_003.district}</dd>
              <dt className="font-bold uppercase tracking-[0.06em] text-game-muted">Suspect</dt>
              <dd>
                {GAS_GOBLIN.name}. <span className="text-game-muted">“{GAS_GOBLIN.tagline}”</span>
              </dd>
              <dt className="font-bold uppercase tracking-[0.06em] text-game-muted">Counts for</dt>
              <dd>Off the boards: a case is its own night.</dd>
            </dl>

            {file.status === "closed" && file.best ? <CaseTime text={formatTicks(file.best)} spoken={spokenTicks(file.best)} /> : null}

            {file.checking ? (
              <p role="status" className="flex min-h-[60px] items-center gap-2.5 rounded-[14px] border-2 border-dashed border-game-ink/40 px-3 text-[14px] font-semibold text-game-muted">
                <span aria-hidden className="size-2.5 rounded-full bg-game-ink/40 motion-safe:animate-pulse" />
                Checking the case files…
              </p>
            ) : (
              <BadgeBlock badge={file.badge} />
            )}

            <Actions file={file} />
          </div>
        </div>
      </div>
    </article>
  );
}
