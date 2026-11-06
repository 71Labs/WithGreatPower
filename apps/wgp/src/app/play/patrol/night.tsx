"use client";

/**
 * Which night to play, and what happens at the end of it.
 *
 * - Guests play the browser's save; a recording from before a reload resumes; a patrol
 *   the 2D game already took past its first stop goes back to the 2D game.
 * - Signed in, the night is ranked: a recording of the run in flight resumes, else the
 *   server starts one (game3d/session/night.ts). A run already in flight, today's cap or
 *   an unreachable server each get a choice, with unranked play as the way through.
 * - At the end: submit (ranked), bank locally (guest) or just score it (unranked), and
 *   draw the results over the city.
 * - `?case=001`: the night is that story chapter (Case File 001) instead, through the same
 *   three ways (game3d/session/night.ts): the server's chapter run when signed in, a local
 *   one for a guest, unranked when the server can't start one. Any night, done or not.
 */
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { isChapterId } from "@wgp/game-core/chapters";
import type { ChapterId, Save } from "@wgp/game-core/types";

import { CaseClosed, type CaseFiling } from "@/components/cases/case-closed";
import { badgeView } from "@/lib/cases/view";
import { useAccount, useGame, type AccountState } from "@/game/store";
import {
  beginLocal,
  beginLocalChapter,
  beginRanked,
  clearRecording,
  endNight,
  loadRecording,
  resumeRecording,
  type NightSession,
  type RankedStart,
  type Recording,
} from "@/game3d/session";

import { NightResults, type Ending } from "./night-results";
import { PlaySurface, type ChapterEnd } from "./play-surface";
import { Choice, Loading, Notice, PatrolGame } from "./status";

type Phase =
  | { kind: "boot" }
  | { kind: "notice"; title: string; body: string; href?: string; action?: string }
  | { kind: "choice"; choice: "run-active" | "daily-cap" | "error"; message: string }
  | { kind: "play"; session: NightSession }
  /** The 2D game: no WebGL, a lost context, or a patrol it started. */
  | { kind: "classic" };

const NIGHT_DONE: Phase = {
  kind: "notice",
  title: "You’ve patrolled tonight",
  body: "The city can manage until tomorrow. Probably. Sleep it off from the city.",
};

const NO_HERO: Phase = {
  kind: "notice",
  title: "No hero yet",
  body: "Every night needs someone to swing it. Get bitten first, then come back.",
  href: "/play/bitten",
  action: "Get bitten",
};

/** A guest's recording still fits the browser's save: same hero, same night, not yet played past it. */
function guestFits(rec: Recording, save: Save): boolean {
  const p = save.patrol;
  const untouched = !p || p.phase === "briefing" || (p.phase === "swing" && p.index === 0 && p.results.length === 0);
  return rec.mode === "guest" && !rec.playerId && !save.nightDone && untouched && rec.start.night === save.night && rec.start.hero?.name === save.hero?.name;
}

async function bootGuest(save: Save): Promise<Phase> {
  if (!save.hero) return NO_HERO;
  const rec = await loadRecording();
  if (rec?.mode === "guest") {
    const resumed = guestFits(rec, save) ? resumeRecording(rec) : null;
    if (resumed) return { kind: "play", session: resumed };
    await clearRecording();
  }
  if (save.nightDone) return NIGHT_DONE;
  const session = beginLocal(save, "guest");
  return session ? { kind: "play", session } : { kind: "classic" };
}

function rankedPhase(r: RankedStart): Phase {
  switch (r.kind) {
    case "ready":
      return { kind: "play", session: r.session };
    case "run-active":
      return { kind: "choice", choice: "run-active", message: "" };
    case "daily-cap":
      return { kind: "choice", choice: "daily-cap", message: r.message };
    case "blocked":
      return r.code === "night_done" ? NIGHT_DONE : r.code === "no_hero" ? NO_HERO : { kind: "notice", title: "Can’t start tonight’s patrol", body: r.message };
    case "signed-out":
      // The account store now says guest, which boots again as one.
      return { kind: "boot" };
    case "error":
      return { kind: "choice", choice: "error", message: r.message };
  }
}

async function bootSignedIn(account: Extract<AccountState, { status: "signed-in" }>): Promise<Phase> {
  const { me } = account;
  if (!me.save.hero) return NO_HERO;
  const rec = await loadRecording();
  if (rec && rec.mode !== "guest") {
    const mine = rec.playerId === me.player.id;
    const resumed = mine ? resumeRecording(rec) : null;
    // A ranked run resumes while the server still has it in flight; a finished one goes straight to submit.
    const live = !!resumed && (resumed.run.over || rec.mode === "unranked" || (!!rec.runId && me.activeRun?.runId === rec.runId));
    if (resumed && live) return { kind: "play", session: resumed };
    if (mine) await clearRecording();
  }
  if (me.save.nightDone) return NIGHT_DONE;
  if (me.activeRun) return { kind: "choice", choice: "run-active", message: "" };
  return rankedPhase(await beginRanked());
}

const NO_CASE: Phase = { kind: "notice", title: "This case won’t open", body: "Something’s missing from your save. Try again from the case files.", href: "/play", action: "Back to tonight" };

/** A guest's chapter: a recording from before a reload, else a fresh local one. */
async function bootGuestChapter(save: Save, chapter: ChapterId): Promise<Phase> {
  if (!save.hero) return NO_HERO;
  const rec = await loadRecording(chapter);
  if (rec) {
    const resumed = rec.mode === "guest" && !rec.playerId && rec.start.hero?.name === save.hero.name ? resumeRecording(rec) : null;
    if (resumed) return { kind: "play", session: resumed };
    await clearRecording(chapter);
  }
  const session = beginLocalChapter(save, chapter, "guest");
  return session ? { kind: "play", session } : NO_CASE;
}

/** A signed-in chapter: the run in flight from a recording, else a new chapter run from the server. */
async function bootSignedInChapter(account: Extract<AccountState, { status: "signed-in" }>, chapter: ChapterId): Promise<Phase> {
  const { me } = account;
  if (!me.save.hero) return NO_HERO;
  const rec = await loadRecording(chapter);
  if (rec && rec.mode !== "guest") {
    const mine = rec.playerId === me.player.id;
    const resumed = mine ? resumeRecording(rec) : null;
    const live = !!resumed && (resumed.run.over || rec.mode === "unranked" || (!!rec.runId && me.activeRun?.runId === rec.runId));
    if (resumed && live) return { kind: "play", session: resumed };
    if (mine) await clearRecording(chapter);
  }
  if (me.activeRun) return { kind: "choice", choice: "run-active", message: "" };
  return rankedPhase(await beginRanked({ chapter }));
}

/**
 * `?case=001` (or `?case=case-001`): the chapter this page plays, or null for tonight's patrol.
 * Read from the router, not window.location: a client navigation (the intro's "Start the
 * case") renders this page before the browser's address changes.
 */
function useChapterParam(): ChapterId | null {
  const raw = useSearchParams().get("case");
  if (!raw) return null;
  const id = raw.startsWith("case-") ? raw : `case-${raw}`;
  return isChapterId(id) ? id : null;
}

const CHOICES = {
  "run-active": {
    eyebrow: "Ranked night",
    title: "A night is already under way",
    body: "You started a ranked night somewhere else, maybe another tab, and this device can’t pick it up. Abandon it to start fresh here; it won’t count.",
  },
  "daily-cap": { eyebrow: "Ranked night", title: "That’s today’s ranked nights", body: "" },
  error: { eyebrow: "Ranked night", title: "Couldn’t start a ranked night", body: "" },
} as const;

/** The same choices for a case file (it never ranks, but it's checked like a ranked night). */
const CASE_CHOICES = {
  "run-active": {
    eyebrow: "Case file",
    title: "A run is already under way",
    body: "You started a night or a case somewhere else, maybe another tab, and this device can’t pick it up. Abandon it to open this case here; it won’t count.",
  },
  "daily-cap": { eyebrow: "Case file", title: "That’s today’s tries at this case", body: "" },
  error: { eyebrow: "Case file", title: "Couldn’t open the case with the server", body: "" },
} as const;

/**
 * `?autopilot=1` hands the night to game-core's bot. In production it only plays nights
 * that count for nothing (guest and unranked), so the bot can't put a score on the boards
 * or earn Bits; in development it plays ranked nights too, for local end-to-end checks.
 */
function botMayPlay(session: NightSession): boolean {
  return process.env.NODE_ENV !== "production" || session.mode !== "ranked";
}

/**
 * A case night's ending as its results show it: closed or not, the time, the best, and where
 * the filing stands. While the server checks it (`submitting`), what the night itself said
 * (PlaySurface's `end`: the case-closed event) stands in.
 */
export function caseResults(session: NightSession, ending: Ending, end: ChapterEnd | null) {
  const o = ending.kind === "done" ? ending.outcome : null;
  let filing: CaseFiling;
  let closed = end?.closed ?? false;
  let ticks = end?.ticks ?? null;
  let best: number | null = null;
  let firstClear = false;
  if (!o) filing = { kind: "filing" };
  else if (o.kind === "case") {
    closed = o.cleared;
    ticks = o.cleared ? o.ticks : null;
    best = o.record.bestTicks;
    firstClear = o.firstClear;
    filing =
      o.filed === "verified"
        ? { kind: "filed", badge: o.badge ? badgeView({ signedIn: true, status: o.record.cleared ? "closed" : "new", badge: o.badge }) : undefined }
        : o.filed === "local"
          ? { kind: "guest" }
          : { kind: "not-filed", reason: "This one was played off the server, so nothing was filed." };
  } else if (o.kind === "rejected") filing = { kind: "not-filed", reason: "The server’s replay of your night ended somewhere different, so this clear wasn’t filed. You can play the case again." };
  else if (o.kind === "submit-failed") filing = { kind: "failed", message: o.message };
  else filing = { kind: "not-filed", reason: "This one was played off the server, so nothing was filed." };
  const banked = o?.kind === "case" ? o.save : session.run.save;
  return {
    heroName: session.run.start.hero?.name?.trim() || "The Node",
    closed,
    ticks,
    best,
    firstClear,
    filing,
    edition: banked.editions[0]?.night ?? 0,
  };
}

function useUrlFlag(name: string): boolean {
  const [on] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get(name) === "1");
  return on;
}

export function Night3D() {
  const account = useAccount();
  const { save } = useGame();
  const [phase, setPhase] = useState<Phase>({ kind: "boot" });
  const [ending, setEnding] = useState<Ending | null>(null);
  const [busy, setBusy] = useState(false);
  const autopilot = useUrlFlag("autopilot");
  const debug = useUrlFlag("debug");
  const chapter = useChapterParam();
  // One boot per account state; a remount in development reuses the same promise.
  const boot = useRef<{ key: string; promise: Promise<Phase>; applied: boolean } | null>(null);

  const guestSave = account.status === "guest" ? save : null;
  useEffect(() => {
    if (phase.kind !== "boot" || account.status === "loading") return;
    if (account.status === "guest" && !guestSave) return;
    const key = `${account.status === "signed-in" ? `in:${account.me.player.id}` : "guest"}${chapter ? `:${chapter}` : ""}`;
    if (boot.current?.key === key && boot.current.applied) return;
    if (boot.current?.key !== key) {
      const promise = chapter
        ? account.status === "signed-in"
          ? bootSignedInChapter(account, chapter)
          : bootGuestChapter(guestSave!, chapter)
        : account.status === "signed-in"
          ? bootSignedIn(account)
          : bootGuest(guestSave!);
      boot.current = { key, promise, applied: false };
    }
    const pending = boot.current;
    let live = true;
    void pending.promise.then((next) => {
      if (!live) return;
      pending.applied = true;
      setPhase(next);
    });
    return () => {
      live = false;
    };
  }, [phase.kind, account, guestSave, chapter]);

  const play = (session: NightSession | null) => setPhase(session ? { kind: "play", session } : chapter ? NO_CASE : { kind: "classic" });

  const startRanked = async (abandon: boolean) => {
    setBusy(true);
    const next = rankedPhase(await beginRanked({ abandon, ...(chapter ? { chapter } : {}) }));
    setBusy(false);
    setPhase(next);
  };

  const playUnranked = () => {
    if (account.status !== "signed-in") return;
    play(chapter ? beginLocalChapter(account.me.save, chapter, "unranked", account.me.player.id) : beginLocal(account.me.save, "unranked", account.me.player.id));
  };

  const session = phase.kind === "play" ? phase.session : null;
  /** A case night's ending (PlaySurface says how it went): it gets the case's results. */
  const [chapterEnd, setChapterEnd] = useState<ChapterEnd | null>(null);
  const finish = useCallback(async (chapter?: ChapterEnd) => {
    if (!session) return;
    if (chapter) setChapterEnd(chapter);
    setEnding({ kind: "submitting" });
    try {
      setEnding({ kind: "done", outcome: await endNight(session) });
    } catch {
      setEnding({ kind: "done", outcome: { kind: "submit-failed", message: "Something went wrong sending your night.", preview: session.run.save } });
    }
  }, [session]);

  const fallback = useCallback(() => setPhase({ kind: "classic" }), []);

  if (phase.kind === "classic") return <PatrolGame />;

  let body: ReactNode;
  if (phase.kind === "boot") body = <Loading />;
  else if (phase.kind === "notice") body = <Notice title={phase.title} body={phase.body} href={phase.href} action={phase.action} />;
  else if (phase.kind === "choice") {
    const c = (chapter ? CASE_CHOICES : CHOICES)[phase.choice];
    body = (
      <Choice
        eyebrow={c.eyebrow}
        title={c.title}
        body={
          phase.choice === "run-active"
            ? c.body
            : phase.choice === "daily-cap"
              ? `${phase.message} You can still play ${chapter ? "the case" : "tonight"} unranked; nothing is saved.`
              : `${phase.message} Try again, or play unranked; nothing is saved.`
        }
        primary={phase.choice === "run-active" ? { label: "Abandon it and start over", onClick: () => void startRanked(true) } : phase.choice === "daily-cap" ? { label: "Play unranked", onClick: playUnranked } : { label: "Try again", onClick: () => void startRanked(false) }}
        secondary={phase.choice === "daily-cap" ? undefined : { label: "Play unranked", onClick: playUnranked }}
        busy={busy}
      />
    );
  } else {
    body = (
      <>
        <PlaySurface key={phase.session.runId ?? phase.session.run.seed} session={phase.session} autopilot={autopilot && botMayPlay(phase.session)} debug={debug} ended={!!ending} onDone={finish} onFallback={fallback} />
        {ending && phase.session.chapter ? (
          <CaseClosed chapter={phase.session.chapter} {...caseResults(phase.session, ending, chapterEnd)} onRetry={() => void finish()} />
        ) : ending ? (
          <NightResults session={phase.session} ending={ending} onRetry={() => void finish()} />
        ) : null}
      </>
    );
  }
  return <div className="fixed inset-0 z-[60] overflow-hidden bg-game-night text-game-ink">{body}</div>;
}
