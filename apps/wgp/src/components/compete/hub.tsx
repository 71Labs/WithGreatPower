"use client";

/**
 * /play/compete, the Compete hub: every run is replay-verified, so every run is a ghost you
 * can race. Today's Daily Run (the same city for everyone, its kit, the countdown to the next,
 * your best, rank, attempts and streak, and the board with a "Race" on every row), the five
 * time trials (your medal, the record, the times to beat), your rivals (the ghosts you've raced
 * and how it went) and the way to the Season boards. A guest sees all of it and races on this
 * device; signing in files the times.
 */
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { COURSES, DAILY_ATTEMPTS, DAILY_NIGHT, medalFor, TRIAL_COURSE_IDS, type Medal } from "@wgp/game-core/compete";
import type { TrialCourseId } from "@wgp/game-core/types";

import { ON_PAPER, StickerButton, StickerChip, StickerEyebrow, StickerLink, StickerPanel, stickerTileClass } from "@/components/game/kit";
import { ArrowRight, Award, ChevronRight, CircleAlert, Clock, Flame, Medal as MedalIcon, Replay, RotateCcw, Timer, Users, Zap } from "@/components/icons";
import { useAccount } from "@/game/store";
import { getCompete, type CompeteView } from "@/lib/compete/api";
import { dayLabel, formatScore, kitLine, MEDAL_FILL, medalLabel, nextMedal, raceClock, untilLabel } from "@/lib/compete/format";
import { useLocalBests } from "@/lib/compete/local";
import { racePath } from "@/lib/compete/share";

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; view: CompeteView };

function useCompete(): { load: Load; retry(): void } {
  const account = useAccount();
  const key = account.status === "signed-in" ? account.me.player.id : account.status;
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; load: Load } | null>(null);
  const k = `${key}:${attempt}`;
  useEffect(() => {
    if (account.status === "loading") return;
    const ctrl = new AbortController();
    getCompete(ctrl.signal).then(
      (res) => setAnswer({ key: k, load: res.ok ? { state: "ready", view: res.data } : { state: "error" } }),
      () => {},
    );
    return () => ctrl.abort();
  }, [account.status, k]);
  // Back from a race: read it again.
  useEffect(() => {
    const onFocus = () => setAttempt((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return { load: answer?.key === k ? answer.load : (answer?.load ?? { state: "loading" }), retry: () => setAttempt((n) => n + 1) };
}

/** The clock to the half minute (the countdown reads minutes); none while prerendering, so the page shell stays static. */
const STEP = 30_000;
const subscribeClock = (fn: () => void) => {
  const id = window.setInterval(fn, STEP);
  return () => window.clearInterval(id);
};
const clockNow = () => Math.floor(Date.now() / STEP) * STEP;
const useNow = (): number | null => useSyncExternalStore(subscribeClock, clockNow, () => null);

function SectionTitle({ id, children, aside }: { id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 id={id} className="flex items-center gap-2 text-[12px] font-bold uppercase leading-4 tracking-[0.1em] text-game-paper/85">
        <span aria-hidden className="h-[3px] w-4 rounded-full bg-game-hero" />
        {children}
      </h2>
      {aside}
    </div>
  );
}

function Fact({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[12px] border-2 border-game-ink bg-game-paper-2 px-3 py-2">
      <dt className="text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">{label}</dt>
      <dd className="num truncate text-[18px] font-bold leading-6">{children}</dd>
      {sub ? <dd className="num truncate text-[12px] leading-4 text-game-muted">{sub}</dd> : null}
    </div>
  );
}

function MedalChip({ medal, small = false }: { medal: Medal | null; small?: boolean }) {
  return (
    <span className={`inline-flex ${small ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-[12px]"} items-center gap-1 whitespace-nowrap rounded-full border-2 border-game-ink font-bold text-game-ink ${medal ? MEDAL_FILL[medal] : "bg-game-paper-2"}`}>
      <MedalIcon aria-hidden className={small ? "size-3" : "size-3.5"} strokeWidth={2.25} />
      {medalLabel(medal)}
    </span>
  );
}

/* ------------------------------------------------------------------ the Daily */

function DailyPanel({ view, now }: { view: CompeteView | null; now: number | null }) {
  const d = view?.daily ?? null;
  const signedIn = !!view?.signedIn;
  const left = d ? Math.max(0, d.attempts.limit - d.attempts.used) : DAILY_ATTEMPTS;
  const resets = d ? Date.parse(d.resetsAt) : null;
  return (
    <StickerPanel as="section" aria-labelledby="daily-title" className={`flex flex-col gap-4 p-4 sm:p-6 ${ON_PAPER}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <StickerEyebrow>{d ? `Daily Run · ${dayLabel(d.day)}` : "Daily Run"}</StickerEyebrow>
          <h2 id="daily-title" className="font-display text-[26px] font-bold leading-8 tracking-[-0.02em] text-game-ink [text-wrap:balance] sm:text-[32px] sm:leading-9">
            One city. Everyone. <span className="text-game-muted">Today only.</span>
          </h2>
        </div>
        <StickerChip className="bg-game-paper-2">
          <Clock aria-hidden className="size-4" strokeWidth={2.25} />
          New city in <span className="num">{resets && now !== null ? untilLabel(resets, now) : "…"}</span>
        </StickerChip>
      </div>
      <p className="max-w-[62ch] text-[14px] leading-5 [text-wrap:pretty]">
        The same seed and the same hero for every player: night {DAILY_NIGHT}, villains at level 2,{" "}
        {d ? (
          <>
            and today’s kit, <span className="font-semibold">{kitLine(d.kit)}</span>.
          </>
        ) : (
          "and today’s kit."
        )}{" "}
        The day’s top three race beside you as ghosts. Your best of {DAILY_ATTEMPTS} counts; it never touches Season 1.
      </p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Fact label="Your best" sub={d?.best ? raceClock(d.best.ticks) : undefined}>
          {d?.best ? formatScore(d.best.score) : "—"}
        </Fact>
        <Fact label="Rank" sub={d ? (d.best?.rank ? `of ${d.total}` : `${d.total} ${d.total === 1 ? "runner" : "runners"} today`) : undefined}>
          {d?.best?.rank ? `#${d.best.rank}` : "—"}
        </Fact>
        <Fact label="Streak" sub={d && d.streak > 0 ? (d.streak === 1 ? "day" : "days in a row") : "Run today to start one"}>
          <span className="inline-flex items-center gap-1">
            <Flame aria-hidden className="size-4" strokeWidth={2.25} />
            {d?.streak ?? 0}
          </span>
        </Fact>
        <Fact label="Runs left" sub={signedIn ? `of ${DAILY_ATTEMPTS} today` : "Sign in to post"}>
          {signedIn ? left : "—"}
        </Fact>
      </dl>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <StickerLink href="/play/compete/daily" variant="hero" size="lg" className="w-full sm:w-auto">
          <Zap aria-hidden className="size-5" strokeWidth={2.25} />
          {signedIn ? (left > 0 ? "Run today’s Daily" : "Race it again, unranked") : "Race today’s Daily"}
        </StickerLink>
        {!signedIn ? (
          <StickerButton size="lg" onClick={() => window.dispatchEvent(new CustomEvent("wgp:sign-in"))} className="w-full sm:w-auto">
            Sign in to post your time
          </StickerButton>
        ) : null}
        {d && (d.podiums > 0 || d.wins > 0) ? (
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-game-muted">
            <Award aria-hidden className="size-4" strokeWidth={2.25} />
            <span>
              <span className="num">{d.podiums}</span> podium{d.podiums === 1 ? "" : "s"}, <span className="num">{d.wins}</span> win{d.wins === 1 ? "" : "s"}
            </span>
          </p>
        ) : null}
      </div>
      <DailyBoard view={view} />
      <p className="text-[12px] leading-4 text-game-muted [text-wrap:pretty]">
        When the day closes, its top three earn a soulbound Daily podium badge (first also earns the Daily winner badge), once each, minted to their NEAR account.
      </p>
    </StickerPanel>
  );
}

function DailyBoard({ view }: { view: CompeteView | null }) {
  const rows = view?.daily.top ?? [];
  return (
    <section aria-labelledby="daily-board-title" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="daily-board-title" className="text-[13px] font-bold uppercase tracking-[0.08em] text-game-muted">
          Today’s board
        </h3>
        {view ? (
          <span className="num text-[12px] text-game-muted">
            {view.daily.total} {view.daily.total === 1 ? "runner" : "runners"}
          </span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-[12px] border-2 border-dashed border-game-ink/40 px-3 py-3 text-[14px] leading-5">Nobody’s posted a time yet. Run it first and you’re the ghost everyone chases.</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.playerId} className="flex min-h-12 items-center gap-3 rounded-[12px] border-2 border-game-ink bg-game-paper px-3 py-1.5">
              <span className="num w-7 shrink-0 text-[15px] font-bold">#{r.rank}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] font-semibold leading-5" title={r.handle}>
                  {r.handle}
                </span>
                <span className="num text-[12px] leading-4 text-game-muted">
                  {formatScore(r.score)} · {raceClock(r.ticks)}
                </span>
              </span>
              {r.runId ? (
                <Link
                  href={`/play/compete/daily?ghost=${r.runId}`}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] border-2 border-game-ink bg-game-paper px-3 text-[13px] font-semibold shadow-[var(--game-shadow-sm)] focus-visible:outline-offset-2 motion-safe:transition-[translate,box-shadow] motion-safe:duration-100 active:translate-y-[2px] active:shadow-none pointer-coarse:h-11 pointer-fine:hover:bg-game-paper-2"
                  aria-label={`Race ${r.handle}’s ghost`}
                >
                  <Replay aria-hidden className="size-4" strokeWidth={2.25} />
                  Race
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ trials */

function TrialTile({ id, view, local }: { id: TrialCourseId; view: CompeteView | null; local: number | null }) {
  const c = COURSES[id];
  const t = view?.trials.find((x) => x.id === id) ?? null;
  const bestTicks = t?.best?.ticks ?? local;
  const medal = bestTicks !== null && bestTicks !== undefined ? medalFor(id, bestTicks) : null;
  const next = nextMedal(id, bestTicks ?? null);
  return (
    <li className="min-w-0">
      <Link href={`/play/compete/trial/${id}`} className={`${stickerTileClass} h-full gap-3 p-3.5`}>
        <span className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="num text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-game-muted">
              Trial {c.number} · {c.district}
            </span>
            <span className="text-[18px] font-bold leading-6 tracking-[-0.01em]">{c.name}</span>
          </span>
          <ChevronRight aria-hidden className="mt-1 size-5 shrink-0" strokeWidth={2.25} />
        </span>
        <span className="text-[13px] leading-[18px] text-game-muted [text-wrap:pretty]">{c.blurb}</span>
        <span className="flex flex-wrap items-center gap-2">
          {bestTicks ? (
            <>
              <MedalChip medal={medal} small />
              <span className="num text-[13px] font-semibold">
                <Timer aria-hidden className="mr-1 inline size-3.5 align-[-2px]" strokeWidth={2.25} />
                {raceClock(bestTicks)}
                {t?.best?.rank ? ` · #${t.best.rank}` : !t?.best && local ? " · this device" : ""}
              </span>
            </>
          ) : (
            <span className="text-[13px] font-semibold">Not raced yet</span>
          )}
        </span>
        <span className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-dashed border-game-ink/20 pt-2 text-[12px] leading-4 text-game-muted">
          <span className="num">{next ? `${medalLabel(next.medal)}: ${raceClock(next.ticks)}` : "Faster than the dev"}</span>
          <span className="num truncate">{t?.record ? `Record ${raceClock(t.record.ticks)}, ${t.record.handle}` : `${c.gates} gates`}</span>
        </span>
      </Link>
    </li>
  );
}

/* ------------------------------------------------------------------ rivals */

function Rivals({ view }: { view: CompeteView | null }) {
  const rivals = view?.rivals ?? [];
  if (!view?.signedIn)
    return <p className="rounded-[16px] border-2 border-dashed border-game-paper/40 px-4 py-3 text-[14px] leading-5 text-game-paper/85">Sign in and every ghost you race lands here, with who won.</p>;
  if (rivals.length === 0)
    return (
      <p className="rounded-[16px] border-2 border-dashed border-game-paper/40 px-4 py-3 text-[14px] leading-5 text-game-paper/85">
        No rivals yet. Hit “Race” on any board row, or open someone’s challenge link, and they show up here.
      </p>
    );
  return (
    <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {rivals.map((r) => {
        const what = r.kind === "daily" ? `Daily · ${dayLabel(r.course)}` : r.kind === "trial" ? COURSES[r.course as TrialCourseId]?.name ?? "Trial" : "Duel";
        const trial = r.kind === "trial";
        return (
          <li key={r.ghostRunId} className={`flex items-center gap-3 rounded-[16px] border-2 border-game-ink bg-game-paper p-3 text-game-ink shadow-[var(--game-shadow-sm)] ${ON_PAPER}`}>
            <span className={`grid size-10 shrink-0 place-items-center rounded-full border-2 border-game-ink text-[13px] font-bold ${r.won ? "bg-game-mint" : "bg-game-paper-2"}`}>{r.won ? "Won" : "Lost"}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-bold leading-5" title={r.handle}>
                {r.handle}
              </span>
              <span className="num truncate text-[12px] leading-4 text-game-muted">
                {what} · you {trial ? raceClock(r.yours.ticks) : formatScore(r.yours.score)}, them {trial ? raceClock(r.theirs.ticks) : formatScore(r.theirs.score)}
              </span>
            </span>
            <StickerLink href={racePath(r.ghostRunId)} size="sm" aria-label={`Rematch ${r.handle}`}>
              <RotateCcw aria-hidden className="size-4" strokeWidth={2.25} />
              Rematch
            </StickerLink>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ the page */

export function CompeteHub() {
  const { load, retry } = useCompete();
  const now = useNow();
  const local = useLocalBests();
  const view = load.state === "ready" ? load.view : null;
  return (
    <div className="wgp-rise mx-auto flex w-full max-w-[560px] flex-col gap-7 px-4 pb-6 sm:max-w-[820px] lg:max-w-[1040px] lg:px-8">
      <header className="flex flex-col items-center gap-2 text-center">
        <StickerChip>
          <Users aria-hidden className="size-4" strokeWidth={2.25} />
          Every run is a ghost
        </StickerChip>
        <h1 className="font-display text-[34px] font-semibold leading-9 tracking-[-0.03em] text-game-paper [text-shadow:0_2px_0_var(--game-ink)] sm:text-[44px] sm:leading-[46px]">Compete</h1>
        <p className="max-w-[46ch] text-[14px] leading-5 text-game-paper/80 sm:text-[15px] sm:leading-[22px] [text-wrap:pretty]">
          The server replays every run before it counts, so every run can be raced again, frame for frame. Chase the best, beat your own, send a challenge.
        </p>
      </header>

      {load.state === "error" ? (
        <div role="alert" className={`flex flex-col gap-3 rounded-[16px] border-2 border-game-ink bg-game-paper p-3.5 text-game-ink sm:flex-row sm:items-center sm:justify-between ${ON_PAPER}`}>
          <p className="flex items-center gap-2 text-[14px] font-semibold">
            <CircleAlert aria-hidden className="size-5 shrink-0 text-game-hero" strokeWidth={2.25} />
            Couldn’t load the boards. Races still start.
          </p>
          <StickerButton size="sm" onClick={retry}>
            <RotateCcw aria-hidden className="size-4" strokeWidth={2.25} />
            Try again
          </StickerButton>
        </div>
      ) : null}

      <DailyPanel view={view} now={now} />

      <section aria-labelledby="trials-title" className="flex flex-col gap-3">
        <SectionTitle id="trials-title">Time trials</SectionTitle>
        <ul className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 lg:grid-cols-3">
          {TRIAL_COURSE_IDS.map((id) => (
            <TrialTile key={id} id={id} view={view} local={local[id] ?? null} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="rivals-title" className="flex flex-col gap-3">
        <SectionTitle id="rivals-title">Your rivals</SectionTitle>
        <Rivals view={view} />
      </section>

      <Link href="/play/leaderboard" className={`${stickerTileClass} flex-row items-center gap-3 p-3.5`}>
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[12px] border-2 border-game-ink bg-game-gold">
          <Award className="size-5" strokeWidth={2.25} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[16px] font-bold leading-5">Season 1 boards</span>
          <span className="text-[13px] leading-[18px] text-game-muted">Tonight, the season and all time: your ranked nights.</span>
        </span>
        <ArrowRight aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
      </Link>
    </div>
  );
}
