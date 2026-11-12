"use client";

/**
 * The end of a race, over the still-running city: the result (a trial's time and medal, a
 * Daily's or a duel's score and time), how it went against the ghost you chased, where it
 * landed on its board (the server's word, never the browser's), and the ways on: race again,
 * share it, or send a challenge link.
 */
import { useEffect, type ReactNode } from "react";

import { COURSES, type Medal } from "@wgp/game-core/compete";
import type { TrialCourseId } from "@wgp/game-core/types";

import { StickerButton, StickerChip, StickerLink, StickerPanel } from "@/components/game/kit";
import { BadgeCheck, CircleAlert, Flame, Medal as MedalIcon, RotateCcw } from "@/components/icons";
import { ShareOnX } from "@/components/social/share-on-x";
import type { RaceGhost } from "@/game3d/compete/race";
import { beatGhost, type RaceEnding, type RaceResult, type RaceSession } from "@/game3d/session/compete";
import { dayLabel, formatScore, MEDAL_FILL, medalLabel, nextMedal, raceClock, raceGap } from "@/lib/compete/format";
import { raceShareText } from "@/lib/compete/share";

import { noun } from "@/lib/plural";

import { CopyRaceLink } from "./race-link";

const REASONS: Record<string, string> = {
  hash_mismatch: "The server’s replay of your inputs ended somewhere different from your game.",
  faster_than_wall_clock: "The race ran faster than real time.",
  too_short: "The race was too short to count.",
  run_expired: "The race took longer than the 45 minutes a run has.",
  ruleset_mismatch: "The game was updated during your race.",
  already_submitted: "This race was already sent with different inputs.",
};

export type RaceEnd = { kind: "submitting" } | RaceResult;

function eyebrow(s: RaceSession): string {
  if (s.race.kind === "daily") return `Daily Run · ${dayLabel(s.race.course)}`;
  if (s.race.kind === "trial") {
    const c = COURSES[s.race.course as TrialCourseId];
    return `Time trial ${c.number} · ${c.name}`;
  }
  return "Duel";
}

function MedalChip({ medal }: { medal: Medal | null }) {
  return (
    <span className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-game-ink px-3 text-[13px] font-bold text-game-ink shadow-[var(--game-shadow-sm)] ${medal ? MEDAL_FILL[medal] : "bg-game-paper-2"}`}>
      <MedalIcon aria-hidden className="size-4" strokeWidth={2.25} />
      {medalLabel(medal)}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-[12px] font-semibold leading-4 text-game-muted">{label}</p>
      <p className="num text-[30px] font-bold leading-9 tracking-[-0.02em]">{value}</p>
      {sub ? <p className="text-[13px] leading-[18px] text-game-muted">{sub}</p> : null}
    </div>
  );
}

/** You against the ghost you chased: both results side by side and who took it. */
function Versus({ kind, mine, ghost, won }: { kind: RaceSession["race"]["kind"]; mine: RaceEnding; ghost: { label: string; handle: string; score: number; ticks: number; finished: boolean; css?: string }; won: boolean }) {
  const trial = kind === "trial";
  // How much in it: a trial by time; a patrol night by score, or by time on the same score.
  const secs = (ticks: number) => raceGap(Math.abs(ticks)).slice(1);
  const dt = mine.ticks - ghost.ticks;
  const ds = mine.score - ghost.score;
  const margin = trial || ds === 0 ? secs(dt) : `${formatScore(Math.abs(ds))} ${noun(Math.abs(ds), "point")}`;
  let verdict: string;
  if (trial && !mine.finished) verdict = ghost.finished ? `${ghost.handle} finished; you didn’t` : "Neither of you finished";
  else if (!won && dt === 0 && ds === 0) verdict = `Dead level with ${ghost.handle}`;
  else verdict = won ? `You beat ${ghost.handle} by ${margin}` : `${ghost.handle} beat you by ${margin}`;
  const cell = (who: ReactNode, r: { score: number; ticks: number; finished: boolean }, dot?: string) => (
    <div className="flex min-w-0 flex-col gap-1 rounded-[12px] border-2 border-game-ink bg-game-paper-2 px-3 py-2.5">
      <p className="flex items-center gap-1.5 truncate text-[12px] font-bold uppercase leading-4 tracking-[0.06em] text-game-muted">
        {dot ? <span aria-hidden className="size-2.5 shrink-0 rounded-full border-[1.5px] border-game-ink" style={{ backgroundColor: dot }} /> : null}
        {who}
      </p>
      <p className="num text-[20px] font-bold leading-6">{trial ? (r.finished ? raceClock(r.ticks) : "Out of time") : formatScore(r.score)}</p>
      {!trial ? <p className="num text-[13px] leading-4 text-game-muted">{raceClock(r.ticks)}</p> : null}
    </div>
  );
  return (
    <section aria-label="Against the ghost" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {cell("You", mine)}
        {cell(ghost.label === ghost.handle ? ghost.handle : `${ghost.label} ${ghost.handle}`, ghost, ghost.css)}
      </div>
      <p className="flex items-center gap-2 text-[15px] font-bold leading-5">
        {won ? <BadgeCheck aria-hidden className="size-5 shrink-0 text-[#0b7a4b]" strokeWidth={2.25} /> : null}
        {verdict}
      </p>
    </section>
  );
}

export function RaceResults({ session, end, target, onRetry, onAgain }: { session: RaceSession; end: RaceEnd; target: RaceGhost | null; onRetry(): void; onAgain(): void }) {
  useEffect(() => {
    document.getElementById("race-results-title")?.focus({ preventScroll: true });
  }, []);
  const { race } = session;
  const trial = race.kind === "trial";
  const ending = end.kind === "done" ? end.ending : null;
  const o = ending?.outcome ?? null;
  const course = race.trial;
  const title = !ending
    ? end.kind === "submitting"
      ? "Checking your race…"
      : end.kind === "rejected"
        ? "This race wasn’t filed"
        : "Couldn’t send your race"
    : trial
      ? ending.finished
        ? "Through the finish"
        : "Out of time"
      : race.kind === "daily"
        ? "Daily Run done"
        : "Duel done";
  const ghost = o?.ghost
    ? { label: target?.runId === o.ghost.runId ? target.label : o.ghost.handle, handle: o.ghost.handle, score: o.ghost.score, ticks: o.ghost.ticks, finished: o.ghost.finished, css: target?.runId === o.ghost.runId ? target.css : undefined }
    : target
      ? { label: target.label, handle: target.handle, score: target.track.score, ticks: target.track.ticks, finished: target.finished, css: target.css }
      : null;
  const won = ending && ghost ? (o?.ghost && o.won !== null ? o.won : beatGhost(race.kind, ending, ghost)) : false;
  const next = ending && course && ending.finished ? nextMedal(course, ending.ticks) : course ? nextMedal(course, null) : null;
  return (
    <div className="absolute inset-0 overflow-y-auto overscroll-contain">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-game-night/60" />
      <div className="relative mx-auto flex min-h-full w-full max-w-[560px] flex-col justify-center px-4 py-[max(24px,env(safe-area-inset-top))]">
        <StickerPanel as="section" aria-labelledby="race-results-title" className="wgp-rise flex flex-col gap-4 p-4 sm:gap-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <p className="text-[12px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">{eyebrow(session)}</p>
            <h2 id="race-results-title" tabIndex={-1} className="font-display text-[28px] font-bold leading-8 tracking-[-0.02em] outline-none [text-wrap:balance] sm:text-[34px] sm:leading-10">
              {title}
            </h2>
          </div>

          {end.kind === "submitting" ? (
            <p role="status" className="text-[14px] leading-5 text-game-muted">
              The server replays every input you made. Your time shows here once it agrees.
            </p>
          ) : null}
          {end.kind === "rejected" ? (
            <p className="flex items-start gap-2 text-[14px] leading-5 [text-wrap:pretty]">
              <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-game-hero" strokeWidth={2.25} />
              {REASONS[end.reason] ?? "The server couldn’t verify this race."} It isn’t on the board.
            </p>
          ) : null}
          {end.kind === "submit-failed" ? (
            <div className="flex flex-col gap-3">
              <p className="flex items-start gap-2 text-[14px] leading-5">
                <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-game-hero" strokeWidth={2.25} />
                {end.message}
              </p>
              <StickerButton variant="hero" onClick={onRetry} className="self-start">
                Send it again
              </StickerButton>
            </div>
          ) : null}

          {ending ? (
            <>
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                {trial ? (
                  <Stat label="Time" value={ending.finished ? raceClock(ending.ticks) : "—"} sub={next ? `${medalLabel(next.medal)} is ${raceClock(next.ticks)}` : "Faster than the dev"} />
                ) : (
                  <Stat label={ending.filed === "verified" ? "Score, from the server" : "Score, not filed"} value={formatScore(ending.score)} sub={`in ${raceClock(ending.ticks)}`} />
                )}
                {o?.rank ? (
                  <Stat label={race.kind === "daily" ? "Today’s Daily" : "This course"} value={`#${o.rank}`} sub={`of ${o.total}${o.improved ? ", a new best" : ""}`} />
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {ending.filed === "verified" ? (
                  <StickerChip className="bg-game-mint">
                    <BadgeCheck aria-hidden className="size-4" strokeWidth={2.25} />
                    Replay-verified
                  </StickerChip>
                ) : (
                  <StickerChip className="bg-game-paper-2">Not filed</StickerChip>
                )}
                {trial && ending.finished ? <MedalChip medal={ending.medal} /> : null}
                {o?.streak ? (
                  <StickerChip>
                    <Flame aria-hidden className="size-4" strokeWidth={2.25} />
                    <span>
                      <span className="num">{o.streak}</span>-day streak
                    </span>
                  </StickerChip>
                ) : null}
              </div>
              {ghost ? <Versus kind={race.kind} mine={ending} ghost={ghost} won={won} /> : null}
              {ending.filed === "local" ? (
                <div className="flex flex-col gap-2 rounded-[12px] border-2 border-dashed border-game-ink/40 p-3">
                  <p className="text-[14px] leading-5 [text-wrap:pretty]">
                    {session.mode === "guest"
                      ? "Raced on this device, so it isn’t on the board. Sign in and the server checks every race, files your time and gives you a challenge link."
                      : "Raced off the server, so nothing was filed."}
                  </p>
                  {session.mode === "guest" ? (
                    <StickerButton variant="ink" size="sm" onClick={() => window.dispatchEvent(new CustomEvent("wgp:sign-in"))} className="self-start">
                      Sign in to post your time
                    </StickerButton>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          <div className="flex flex-col gap-2.5 border-t-2 border-dashed border-game-ink/25 pt-4 sm:flex-row sm:flex-wrap">
            {end.kind !== "submitting" ? (
              <StickerButton variant="hero" size="lg" onClick={onAgain} className="w-full sm:w-auto">
                <RotateCcw aria-hidden className="size-5" strokeWidth={2.25} />
                {race.kind === "daily" ? "Run the Daily again" : "Race again"}
              </StickerButton>
            ) : null}
            <StickerLink href="/play/compete" size="lg" className="w-full sm:w-auto">
              Back to Compete
            </StickerLink>
          </div>
          {ending?.filed === "verified" && ending.runId ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <ShareOnX
                text={raceShareText({ kind: race.kind, course: race.course, ticks: ending.ticks, score: ending.score, medal: ending.medal, runId: ending.runId, ghost: ghost ? { handle: ghost.handle, won } : null })}
                size="md"
                className="w-full sm:w-auto"
              />
              <CopyRaceLink runId={ending.runId} className="w-full sm:w-auto" />
            </div>
          ) : null}
        </StickerPanel>
      </div>
    </div>
  );
}
