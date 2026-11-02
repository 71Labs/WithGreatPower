"use client";

/**
 * The 3D night being played: the loop (outside React), the controls, the lazy-loaded
 * scene, and the sticker HUD and sheets over it. Sim events become scene effects, sound
 * and screen-reader lines; an errand opens its sheet and the choice goes back through the
 * loop; the recording is kept fresh for a reload. When the loop's outro ends it calls
 * onDone, and the page draws the results over the still-running city.
 *
 * `?autopilot=1` hands the input to game-core's bot (and answers errands), `?debug=1`
 * shows the renderer's numbers and exposes `window.__wgpPlay` for headless checks.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { castById, type CastId } from "@wgp/game-core/cast";
import { ALLY_CAST, ERRANDS, SUITS, VILLAINS } from "@wgp/game-core/data";
import { botFrame, newBotMemory } from "@wgp/game-core/sim3d";
import type { Stop, StopResult } from "@wgp/game-core/types";

import { stopMusic } from "@/audio/player";
import { attachControls, InputLatch, viewFromPose, type Controls, type StickVisual } from "@/game3d/input";
import { QUALITY_PRESETS, type QualityTier } from "@/game3d/scene/quality";
import type { SceneHandle, SceneStats } from "@/game3d/scene/Scene";
import { nightAudio, RunLoop, RunRecorder, sceneEffects, stopPositions, type LoopEvent3D, type NightSession } from "@/game3d/session";
import { HudStore } from "@/sim/loop";
import { useCoarsePointer } from "@/sim/ui/hooks";
import { Hud, useHud } from "@/sim/ui/hud";
import { EncounterBanner, ErrandSheet, PauseMenu, WonCaption } from "@/sim/ui/sheets";

import { initialSettings, rememberSettings, SettingsPanel, type PlaySettings } from "./settings";
import { Loading } from "./status";

const Stage = dynamic(() => import("./stage"), { ssr: false, loading: () => <Loading /> });

declare global {
  interface Window {
    __wgpPlay?: Record<string, unknown>;
    __wgpScene?: SceneStats;
  }
}

const castOf = (stop: Stop): CastId => (stop.kind === "fight" ? stop.villain : ALLY_CAST[stop.ally]);

export interface PlaySurfaceProps {
  session: NightSession;
  autopilot: boolean;
  debug: boolean;
  /** The night is over and its outro has played: submit or bank it. */
  onDone(): void;
  /** Set once the night is over: the controls and HUD go, the results draw over the city. */
  ended: boolean;
  /** The WebGL context didn't come back: switch to the 2D game. */
  onFallback(): void;
}

export function PlaySurface({ session, autopilot, debug, onDone, ended, onFallback }: PlaySurfaceProps) {
  const { run } = session;
  const hero = run.start.hero!;
  const stops = run.start.patrol!.stops;
  const colors = SUITS[hero.suit].colors;
  const loadout = useMemo(() => hero.loadout.filter((id) => hero.powers[id]), [hero]);
  const cast = useMemo(() => [...new Set<CastId>([...stops.map(castOf), "gwei", "aunt-mainnet"])], [stops]);
  const positions = useMemo(() => stopPositions(stops.length), [stops]);

  const [hudStore] = useState(() => new HudStore());
  const [loop] = useState(() => new RunLoop(run, { hud: hudStore }));
  const [latch] = useState(() => new InputLatch());
  const hud = useHud(hudStore);
  const touch = useCoarsePointer();
  const handle = useRef<SceneHandle | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const stickRing = useRef<HTMLDivElement>(null);
  const stats = useRef<HTMLPreElement>(null);
  const controls = useRef<Controls | null>(null);
  const lastAnnounce = useRef(0);
  const [settings, setSettings] = useState<PlaySettings>(initialSettings);
  const [paused, setPaused] = useState(false);
  const [errand, setErrand] = useState<{ index: number; chosen: string | null } | null>(null);
  const [results, setResults] = useState<StopResult[]>(() => run.save.patrol?.results ?? []);
  const [announce, setAnnounce] = useState("");

  // What the controls may do right now, read from their event handlers.
  const gate = useRef({ paused, errand: !!errand, ended });
  useEffect(() => {
    gate.current = { paused, errand: !!errand, ended };
    if (paused || errand || ended) controls.current?.release();
  }, [paused, errand, ended]);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  const say = useCallback((text: string, urgent = false) => {
    const now = performance.now();
    if (!urgent && now - lastAnnounce.current < 1500) return;
    lastAnnounce.current = now;
    setAnnounce(text);
  }, []);

  // The loop: input source, events, recording, and the debug hooks. The loop itself lives
  // as long as this component; effects only attach to it, so a remount in development is safe.
  useEffect(() => {
    const mem = newBotMemory();
    loop.setSource(autopilot ? (r) => botFrame(r.sim, mem) : () => latch.take(viewFromPose(handle.current?.pose())));
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));

    const onEvent = (ev: LoopEvent3D) => {
      switch (ev.type) {
        case "encounter": {
          const stop = stops[ev.index] as Extract<Stop, { kind: "fight" }>;
          const v = VILLAINS[ev.villain];
          say(`${v.name}${stop.boss ? ", the boss" : ""}${stop.quest ? ", tonight’s quest" : ""}: “${v.taunt}”`, true);
          break;
        }
        case "fight-live":
          say("Fight!", true);
          break;
        case "hero-hurt":
          say(`Hit by ${ev.source}, ${ev.damage} damage. Health ${ev.hp}.`);
          break;
        case "villain-hit":
          if (ev.hits > 0) say(`Hit! ${ev.hits} to go.`);
          break;
        case "fight-won":
          say(`Webbed! ${VILLAINS[ev.villain].defeat}`, true);
          break;
        case "ko":
          say("Knocked out. Aunt Mainnet will patch you up.", true);
          break;
        case "errand": {
          const stop = stops[ev.index];
          controls.current?.release();
          setErrand({ index: ev.index, chosen: null });
          if (stop?.kind === "errand") {
            say(`${castById(ALLY_CAST[stop.ally]).name} needs a hand.`, true);
            if (autopilot) {
              const first = ERRANDS.find((x) => x.id === stop.errand)?.choices[0]?.id ?? null;
              later(() => setErrand((e) => (e ? { ...e, chosen: first } : e)), 600);
              later(() => {
                if (!loop.chooseErrand(0)) return;
                setErrand(null);
                setResults(run.save.patrol?.results ?? []);
              }, 1400);
            }
          }
          break;
        }
        case "countdown":
          say(String(ev.value), true);
          break;
        case "go":
          say(touch ? "Go! Hold the right side to web." : "Go! Hold Space to web.", true);
          break;
        case "status":
          if (ev.status === "done") done.current();
          break;
      }
      if (ev.type === "arrive" || ev.type === "fight-won" || ev.type === "ko" || ev.type === "stop-done" || ev.type === "night-over") {
        setResults(run.save.patrol?.results ?? []);
      }
    };
    const offs = [loop.bus.on(onEvent), loop.bus.on(sceneEffects(() => handle.current)), loop.bus.on(nightAudio(stops))];
    loop.start();

    const recorder = new RunRecorder(run, { mode: session.mode, runId: session.runId, playerId: session.playerId });
    const stopRecording = recorder.start();
    const offOver = loop.bus.on((ev) => {
      // Write the finished log at once, so a reload during the submit can submit it again.
      if (ev.type === "night-over") void recorder.flush().then(() => recorder.stop());
    });

    if (debug || autopilot) {
      window.__wgpPlay = {
        loop,
        run,
        latch,
        session: { mode: session.mode, runId: session.runId, resumed: session.resumed },
        handle: () => handle.current,
        pause: (p: boolean) => loop.setPaused(p),
        peek: () => {
          const s = run.sim;
          return {
            status: loop.status,
            mode: s.mode,
            index: s.index,
            tick: s.tick,
            x: Math.round(s.hero.x),
            y: Math.round(s.hero.y),
            z: Math.round(s.hero.z),
            vx: Math.round(s.hero.vx),
            vz: Math.round(s.hero.vz),
            rope: !!s.hero.rope,
            hp: s.hp,
            input: s.input,
            over: run.over,
            error: run.error,
          };
        },
      };
    }

    return () => {
      offs.forEach((off) => off());
      offOver();
      stopRecording();
      timers.forEach((t) => window.clearTimeout(t));
      stopMusic();
      if (debug || autopilot) delete window.__wgpPlay;
    };
  }, [loop, latch, run, session, stops, autopilot, debug, touch, say]);

  const togglePause = useCallback(
    (next?: boolean) => {
      const value = next ?? loop.status !== "paused";
      if (value && loop.status !== "live" && loop.status !== "intro") return;
      loop.setPaused(value);
      setPaused(loop.status === "paused");
    },
    [loop],
  );

  // Keyboard, mouse and touch on the surface.
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const ring = stickRing.current;
    const onStick = (v: StickVisual) => {
      if (!ring) return;
      ring.style.opacity = v.active ? "1" : "0";
      ring.style.transform = `translate(${v.ox}px, ${v.oy}px)`;
      const knob = ring.firstElementChild as HTMLElement | null;
      if (knob) {
        const dx = v.x - v.ox;
        const dy = v.y - v.oy;
        const d = Math.hypot(dx, dy);
        const k = d > 56 ? 56 / d : 1;
        knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      }
    };
    const c = attachControls({
      latch,
      surface: el,
      orbit: (y, p, holding) => handle.current?.orbit(y, p, holding),
      onPause: () => {
        const g = gate.current;
        if (g.errand || g.ended) return;
        togglePause();
      },
      enabled: () => {
        const g = gate.current;
        return !autopilot && !g.paused && !g.errand && !g.ended && (loop.status === "live" || loop.status === "intro");
      },
      onStick,
    });
    controls.current = c;
    return () => {
      c.detach();
      controls.current = null;
    };
  }, [latch, loop, autopilot, togglePause]);

  // A hidden tab or a lost focus pauses (not the autopilot, which a headless check drives).
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) togglePause(true);
    };
    const onBlur = () => {
      if (!autopilot) togglePause(true);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
    };
  }, [togglePause, autopilot]);

  // Choosing shows the outcome on the sheet; "Swing on" sends the choice to the run.
  const chooseErrand = useCallback((id: string) => setErrand((e) => (e && !e.chosen ? { ...e, chosen: id } : e)), []);
  const leaveErrand = useCallback(() => {
    const stop = errand ? stops[errand.index] : null;
    if (!errand?.chosen || stop?.kind !== "errand") return;
    const value = ERRANDS.find((x) => x.id === stop.errand)?.choices.findIndex((c) => c.id === errand.chosen) ?? -1;
    if (value >= 0 && loop.chooseErrand(value)) {
      setErrand(null);
      setResults(run.save.patrol?.results ?? []);
    }
  }, [errand, stops, loop, run]);

  const onStats = useCallback((s: SceneStats) => {
    window.__wgpScene = s;
    const el = stats.current;
    if (!el) return;
    el.textContent = [
      `tier      ${s.tier}`,
      `fps       ${s.fps.toFixed(0)}`,
      `dpr       ${s.dpr.toFixed(2)}`,
      `calls     ${s.calls}`,
      `triangles ${s.triangles.toLocaleString("en-US")}`,
      `programs  ${s.programs}`,
    ].join("\n");
  }, []);

  const onTierSuggest = useCallback((t: QualityTier) => setSettings((s) => (s.adaptive ? { ...s, tier: t } : s)), []);
  const pickTier = (tier: QualityTier) => {
    rememberSettings({ tier });
    setSettings((s) => ({ ...s, tier, adaptive: false }));
  };
  const setSteady = (steady: boolean) => {
    rememberSettings({ steady });
    setSettings((s) => ({ ...s, steady }));
  };

  const errandStop = errand ? stops[errand.index] : null;
  const introStop = hud && hud.mode === "intro" && hud.status !== "loading" ? stops[hud.index] : null;
  const countdown = hud?.status === "intro" ? hud.countdown : null;
  const modal = paused;
  const hint = touch
    ? { title: "Hold the right side to web", body: "Let go while you’re rising for a perfect swing. You head for the next stop on your own; drag on the left to steer." }
    : { title: "Hold Space or the mouse to web", body: "Let go while you’re rising for a perfect swing. WASD steers; click into the game to look around with the mouse, and press Esc to free the cursor." };

  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0" inert={modal}>
        <div
          ref={surface}
          className="absolute inset-0 touch-none select-none [-webkit-touch-callout:none]"
          role="application"
          aria-label="The city. Hold Space or the mouse to web; WASD steers; keys 1 to 4 use powers; G calls Gwei; Escape pauses."
        >
          <Stage
            loop={loop}
            city={run.sim.city}
            handle={handle}
            quality={QUALITY_PRESETS[settings.tier]}
            heroColors={colors}
            cast={cast}
            reducedMotion={settings.steady}
            onStats={debug ? onStats : undefined}
            onTierSuggest={settings.adaptive ? onTierSuggest : undefined}
            onContextStalled={onFallback}
          />
          <div ref={stickRing} aria-hidden className="pointer-events-none absolute left-0 top-0 opacity-0">
            <span className="absolute -left-6 -top-6 block size-12 rounded-full border-[2.5px] border-game-ink bg-game-paper shadow-[var(--game-shadow-sm)]" />
            <span className="absolute -left-[60px] -top-[60px] -z-10 block size-[120px] rounded-full border-[2.5px] border-dashed border-game-paper/80 bg-game-ink/20" />
          </div>
        </div>
        {!ended ? (
          <Hud
            store={hudStore}
            stops={stops}
            results={results}
            positions={positions}
            hero={colors}
            touch={touch}
            arc
            hint={hint}
            onAbility={(slot) => latch.pushShot((slot + 1) as 1 | 2 | 3 | 4)}
            onGwei={() => latch.pushShot(5)}
            onPause={() => togglePause(true)}
          />
        ) : null}
        {!ended && introStop?.kind === "fight" ? <EncounterBanner stop={introStop} index={hud!.index} total={stops.length} /> : null}
        {!ended && hud?.mode === "won" && hud.villain ? <WonCaption villain={hud.villain.kind} /> : null}
        {countdown && !ended ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            <span key={countdown} className="animate-rise num grid size-28 place-items-center rounded-full border-[3px] border-game-ink bg-game-paper text-[64px] font-bold leading-none text-game-ink shadow-[var(--game-shadow)]">
              {countdown}
            </span>
          </div>
        ) : null}
        {debug ? (
          <pre
            ref={stats}
            aria-live="off"
            className="pointer-events-none absolute right-3 top-[34%] rounded-[12px] sm:right-4 sm:top-1/2 sm:-translate-y-1/2 border-2 border-game-ink bg-game-paper px-3 py-2 font-mono text-xs leading-5 text-game-ink shadow-[var(--game-shadow-sm)]"
          />
        ) : null}
      </div>
      {errandStop?.kind === "errand" && !paused && !ended ? <ErrandSheet stop={errandStop} chosen={errand!.chosen} onChoose={chooseErrand} onLeave={leaveErrand} /> : null}
      {paused && !ended ? (
        <PauseMenu loadout={loadout} mode="3d" onResume={() => togglePause(false)} settings={<SettingsPanel settings={settings} onTier={pickTier} onSteady={setSteady} />} />
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
