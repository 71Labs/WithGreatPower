"use client";

/**
 * PLACEHOLDER (the gameplay build): the end of a story chapter's night, until the UI build's
 * "Case closed" ending replaces it. It only says what counted, from the NightOutcome
 * (game3d/session/night.ts, kind "case"): closed or not, the time, whether the server filed
 * it, and where the badge is. The patrol's results sheet can't draw a chapter (it has no
 * patrol), so NightResults hands chapters here.
 */
import { CHAPTERS } from "@wgp/game-core/chapters";
import type { ChapterId } from "@wgp/game-core/types";

import { StickerButton, StickerLink } from "@/components/game/kit";
import type { NightOutcome } from "@/game3d/session";

import type { Ending } from "./night-results";

/** Ticks as m:ss. */
const clock = (ticks: number) => {
  const s = Math.floor(ticks / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Lines({ outcome }: { outcome: NightOutcome }) {
  if (outcome.kind === "case") {
    const best = outcome.record.bestTicks;
    return (
      <>
        <p className="text-[15px] leading-[22px] text-pretty">
          {outcome.cleared ? `${CHAPTERS[outcome.chapter].captive.name} is back to full quality.` : "The Right-Clicker got away this time. The case stays open."}
        </p>
        <p className="text-[14px] leading-5">
          Time <span className="num font-semibold">{clock(outcome.ticks)}</span>
          {best !== null ? (
            <>
              {" "}
              · best <span className="num font-semibold">{clock(best)}</span>
            </>
          ) : null}
        </p>
        <p className="text-[14px] leading-5 text-game-muted text-pretty">
          {outcome.filed === "verified"
            ? outcome.badge?.status === "minted"
              ? "Filed with the server. Your badge is on chain."
              : outcome.badge?.status === "queued"
                ? "Filed with the server. Your badge is on its way."
                : "Filed with the server."
            : outcome.filed === "local"
              ? "Kept in this browser. Sign in to file the case and earn its badge."
              : "Played off the server, so nothing was saved."}
        </p>
      </>
    );
  }
  if (outcome.kind === "rejected") return <p className="text-[14px] leading-5 text-pretty">The server couldn’t verify this case ({outcome.reason}). Nothing was filed; you can play it again.</p>;
  if (outcome.kind === "submit-failed") return <p className="text-[14px] leading-5 text-pretty">{outcome.message} Your case is kept on this device, so you can send it again.</p>;
  return <p className="text-[14px] leading-5">The case is over.</p>;
}

export function CaseResults({ chapter, ending, onRetry }: { chapter: ChapterId; ending: Ending; onRetry(): void }) {
  const o = ending.kind === "done" ? ending.outcome : null;
  const title = !o ? "Checking your case…" : o.kind === "case" && o.cleared ? "Case closed" : "Case still open";
  return (
    <div className="absolute inset-0 grid place-items-center overflow-y-auto p-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-game-night/55" />
      <section className="relative flex w-full max-w-[440px] flex-col gap-4 rounded-[20px] border-[3px] border-game-ink bg-game-paper p-5 text-game-ink shadow-[var(--game-shadow)]">
        <div className="flex flex-col gap-1">
          <p className="text-[12px] font-semibold leading-4 text-game-muted">Case file {CHAPTERS[chapter].number}</p>
          <h2 id="results-title" tabIndex={-1} className="text-[24px] font-bold leading-8 [text-wrap:balance] focus-visible:outline-offset-4">
            {title}
          </h2>
        </div>
        <div role="status" className="flex flex-col gap-2">
          {o ? <Lines outcome={o} /> : <p className="text-[14px] leading-5 text-game-muted">It replays every input you made.</p>}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {o?.kind === "submit-failed" ? (
            <StickerButton variant="hero" size="md" onClick={onRetry} className="w-full sm:w-auto">
              Send it again
            </StickerButton>
          ) : null}
          {o?.kind === "case" && o.filed === "local" ? (
            <StickerButton variant="ink" size="md" onClick={() => window.dispatchEvent(new CustomEvent("wgp:sign-in"))} className="w-full sm:w-auto">
              Sign in to file the case
            </StickerButton>
          ) : null}
          {o && o.kind !== "submit-failed" ? (
            // This page is the case's (/play/patrol?case=001): loaded again, the night boots from the URL.
            <StickerButton variant="paper" size="md" onClick={() => window.location.reload()} className="w-full sm:w-auto">
              Play the case again
            </StickerButton>
          ) : null}
          <StickerLink href="/play" size="md" className="w-full sm:w-auto">
            Back to tonight
          </StickerLink>
        </div>
      </section>
    </div>
  );
}
