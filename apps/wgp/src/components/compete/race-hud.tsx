"use client";

/**
 * The race's HUD over the night (PlaySurface's `addon.Overlay`), and a trial's objective (its
 * `addon.objective`, in the route bar's place):
 *
 * - The gap chip, bottom centre: who you're chasing and the live gap ("+2.4 s" behind, "−0.8 s"
 *   ahead), from game-core's ghost progress. Before the go it lists the ghosts on the grid.
 * - A split, flashed over the chip at every stop reached (or gate passed): your gap there.
 * - Name tags over each ghost, in its colour, placed from the camera every frame.
 * - On a trial: the next gate's pin (or an edge arrow), and the clock and gate count up top.
 *
 * Per-frame work writes the DOM through refs from the frame tap; React renders only when the
 * race's snapshot changes (a few times a second at most). Splits are read out to screen readers.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ghostPose, type GhostPose } from "@wgp/game-core/ghost";
import type { TrialCourseId } from "@wgp/game-core/types";

import { Timer } from "@/components/icons";
import { inBox, edgePoint, project, waypointLayout } from "@/game3d/nav/waypoint";
import type { FrameTap } from "@/game3d/nav/tap";
import type { Race, RaceSnapshot } from "@/game3d/compete/race";
import type { RunLoop } from "@/game3d/session";
import { raceClock, raceGap, spokenGap } from "@/lib/compete/format";

/** Hands the night's loop and frame tap (made inside PlaySurface) to the pieces outside it. */
export class RaceBridge {
  loop: RunLoop | null = null;
  tap: FrameTap | null = null;
  private readonly fns = new Set<() => void>();

  attach(loop: RunLoop, tap: FrameTap): () => void {
    this.loop = loop;
    this.tap = tap;
    for (const fn of this.fns) fn();
    return () => {
      if (this.loop === loop) {
        this.loop = null;
        this.tap = null;
        for (const fn of this.fns) fn();
      }
    };
  }

  subscribe = (fn: () => void) => {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  };

  getSnapshot = () => this.tap;
}

const useRace = (race: Race): RaceSnapshot => useSyncExternalStore(race.subscribe, race.getSnapshot, race.getSnapshot);

/** The gap's colours: a darker mint and the hero red, both at least 4.5:1 on paper; the sign says it too. */
const GAP_TEXT = { ahead: "text-[#0b7a4b]", behind: "text-game-hero", level: "text-game-ink" } as const;

function GapValue({ gap, className = "" }: { gap: number | null; className?: string }) {
  if (gap === null) return <span className={`num font-bold text-game-muted ${className}`}>—</span>;
  const tone = gap < 0 ? "ahead" : gap > 0 ? "behind" : "level";
  return <span className={`num font-bold ${GAP_TEXT[tone]} ${className}`}>{raceGap(gap)}</span>;
}

/** A split rises in, holds, and fades (only for people who haven't asked for less motion). */
const SPLIT_CSS = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes wgp-split { 0% { opacity: 0; translate: 0 8px; } 8%, 82% { opacity: 1; translate: 0 0; } 100% { opacity: 0; translate: 0 0; } }
  .wgp-split { animation: wgp-split 2.8s cubic-bezier(0.22, 1, 0.36, 1) both; }
}
`;

/** Bottom centre: the live gap to the ghost you're chasing, and each split as you reach it. */
function GapChip({ race, label }: { race: Race; label: (i: number) => string }) {
  const snap = useRace(race);
  const t = snap.target;
  const last = snap.last;
  if (!t) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom))] flex flex-col items-center gap-2 px-4 sm:bottom-[calc(24px+env(safe-area-inset-bottom))]">
      <style href="wgp-race-hud" precedence="medium">
        {SPLIT_CSS}
      </style>
      {last ? (
        // Keyed by the split, so each one plays its flash again; with reduced motion it just stays.
        <span key={last.index} className="wgp-split inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-paper px-3.5 text-[14px] font-semibold text-game-ink shadow-[var(--game-shadow-sm)]">
          {label(last.index)}
          <GapValue gap={last.gap} />
        </span>
      ) : null}
      <span className="inline-flex h-11 max-w-full items-center gap-2.5 whitespace-nowrap rounded-full border-[2.5px] border-game-ink bg-game-paper px-4 text-[15px] font-semibold text-game-ink shadow-[var(--game-shadow)]">
        <span aria-hidden className="size-3 shrink-0 rounded-full border-2 border-game-ink" style={{ backgroundColor: t.css }} />
        <span className="truncate">
          vs <span className="font-bold">{t.label}</span>
          {t.label !== t.handle && t.label !== "You" ? <span className="text-game-muted"> {t.handle}</span> : null}
        </span>
        <GapValue gap={snap.gap} className="text-[17px]" />
      </span>
    </div>
  );
}

/** Names over the ghosts, in their colours, placed every frame from the camera. */
function GhostTags({ race, tap, loop }: { race: Race; tap: FrameTap; loop: RunLoop }) {
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    const pose: GhostPose = { x: 0, y: 0, z: 0, fx: 1, fz: 0, action: "idle", anchor: null, done: false };
    const at = { x: 0, y: 0, z: 0 };
    const shown: boolean[] = race.ghosts.map(() => false);
    return tap.on((t) => {
      const v = loop.view;
      const tick = Math.max(0, v.tick - 1 + v.alpha);
      race.ghosts.forEach((g, i) => {
        const el = refs.current[i];
        if (!el) return;
        ghostPose(g.track, tick, pose);
        at.x = pose.x;
        at.y = pose.y + 96;
        at.z = pose.z;
        const pr = t.pose ? project(at, t.pose, t.width, t.height) : null;
        const gone = (tick - g.track.ticks) / 60 > 2.4;
        const near = Math.hypot(pose.x - v.hero.pos.x, pose.z - v.hero.pos.z) < 140;
        const show = !!pr && !pr.behind && pr.depth < 4200 && !gone && !near && pr.x > 0 && pr.x < t.width && pr.y > 0 && pr.y < t.height;
        if (show !== shown[i]) {
          shown[i] = show;
          el.style.visibility = show ? "visible" : "hidden";
        }
        if (show && pr) el.style.transform = `translate3d(${(Math.round(pr.x * 2) / 2).toFixed(1)}px, ${(Math.round(pr.y * 2) / 2).toFixed(1)}px, 0) translate(-50%, -100%)`;
      });
    });
  }, [race, tap, loop]);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {race.ghosts.map((g, i) => (
        <span
          key={g.runId}
          ref={(el) => {
            refs.current[i] = el;
          }}
          style={{ visibility: "hidden" }}
          className="absolute left-0 top-0 inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-game-ink bg-game-paper/90 px-2 text-[12px] font-bold leading-none text-game-ink will-change-transform"
        >
          <span className="size-2.5 rounded-full border-[1.5px] border-game-ink" style={{ backgroundColor: g.css }} />
          {g.label}
        </span>
      ))}
    </div>
  );
}

/** A trial's next gate: a pin over it, or an arrow at the edge pointing the way. */
function GatePin({ tap, loop, touch }: { tap: FrameTap; loop: RunLoop; touch: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const wedge = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const at = { x: 0, y: 0, z: 0 };
    let shown = false;
    let mode = "";
    let text = "";
    return tap.on((t) => {
      const s = loop.run.sim;
      const tr = s.trial;
      const g = tr && tr.endTick < 0 ? s.pickups[tr.next] : null;
      const show = !!g && !!t.pose && s.mode === "travel";
      if (show !== shown) {
        shown = show;
        el.style.visibility = show ? "visible" : "hidden";
      }
      if (!g || !t.pose || !tr) return;
      at.x = g.x;
      at.y = g.y + 110;
      at.z = g.z;
      const pr = project(at, t.pose, t.width, t.height);
      const layout = waypointLayout(t.width, t.height, touch);
      let x = pr.x;
      let y = pr.y;
      let next = "pin";
      if (!inBox(pr, t.width, t.height, layout.pin, layout.avoidPin)) {
        const e = edgePoint(pr, t.width, t.height, layout.arrow, layout.avoid);
        x = e.x;
        y = e.y;
        next = "arrow";
        if (wedge.current) wedge.current.style.transform = `rotate(${e.angle.toFixed(2)}rad)`;
      }
      if (next !== mode) {
        mode = next;
        el.dataset.mode = next;
      }
      const words = tr.next === s.pickups.length - 1 ? "Finish" : `Gate ${tr.next + 1}`;
      if (words !== text && label.current) {
        text = words;
        label.current.textContent = words;
      }
      el.style.transform = `translate3d(${(Math.round(x * 2) / 2).toFixed(1)}px, ${(Math.round(y * 2) / 2).toFixed(1)}px, 0)`;
    });
  }, [tap, loop, touch]);
  return (
    <div ref={root} aria-hidden data-mode="pin" style={{ visibility: "hidden" }} className="group pointer-events-none absolute left-0 top-0 will-change-transform">
      <span className="absolute left-0 top-0 inline-flex h-8 -translate-x-1/2 -translate-y-full items-center whitespace-nowrap rounded-full border-[2.5px] border-game-ink bg-[#8fe7ff] px-3 text-[13px] font-bold text-game-ink shadow-[var(--game-shadow-sm)] group-data-[mode=arrow]:-translate-y-1/2">
        <span ref={label}>Gate 1</span>
      </span>
      <span ref={wedge} className="absolute -left-[9px] -top-[9px] hidden size-[18px] group-data-[mode=arrow]:block">
        <span className="absolute left-[22px] top-[3px] block size-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-game-ink" />
      </span>
    </div>
  );
}

/** What the HUD calls each split: "Stop 2", "Gate 3", "Finish". */
export function splitLabel(kind: "daily" | "trial" | "duel", of: number) {
  return (i: number) => (i === of - 1 ? "Finish" : kind === "trial" ? `Gate ${i + 1}` : `Stop ${i + 1}`);
}

/**
 * The race over the night: splits from the loop's events, the live gap every frame, the gap
 * chip, the ghosts' names and (a trial) the gate pin. Exposes `window.__wgpRace` with ?debug=1
 * or ?autopilot=1 for headless checks.
 */
export function RaceOverlay({ loop, tap, touch, race, bridge, debug }: { loop: RunLoop; tap: FrameTap; touch: boolean; race: Race; bridge: RaceBridge; debug: boolean }) {
  const [said, setSaid] = useState("");
  const label = useMemo(() => splitLabel(race.kind, race.getSnapshot().of), [race]);
  useEffect(() => bridge.attach(loop, tap), [bridge, loop, tap]);
  useEffect(() => {
    const off = loop.bus.on((ev) => {
      if (ev.type === "arrive") race.split(ev.index, loop.run.sim.tick);
      else if (ev.type === "trial-gate") race.split(ev.index, ev.ticks);
      else return;
      const last = race.getSnapshot().last;
      const t = race.target;
      if (last && t) setSaid(`${label(last.index)}: ${last.gap === null ? `ahead of ${t.label}` : spokenGap(last.gap, t.label)}.`);
    });
    const offTap = tap.on(() => race.update(loop.run));
    return () => {
      off();
      offTap();
    };
  }, [loop, tap, race, label]);
  useEffect(() => {
    if (!debug) return;
    const w = window as Window & { __wgpRace?: Record<string, unknown> };
    w.__wgpRace = {
      race,
      ghosts: race.ghosts.map((g) => ({ runId: g.runId, label: g.label, synced: g.synced, ticks: g.track.ticks, checkpoints: g.track.checkpoints, hash: g.track.hash, splits: g.track.splits })),
      // Where ghost i stands at a tick, as the scene draws it.
      poseAt: (i: number, tick: number) => {
        const g = race.ghosts[i];
        return g ? ghostPose(g.track, tick) : null;
      },
      snapshot: () => race.getSnapshot(),
      // What the scene drew last frame: the tick and each ghost's centre.
      drawn: () => (race.drawn ? JSON.parse(JSON.stringify(race.drawn)) : null),
    };
    return () => {
      delete w.__wgpRace;
    };
  }, [race, debug]);
  return (
    <>
      <GhostTags race={race} tap={tap} loop={loop} />
      {loop.run.trial ? <GatePin tap={tap} loop={loop} touch={touch} /> : null}
      <GapChip race={race} label={label} />
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
    </>
  );
}

/** A trial's objective in the route bar's place: the gate count and the clock. */
export function TrialObjective({ bridge, gates, course, className = "" }: { bridge: RaceBridge; gates: number; course: TrialCourseId; className?: string }) {
  const tap = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot);
  const clock = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!tap) return;
    let lastClock = "";
    let lastCount = "";
    return tap.on(() => {
      const s = bridge.loop?.run.sim;
      const tr = s?.trial;
      if (!s || !tr) return;
      const c = raceClock(tr.endTick >= 0 ? tr.endTick : s.tick);
      if (c !== lastClock && clock.current) {
        lastClock = c;
        clock.current.textContent = c;
      }
      const n = `${Math.min(tr.next + 1, gates)}`;
      if (n !== lastCount && count.current) {
        lastCount = n;
        count.current.textContent = n;
      }
    });
  }, [tap, bridge, gates]);
  return (
    <div
      data-course={course}
      className={`flex h-12 items-center justify-between gap-3 rounded-[16px] border-[2.5px] border-game-ink bg-game-paper px-4 text-game-ink shadow-[var(--game-shadow)] ${className}`}
    >
      <span className="whitespace-nowrap text-[14px] font-semibold">
        Gate <span ref={count} className="num font-bold">1</span> of <span className="num">{gates}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Timer aria-hidden className="size-5" strokeWidth={2.25} />
        <span ref={clock} className="num text-[20px] font-bold tracking-[-0.01em]">
          0:00.0
        </span>
      </span>
    </div>
  );
}

