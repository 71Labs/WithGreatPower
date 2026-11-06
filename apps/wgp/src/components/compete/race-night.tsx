"use client";

/**
 * A race, full screen over the app (the patrol's night, with ghosts): the Daily Run, a time
 * trial or a duel. It boots like a ranked night (game3d/session/compete.ts): signed in, the
 * server issues the race (or a recording from before a reload picks it up); a guest races on
 * this device; signed in but capped or off the server, unranked. Meanwhile it fetches the
 * ghosts and replays each one through game-core, keeping only those that hash exactly as the
 * server verified them. Then the patrol's PlaySurface plays it, with the race plugged in
 * (ghosts in the scene, the gap and splits over it), and the results draw over the city.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { COURSES } from "@wgp/game-core/compete";
import { trialBotFrame } from "@wgp/game-core/sim3d";
import type { CastId } from "@wgp/game-core/cast";
import type { TrialCourseId } from "@wgp/game-core/types";

import { Choice, Loading, Notice } from "@/app/play/patrol/status";
import { PlaySurface, type SurfaceAddon } from "@/app/play/patrol/play-surface";
import { useAccount, useGame, type AccountState } from "@/game/store";
import { GhostScene } from "@/game3d/compete/ghost-scene";
import { loadGhosts, Race, type RaceGhost } from "@/game3d/compete/race";
import type { RunLoop } from "@/game3d/session";
import type { FrameTap } from "@/game3d/nav/tap";
import { beginLocalRace, beginRace, endRace, raceSlot, resumeRace, type RaceSession, type RaceStart } from "@/game3d/session/compete";
import { clearRecording, loadRecording } from "@/game3d/session/recorder";
import { getCompete, getGhosts, getRaceTarget, getReplay, type GhostEntry, type RaceSpec } from "@/lib/compete/api";
import { saveLocalBest } from "@/lib/compete/local";

import { RaceOverlay, RaceBridge, TrialObjective } from "./race-hud";
import { RaceResults, type RaceEnd } from "./race-results";

type Phase =
  | { kind: "boot"; note?: string }
  | { kind: "notice"; title: string; body: string; href?: string; action?: string }
  | { kind: "choice"; choice: "run-active" | "daily-cap" | "error"; message: string }
  | { kind: "play"; session: RaceSession; race: Race };

const EMPTY_CAST: CastId[] = [];

function useUrlFlag(name: string): boolean {
  const [on] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get(name) === "1");
  return on;
}

/** The ghosts this race shows: the board's for the Daily and a course, the run itself for a duel. */
async function ghostEntries(spec: RaceSpec): Promise<GhostEntry[]> {
  if (spec.kind === "duel") {
    const t = await getRaceTarget(spec.runId);
    if (!t.ok) return [];
    return [{ runId: t.data.runId, handle: t.data.handle, heroName: t.data.heroName, suit: null, rank: null, score: t.data.score, ticks: t.data.ticks, label: t.data.handle, mine: false }];
  }
  const res = await getGhosts(spec.kind, spec.kind === "trial" ? { course: spec.course, ghost: spec.ghost } : { ghost: spec.ghost });
  return res.ok ? res.data.ghosts : [];
}

/** How many splits a race has: its stops (a patrol night has four), or a course's gates. */
const splitsOf = (s: RaceSession) => (s.race.trial ? COURSES[s.race.trial].gates : s.run.sim.city.zones.length);

const CHOICES = {
  "run-active": {
    eyebrow: "Race",
    title: "A run is already under way",
    body: "You started a night, a case or a race somewhere else, maybe another tab, and this device can’t pick it up. Abandon it to race here; it won’t count.",
  },
  "daily-cap": { eyebrow: "Race", title: "That’s today’s races", body: "" },
  error: { eyebrow: "Race", title: "Couldn’t start the race with the server", body: "" },
} as const;

function startPhase(r: RaceStart): Phase | RaceSession {
  switch (r.kind) {
    case "ready":
      return r.session;
    case "run-active":
      return { kind: "choice", choice: "run-active", message: "" };
    case "daily-cap":
      return { kind: "choice", choice: "daily-cap", message: r.message };
    case "blocked":
      return r.code === "no_hero"
        ? { kind: "notice", title: "No hero yet", body: "Every race needs someone to swing it. Get bitten first, then come back.", href: "/play/bitten", action: "Get bitten" }
        : { kind: "notice", title: "This race won’t start", body: r.message, href: "/play/compete", action: "Back to Compete" };
    case "signed-out":
      return { kind: "boot" };
    case "error":
      return { kind: "choice", choice: "error", message: r.message };
  }
}

/** A race on this device (a guest, or unranked): the day's public seed, a course, or the ghost's own night. */
async function localSession(spec: RaceSpec, account: AccountState, guestSave: ReturnType<typeof useGame>["save"]): Promise<RaceSession | Phase> {
  const signedIn = account.status === "signed-in";
  const save = signedIn ? account.me.save : guestSave;
  const mode = signedIn ? "unranked" : "guest";
  const playerId = signedIn ? account.me.player.id : null;
  if (spec.kind === "trial") return beginLocalRace({ kind: "trial", course: spec.course }, save ?? null, mode, playerId) ?? { kind: "notice", title: "This race won’t start", body: "Try again from Compete." };
  if (spec.kind === "daily") {
    const hub = await getCompete();
    if (!hub.ok) return { kind: "notice", title: "Couldn’t reach today’s Daily", body: "The day’s city comes from the server. Check your connection and try again.", href: "/play/compete", action: "Back to Compete" };
    return beginLocalRace({ kind: "daily", day: hub.data.daily.day, seed: hub.data.daily.seed }, save ?? null, mode, playerId) ?? { kind: "notice", title: "This race won’t start", body: "Try again from Compete." };
  }
  const ghost = await getReplay(spec.runId);
  if (!ghost.ok) return { kind: "notice", title: "That run can’t be raced", body: "It isn’t a verified run, or it’s gone.", href: "/play/compete", action: "Back to Compete" };
  return beginLocalRace({ kind: "duel", ghost: ghost.data }, save ?? null, mode, playerId) ?? { kind: "notice", title: "This race won’t start", body: "Try again from Compete." };
}

/** Signed in: the race in flight from a recording (a reload), else a new one from the server. */
async function signedInSession(spec: RaceSpec, account: Extract<AccountState, { status: "signed-in" }>, abandon: boolean): Promise<RaceSession | Phase> {
  const me = account.me;
  const active = me.activeRun as (typeof me.activeRun & { mode?: string; course?: string | null }) | null;
  if (active && !abandon) {
    const kind = active.mode === "daily" ? "daily" : active.mode === "trial" ? (active.course === "duel" ? "duel" : "trial") : null;
    if (kind && active.course) {
      const trial = kind === "trial" ? (active.course as TrialCourseId) : null;
      const wanted = spec.kind === kind && (spec.kind !== "trial" || spec.course === trial);
      const rec = wanted ? await loadRecording(null, raceSlot(kind, active.course, spec.kind === "duel" ? spec.runId : null)) : null;
      if (rec && rec.runId === active.runId && rec.playerId === me.player.id) {
        const s = resumeRace(rec, { kind, course: active.course, trial, ghost: spec.kind === "duel" ? spec.runId : (spec.ghost ?? null), slot: raceSlot(kind, active.course, spec.kind === "duel" ? spec.runId : null) });
        if (s) return s;
        await clearRecording(null, rec.slot ?? null);
      }
    }
    return { kind: "choice", choice: "run-active", message: "" };
  }
  const r = startPhase(await beginRace(spec, { abandon }));
  return r;
}

const isSession = (v: RaceSession | Phase): v is RaceSession => "race" in v && "run" in v;

export function RaceNight({ spec }: { spec: RaceSpec }) {
  const router = useRouter();
  const account = useAccount();
  const { save } = useGame();
  const [phase, setPhase] = useState<Phase>({ kind: "boot" });
  const [end, setEnd] = useState<RaceEnd | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const autopilot = useUrlFlag("autopilot");
  const debug = useUrlFlag("debug");
  const specKey = JSON.stringify(spec);
  const booted = useRef<string | null>(null);

  const launch = useCallback(
    async (abandon: boolean, unranked = false) => {
      if (account.status === "loading") return;
      setPhase({ kind: "boot", note: "Starting the race…" });
      const got = account.status === "signed-in" && !unranked ? await signedInSession(spec, account, abandon) : await localSession(spec, account, save);
      if (!isSession(got)) {
        if (got.kind === "boot" && account.status === "signed-in") {
          // Signed out under us: race on this device.
          setPhase({ kind: "boot" });
          return;
        }
        setPhase(got);
        return;
      }
      setPhase({ kind: "boot", note: "Fetching the ghosts…" });
      const ghosts: RaceGhost[] = await loadGhosts(await ghostEntries(spec), got.race.trial).catch(() => []);
      setPhase({ kind: "play", session: got, race: new Race(ghosts, got.race.kind, splitsOf(got)) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `spec` is keyed by its JSON
    [account, save, specKey],
  );

  useEffect(() => {
    if (account.status === "loading") return;
    const key = `${account.status === "signed-in" ? account.me.player.id : "guest"}:${specKey}:${attempt}`;
    if (booted.current === key) return;
    booted.current = key;
    void launch(false);
  }, [account, specKey, attempt, launch]);

  const session = phase.kind === "play" ? phase.session : null;
  const race = phase.kind === "play" ? phase.race : null;

  const finish = useCallback(async () => {
    if (!session) return;
    setEnd({ kind: "submitting" });
    try {
      const r = await endRace(session);
      if (r.kind === "done" && r.ending.finished && session.race.trial) saveLocalBest(session.race.trial, r.ending.ticks);
      setEnd(r);
    } catch {
      setEnd({ kind: "submit-failed", message: "Something went wrong sending your race." });
    }
  }, [session]);

  const again = useCallback(() => {
    setEnd(null);
    booted.current = null;
    setAttempt((n) => n + 1);
  }, []);

  if (phase.kind === "boot") return <Shell>{<Loading label={phase.note} />}</Shell>;
  if (phase.kind === "notice") return <Shell>{<Notice title={phase.title} body={phase.body} href={phase.href} action={phase.action} />}</Shell>;
  if (phase.kind === "choice") {
    const c = CHOICES[phase.choice];
    return (
      <Shell>
        <Choice
          eyebrow={c.eyebrow}
          title={c.title}
          body={phase.choice === "run-active" ? c.body : `${phase.message} You can still race on this device; nothing is filed.`}
          primary={
            phase.choice === "run-active"
              ? { label: "Abandon it and race", onClick: () => (setBusy(true), void launch(true).finally(() => setBusy(false))) }
              : phase.choice === "daily-cap"
                ? { label: "Race unranked", onClick: () => void launch(false, true) }
                : { label: "Try again", onClick: () => void launch(false) }
          }
          secondary={phase.choice === "daily-cap" ? { label: "Back to Compete", onClick: () => router.push("/play/compete") } : { label: "Race unranked", onClick: () => void launch(false, true) }}
          busy={busy}
        />
      </Shell>
    );
  }
  return (
    <Shell>
      <RacePlay
        key={`${session!.runId ?? "local"}:${attempt}`}
        session={session!}
        race={race!}
        autopilot={autopilot}
        debug={debug}
        ended={!!end}
        onDone={() => void finish()}
        onFallback={() => setPhase({ kind: "notice", title: "The 3D city stopped", body: "Races need the 3D city, and this browser lost it. Reload to race again.", href: "/play/compete", action: "Back to Compete" })}
      />
      {end ? <RaceResults session={session!} end={end} target={race!.target} onRetry={() => void finish()} onAgain={again} /> : null}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="fixed inset-0 z-[60] overflow-hidden bg-game-night text-game-ink">{children}</div>;
}

/** The night itself, with the race plugged into the patrol's PlaySurface. */
function RacePlay({
  session,
  race,
  autopilot,
  debug,
  ended,
  onDone,
  onFallback,
}: {
  session: RaceSession;
  race: Race;
  autopilot: boolean;
  debug: boolean;
  ended: boolean;
  onDone(): void;
  onFallback(): void;
}) {
  const bridge = useMemo(() => new RaceBridge(), []);
  const trial = session.race.trial;
  const addon = useMemo<SurfaceAddon>(() => {
    function Scene({ loop }: { loop: RunLoop }) {
      return <GhostScene loop={loop} race={race} />;
    }
    function Overlay({ loop, tap, touch }: { loop: RunLoop; tap: FrameTap; touch: boolean; still: boolean }) {
      return <RaceOverlay loop={loop} tap={tap} touch={touch} race={race} bridge={bridge} debug={debug || autopilot} />;
    }
    return {
      Scene,
      Overlay,
      slot: session.race.slot,
      ...(trial
        ? {
            objective: <TrialObjective bridge={bridge} gates={COURSES[trial].gates} course={trial} className="w-full max-w-[420px]" />,
            cast: EMPTY_CAST,
            bot: (s, mem) => trialBotFrame(s, mem),
          }
        : {}),
    };
  }, [race, bridge, session.race.slot, trial, debug, autopilot]);
  // In development the autopilot races signed in too (it can't put a time on a real board in production).
  const botMay = process.env.NODE_ENV !== "production" || session.mode !== "ranked";
  return <PlaySurface session={session} autopilot={autopilot && botMay} debug={debug} ended={ended} onDone={onDone} onFallback={onFallback} addon={addon} />;
}
