"use client";

/**
 * /play/cases, "Case files": Bearson's open cases as paper folders on the night city.
 * Case 001 is a big folder (the MISSING poster clipped in, its status, the best time once
 * closed and the "Case closed" badge's state); 002 and 003 are locked folders still in
 * his drafts. Loading keeps the folder and checks the status and badge in place; an error
 * says so above it and leaves what this browser knows on screen.
 */
import { useEffect, type ReactNode } from "react";

import { ArrowRight, CircleAlert, FileText, FolderSearch, Lock, RotateCcw } from "@/components/icons";
import { StickerButton, StickerChip, StickerLink, ON_PAPER } from "@/components/game/kit";
import { CASE_001, CASE_PATHS, LOCKED_CASES, RIGHT_CLICKER } from "@/lib/cases/content";
import { useCaseFiles, type CaseFile } from "@/lib/cases/data";
import { markCaseSeen, markCaseStarted } from "@/lib/cases/local";
import { CHAPTER_ID } from "@/lib/cases/types";
import { formatTicks, spokenTicks } from "@/lib/cases/view";

import { MissingPoster } from "./art";
import { BadgeBlock, CaseTime, StatusPill } from "./shared";

/** The folder's tab, sitting on its top edge: the case number on the folder's darker card. */
function FolderTab({ children, locked = false }: { children: ReactNode; locked?: boolean }) {
  return (
    <span
      className={`relative z-[1] -mb-[2.5px] inline-flex h-9 items-center gap-2 self-start rounded-t-[14px] border-[2.5px] border-b-0 px-4 text-[12px] font-bold uppercase leading-4 tracking-[0.1em] ${
        locked ? "border-dashed border-game-paper/50 bg-game-night text-game-paper/85" : "border-game-ink bg-game-folder-2 text-game-ink"
      }`}
    >
      {children}
    </span>
  );
}

function CaseActions({ file }: { file: CaseFile }) {
  if (file.status === "new")
    return (
      <StickerLink href={CASE_PATHS.intro} variant="hero" size="lg" className="w-full sm:w-auto">
        Open the case
        <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
      </StickerLink>
    );
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
      <StickerLink href={CASE_PATHS.play} onClick={() => markCaseStarted(file.id)} variant="hero" size="lg" className="w-full sm:w-auto">
        {file.status === "closed" ? "Replay the case" : "Resume the case"}
        <ArrowRight aria-hidden className="size-5" strokeWidth={2.25} />
      </StickerLink>
      <StickerLink href={CASE_PATHS.intro} size="lg" className="w-full sm:w-auto">
        <FileText aria-hidden className="size-5" strokeWidth={2.25} />
        Read the case file
      </StickerLink>
    </div>
  );
}

function CaseFolder({ file, checking }: { file: CaseFile; checking: boolean }) {
  return (
    <article aria-labelledby="case-001-title" className="flex flex-col">
      <FolderTab>
        <span className="num">Case 001</span>
      </FolderTab>
      <div className={`rounded-[22px] rounded-tl-none border-[2.5px] border-game-ink bg-game-folder p-2.5 shadow-[var(--game-shadow)] sm:p-3 ${ON_PAPER}`}>
        {/* The case sheet, paper inside the folder: 22 − 10 padding → 12px corners. One title, placed by grid areas: beside the poster on a phone, over the story beside it wider. */}
        <div className="grid grid-cols-[118px_minmax(0,1fr)] gap-x-3.5 gap-y-4 rounded-[12px] border-2 border-game-ink bg-game-paper p-3.5 text-game-ink [grid-template-areas:'poster_head'_'body_body'] sm:grid-cols-[220px_minmax(0,1fr)] sm:grid-rows-[auto_1fr] sm:gap-x-6 sm:p-5 sm:[grid-template-areas:'poster_head'_'poster_body'] lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* The poster, clipped in at a tilt. */}
          <div className="relative -rotate-2 self-start [grid-area:poster]">
            <span aria-hidden className="absolute -top-2 left-1/2 z-[1] h-5 w-12 -translate-x-1/2 rotate-3 rounded-[3px] border-2 border-game-ink/30 bg-game-gold/70" />
            <div className="overflow-hidden rounded-[6px] border-2 border-game-ink shadow-[var(--game-shadow-sm)]">
              <MissingPoster sizes="(min-width: 1024px) 260px, (min-width: 640px) 220px, 118px" />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2 self-center [grid-area:head] sm:self-start">
            <Status file={file} checking={checking} />
            <h2 id="case-001-title" className="font-display text-[22px] font-bold leading-6 tracking-[-0.02em] text-balance sm:text-[34px] sm:leading-9 sm:tracking-[-0.03em]">
              {CASE_001.title}
            </h2>
            <p className="text-[13px] leading-[18px] text-game-muted sm:hidden">
              {CASE_001.district} · {RIGHT_CLICKER.name}
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-4 [grid-area:body]">
            <p className="max-w-[60ch] text-[15px] leading-[22px] text-pretty">{CASE_001.summary}</p>

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-y-2 border-dashed border-game-ink/25 py-3 text-[13px] leading-[18px]">
              <dt className="font-bold uppercase tracking-[0.06em] text-game-muted">Where</dt>
              <dd>{CASE_001.district}</dd>
              <dt className="font-bold uppercase tracking-[0.06em] text-game-muted">Suspect</dt>
              <dd>
                {RIGHT_CLICKER.name}. <span className="text-game-muted">“{RIGHT_CLICKER.tagline}”</span>
              </dd>
              <dt className="font-bold uppercase tracking-[0.06em] text-game-muted">Counts for</dt>
              <dd>Off the boards: a case is its own night.</dd>
            </dl>

            {file.status === "closed" && file.best ? <CaseTime text={formatTicks(file.best)} spoken={spokenTicks(file.best)} /> : null}

            {checking ? (
              <p role="status" className="flex min-h-[60px] items-center gap-2.5 rounded-[14px] border-2 border-dashed border-game-ink/40 px-3 text-[14px] font-semibold text-game-muted">
                <span aria-hidden className="size-2.5 rounded-full bg-game-ink/40 motion-safe:animate-pulse" />
                Checking the case files…
              </p>
            ) : (
              <BadgeBlock badge={file.badge} />
            )}

            <CaseActions file={file} />
          </div>
        </div>
      </div>
    </article>
  );
}

function Status({ file, checking }: { file: CaseFile; checking: boolean }) {
  if (checking)
    return (
      <span className="inline-flex h-7 w-fit items-center rounded-full border-2 border-dashed border-game-ink/40 px-2.5 text-[12px] font-bold uppercase leading-4 tracking-[0.06em] text-game-muted">
        Checking…
      </span>
    );
  return <StatusPill status={file.status} className="w-fit" />;
}

function LockedFolder({ number, line }: { number: string; line: string }) {
  return (
    <li className="flex min-w-0 flex-col">
      <FolderTab locked>
        <Lock aria-hidden className="size-3.5" strokeWidth={2.5} />
        <span className="num">Case {number}</span>
        <span className="sr-only">, locked.</span>
      </FolderTab>
      <div className="flex min-h-[104px] flex-1 flex-col justify-center gap-1 rounded-[20px] rounded-tl-none border-[2.5px] border-dashed border-game-paper/50 bg-game-night px-4 py-3.5">
        <p aria-hidden className="font-display text-[26px] font-bold leading-7 tracking-[0.06em] text-game-paper/85">???</p>
        <p className="text-[14px] leading-5 text-game-paper/85">{line}</p>
      </div>
    </li>
  );
}

function ErrorNotice({ onRetry }: { onRetry(): void }) {
  return (
    <div role="alert" className={`flex flex-col gap-3 rounded-[18px] border-[2.5px] border-game-ink bg-game-paper p-3.5 text-game-ink shadow-[var(--game-shadow-sm)] sm:flex-row sm:items-center sm:justify-between ${ON_PAPER}`}>
      <p className="flex items-start gap-2.5 text-[14px] leading-5">
        <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-game-hero" strokeWidth={2.25} />
        <span>
          <span className="font-bold">Couldn’t reach the case files.</span> What this browser knows is below; your clears are safe on the server.
        </span>
      </p>
      <StickerButton size="sm" onClick={onRetry} className="self-start sm:self-auto">
        <RotateCcw aria-hidden className="size-4" strokeWidth={2.25} />
        Try again
      </StickerButton>
    </div>
  );
}

function EmptyCases() {
  return (
    <div className={`flex flex-col items-center gap-3 rounded-[22px] border-[2.5px] border-game-ink bg-game-paper px-5 py-8 text-center text-game-ink shadow-[var(--game-shadow)] ${ON_PAPER}`}>
      <FolderSearch aria-hidden className="size-10" strokeWidth={1.75} />
      <h2 className="text-[20px] font-bold leading-6 tracking-[-0.02em]">No open cases tonight</h2>
      <p className="max-w-[36ch] text-[14px] leading-5 text-game-muted">Bearson is between scandals. Swing out, and the next case file lands here.</p>
      <StickerLink href="/play" variant="hero">
        Back to tonight
      </StickerLink>
    </div>
  );
}

export function CaseFiles() {
  const files = useCaseFiles();
  const file = files.cases[0] ?? null;
  // Opening the files is enough for the dock to stop calling the case new.
  useEffect(() => markCaseSeen(CHAPTER_ID), []);
  return (
    <div className="wgp-rise mx-auto flex w-full max-w-[520px] flex-col gap-6 px-4 pb-4 sm:max-w-[760px] lg:max-w-[980px] lg:px-8">
      <header className="flex flex-col items-center gap-2 text-center">
        <StickerChip>
          <FolderSearch aria-hidden className="size-4" strokeWidth={2.25} />
          From Bearson’s desk
        </StickerChip>
        <h1 className="font-display text-[34px] font-semibold leading-9 tracking-[-0.03em] text-game-paper [text-shadow:0_2px_0_var(--game-ink)] sm:text-[44px] sm:leading-[46px]">Case files</h1>
        <p className="max-w-[40ch] text-[14px] leading-5 text-game-paper/80 sm:text-[15px] sm:leading-[22px]">
          Special nights from The Daily Rug. One mystery each, played off the boards.
        </p>
      </header>

      {files.failed ? <ErrorNotice onRetry={files.retry} /> : null}
      {file ? <CaseFolder file={file} checking={files.loading && files.signedIn} /> : <EmptyCases />}

      <section aria-labelledby="locked-title" className="flex flex-col gap-3">
        <h2 id="locked-title" className="flex items-center gap-2 text-[12px] font-bold uppercase leading-4 tracking-[0.1em] text-game-paper/80">
          <span aria-hidden className="h-[3px] w-4 rounded-full bg-game-hero" />
          Still in Bearson’s drafts
        </h2>
        <ul className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
          {LOCKED_CASES.map((c) => (
            <LockedFolder key={c.number} number={c.number} line={c.line} />
          ))}
        </ul>
      </section>
    </div>
  );
}
