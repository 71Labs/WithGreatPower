"use client";

/**
 * The end of a case night: "Case closed." over the city, with The Daily Rug's front page
 * ("JPEG found. Slightly more compressed.", by J. Jonah Bearson), the time, the "Case
 * closed" badge's state, "Share on X" and the way back to the case files. A guest's clear
 * is kept in this browser with a way to sign in; a night that didn't close the case says
 * the case is still open.
 */
import { useEffect, useState } from "react";

import { StickerButton, StickerEyebrow, StickerLink, StickerPanel, stickerButtonClass } from "@/components/game/kit";
import { ArrowLeft, CircleAlert, RotateCcw } from "@/components/icons";
import { ShareOnX } from "@/components/social/share-on-x";
import { getCases } from "@/lib/api/client";
import { CASE_001, CASE_PATHS, caseShareText } from "@/lib/cases/content";
import { markCaseCleared } from "@/lib/cases/local";
import { CHAPTER_ID } from "@/lib/cases/types";
import { badgeView, formatTicks, spokenTicks, type BadgeView } from "@/lib/cases/view";

import { MaryPhoto } from "./art";
import { BadgeBlock, CaseStamp, RugFront } from "./shared";

/** Where the clear stands with the server. */
export type CaseFiling =
  /** Being checked. */
  | { kind: "filing" }
  /** Verified and filed; the badge as the server has it (asked for here when not given). */
  | { kind: "filed"; badge?: BadgeView }
  /** A guest: kept in this browser. */
  | { kind: "guest" }
  /** Played but not filed: the replay disagreed, or it was played off the record. */
  | { kind: "not-filed"; reason: string }
  /** Couldn't reach the server; the run is kept, so it can be sent again. */
  | { kind: "failed"; message: string };

export interface CaseClosedProps {
  heroName: string;
  closed: boolean;
  ticks: number | null;
  filing: CaseFiling;
  /** The latest edition once the night is banked: the Rug leads with the case until a newer one. */
  edition: number;
  onRetry(): void;
  /** Keep the clear in this browser (off for previews). */
  record?: boolean;
}

/** The badge after a verified clear: asked of the server once (the mint is usually still queued). */
function useFiledBadge(filing: CaseFiling): BadgeView | null {
  const given = filing.kind === "filed" ? (filing.badge ?? null) : null;
  const ask = filing.kind === "filed" && !filing.badge;
  const [asked, setAsked] = useState<BadgeView | null>(null);
  useEffect(() => {
    if (!ask) return;
    const ctrl = new AbortController();
    getCases(ctrl.signal).then(
      (res) => {
        const rec = res.ok ? res.data.cases?.find((c) => c.id === CHAPTER_ID) : null;
        setAsked(badgeView({ signedIn: true, status: "closed", badge: rec?.badge ?? null, failed: !res.ok }));
      },
      () => {},
    );
    return () => ctrl.abort();
  }, [ask]);
  return given ?? asked;
}

function Filing({ filing, badge, onRetry }: { filing: CaseFiling; badge: BadgeView | null; onRetry(): void }) {
  switch (filing.kind) {
    case "filing":
      return (
        <p role="status" className="flex min-h-[60px] items-center gap-2.5 rounded-[14px] border-2 border-dashed border-game-ink/40 px-3 text-[14px] font-semibold text-game-muted">
          <span aria-hidden className="size-2.5 rounded-full bg-game-ink/40 motion-safe:animate-pulse" />
          Filing the case with the server…
        </p>
      );
    case "filed":
      return badge ? (
        <BadgeBlock badge={badge} />
      ) : (
        <p role="status" className="flex min-h-[60px] items-center gap-2.5 rounded-[14px] border-2 border-dashed border-game-ink/40 px-3 text-[14px] font-semibold text-game-muted">
          <span aria-hidden className="size-2.5 rounded-full bg-game-ink/40 motion-safe:animate-pulse" />
          Checking the badge…
        </p>
      );
    case "guest":
      return <BadgeBlock badge={badgeView({ signedIn: false, status: "closed" })} />;
    case "not-filed":
      return (
        <div className="flex items-start gap-2.5 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3 py-2.5">
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-game-hero" strokeWidth={2.25} />
          <p className="text-[14px] leading-5">
            <span className="font-bold">Not filed.</span> {filing.reason}
          </p>
        </div>
      );
    case "failed":
      return (
        <div role="alert" className="flex flex-col gap-2.5 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3 py-2.5">
          <p className="flex items-start gap-2.5 text-[14px] leading-5">
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-game-hero" strokeWidth={2.25} />
            <span>
              <span className="font-bold">Couldn’t file the case.</span> {filing.message} The night is kept on this device, so you can send it again.
            </span>
          </p>
          <StickerButton variant="hero" size="sm" onClick={onRetry} className="self-start">
            <RotateCcw aria-hidden className="size-4" strokeWidth={2.25} />
            Send it again
          </StickerButton>
        </div>
      );
  }
}

export function CaseClosed({ heroName, closed, ticks, filing, edition, onRetry, record = true }: CaseClosedProps) {
  const badge = useFiledBadge(filing);
  const kept = record && closed && (filing.kind === "filed" || filing.kind === "guest");

  // The results take over from the game: start keyboard and screen-reader users at the title.
  useEffect(() => {
    document.getElementById("results-title")?.focus({ preventScroll: true });
  }, []);

  // A kept clear: its time here, and the Rug's next front page.
  useEffect(() => {
    if (kept) markCaseCleared(CHAPTER_ID, { ticks, edition, hero: heroName, keep: true });
  }, [kept, ticks, edition, heroName]);

  return (
    <div className="absolute inset-0 overflow-y-auto overscroll-contain">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-game-night/60" />
      <div className="relative mx-auto flex min-h-full w-full max-w-[780px] flex-col justify-center px-3 py-6 sm:px-6 sm:py-10">
        <StickerPanel as="section" aria-labelledby="results-title" className="wgp-rise flex flex-col gap-5 p-4 sm:gap-6 sm:p-6">
          <header className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <StickerEyebrow>
                <span>
                  Case file <span className="num">{CASE_001.number}</span> · {CASE_001.title}
                </span>
              </StickerEyebrow>
              <h1 id="results-title" tabIndex={-1} className="text-[30px] font-bold leading-8 tracking-[-0.025em] text-game-ink outline-none sm:text-[38px] sm:leading-[42px]">
                {closed ? "Case closed." : "The case is still open."}
              </h1>
              <p className="text-[14px] leading-5 text-game-muted text-pretty">
                {closed ? "Mary’s back, and Bearson already has the front page." : "Mary’s still in the Downloads folder. Bearson is holding the front page."}
              </p>
            </div>
            {closed ? (
              <span className="mr-1 mt-2 hidden shrink-0 sm:block">
                <CaseStamp number={CASE_001.number} />
              </span>
            ) : null}
          </header>

          {closed ? (
            <article aria-labelledby="case-front-headline" className="rounded-[16px] border-[2.5px] border-game-ink bg-game-paper p-3.5 shadow-[var(--game-shadow-sm)] sm:p-5">
              <RugFront
                headingLevel="h2"
                headingId="case-front-headline"
                headline={CASE_001.found.headline}
                dateline={["Extra edition", "Bridge District"]}
                photo={<MaryPhoto restored alt="Mary Jpeg on a rooftop, waving, in full quality." />}
                caption={CASE_001.found.caption}
                dek={CASE_001.found.dek}
                story={CASE_001.found.story(heroName)}
                byline="By J. Jonah Bearson, who had it first"
              />
            </article>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start sm:gap-4">
            {closed && ticks ? (
              <div className="flex flex-col gap-1 rounded-[14px] border-2 border-game-ink bg-game-paper px-3.5 py-2.5 sm:min-w-[160px]">
                <p className="text-[12px] font-semibold leading-4 text-game-muted">Your time</p>
                <p className="num text-[32px] font-bold leading-9 tracking-[-0.02em]" aria-hidden>
                  {formatTicks(ticks)}
                </p>
                <p className="sr-only">{spokenTicks(ticks)}</p>
                <p className="text-[12px] leading-4 text-game-muted">Off the boards: kept in the case file.</p>
              </div>
            ) : null}
            {closed ? <Filing filing={filing} badge={badge} onRetry={onRetry} /> : null}
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
            {closed ? (
              <>
                <StickerLink href={CASE_PATHS.list} variant={filing.kind === "failed" ? "paper" : "hero"} size="lg" className="w-full sm:w-auto">
                  <ArrowLeft aria-hidden className="size-5" strokeWidth={2.25} />
                  Back to case files
                </StickerLink>
                <ShareOnX text={caseShareText()} size="lg" className="w-full sm:w-auto" />
              </>
            ) : (
              <>
                {/* A full load: the patrol page starts the case again from the top. */}
                <a href={CASE_PATHS.play} className={stickerButtonClass("hero", "lg", "w-full sm:w-auto")}>
                  <RotateCcw aria-hidden className="size-5" strokeWidth={2.25} />
                  Try the case again
                </a>
                <StickerLink href={CASE_PATHS.list} size="lg" className="w-full sm:w-auto">
                  Back to case files
                </StickerLink>
              </>
            )}
          </div>
        </StickerPanel>
      </div>
    </div>
  );
}
