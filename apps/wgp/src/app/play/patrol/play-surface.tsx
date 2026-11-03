"use client";

/**
 * The 3D night being played: the loop (outside React), the controls, the lazy-loaded
 * scene, and the sticker HUD and sheets over it. Sim events become scene effects, sound
 * and screen-reader lines; an errand opens its sheet and the choice goes back through the
 * loop; the recording is kept fresh for a reload. When the loop's outro ends it calls
 * onDone, and the page draws the results over the still-running city.
 *
 * Finding the way: a waypoint pin (or edge arrow) for the next stop, the minimap in the HUD
 * and the full city map (M, the minimap, or the pause sheet; the night waits while it's
 * open), all placed from a frame tap the scene runs after the camera moves.
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

import { holdAudioLoads, playSfx, setAmbience, setAudioPaused, stopMusic } from "@/audio/player";
import { attachControls, InputLatch, STICK_DEAD_ZONE, STICK_RADIUS, stickKnob, viewFromPose, type Controls, type StickVisual } from "@/game3d/input";
import { FrameTap } from "@/game3d/nav/tap";
import { queueSettled } from "@/game3d/scene/characters/files";
import { QUALITY_PRESETS, type QualityTier } from "@/game3d/scene/quality";
import type { SceneHandle, SceneStats } from "@/game3d/scene/Scene";
import { nightAudio, RunLoop, RunRecorder, sceneEffects, stopPositions, type LoopEvent3D, type NightSession } from "@/game3d/session";
import { HudStore } from "@/sim/loop";
import { useCoarsePointer, useNarrowViewport, useReducedMotion, useShortViewport } from "@/sim/ui/hooks";
import { Hud, useHudValue } from "@/sim/ui/hud";
import { EncounterBanner, ErrandSheet, PauseMenu, WonCaption } from "@/sim/ui/sheets";

import { CityMap, stopName } from "./city-map";
import { ComboMeter } from "./combo";
import { Minimap } from "./minimap";
import { initialSettings, rememberSettings, SettingsPanel, type PlaySettings } from "./settings";
import { Loading } from "./status";
import { Waypoint } from "./waypoint";

const Stage = dynamic(() => import("./stage"), { ssr: false, loading: () => <Loading /> });

declare global {
  interface Window {
    __wgpPlay?: Record<string, unknown>;
    __wgpScene?: SceneStats;
  }
}

/** While a night is on screen: no pull to refresh, no rubber-band bounce or page scroll behind it, no grey tap flash. */
const NIGHT_CSS = `
html:has([data-night]), html:has([data-night]) body { overscroll-behavior: none; overflow: hidden; }
[data-night], [data-night] * { -webkit-tap-highlight-color: transparent; }
`;

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
  /** Overlays placed from the camera each frame (the waypoint, the minimap, the combo timer). */
  const [tap] = useState(() => new FrameTap());
  // Only the few HUD values the page itself places by: it re-renders when one changes, not
  // on every snapshot (the HUD subscribes to those on its own).
  const hudIndex = useHudValue(hudStore, (h) => h?.index ?? null);
  const hudMode = useHudValue(hudStore, (h) => h?.mode ?? null);
  const hudStatus = useHudValue(hudStore, (h) => h?.status ?? null);
  const hudCountdown = useHudValue(hudStore, (h) => (h?.status === "intro" ? h.countdown : null));
  const villainKind = useHudValue(hudStore, (h) => h?.villain?.kind ?? null);
  const touch = useCoarsePointer();
  /** A phone, held either way: the HUD gives the minimap's spot to the villain bar in a fight. */
  const narrow = useNarrowViewport();
  const short = useShortViewport();
  const phone = touch && (narrow || short);
  const reducedMotion = useReducedMotion();
  const handle = useRef<SceneHandle | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const stickRing = useRef<HTMLDivElement>(null);
  const stats = useRef<HTMLPreElement>(null);
  const controls = useRef<Controls | null>(null);
  const lastAnnounce = useRef(0);
  const [settings, setSettings] = useState<PlaySettings>(initialSettings);
  const [paused, setPaused] = useState(false);
  /** The city map: open over play (the night paused for it) or over the pause sheet. */
  const [map, setMap] = useState<"play" | "pause" | null>(null);
  const [errand, setErrand] = useState<{ index: number; chosen: string | null } | null>(null);
  const [results, setResults] = useState<StopResult[]>(() => run.save.patrol?.results ?? []);
  const [announce, setAnnounce] = useState("");

  // What the controls may do right now, read from their event handlers.
  const gate = useRef({ paused, errand: !!errand, ended, map });
  useEffect(() => {
    gate.current = { paused, errand: !!errand, ended, map };
    if (paused || errand || ended || map) controls.current?.release();
  }, [paused, errand, ended, map]);
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

  // Sound waits for the city's first frame (the 3D code comes first), and the score and the
  // city's hum (the big downloads) for the hero's files too. Declared before the loop starts,
  // whose countdown asks for them.
  useEffect(() => {
    const hold = holdAudioLoads();
    const off = hudStore.subscribe(() => {
      if (!hudStore.getSnapshot()) return;
      off();
      hold.effects();
      void queueSettled().then(hold.all);
    });
    return () => {
      off();
      hold.all();
    };
  }, [hudStore]);

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
      setAmbience(null);
      setAudioPaused(false);
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

  // The city map. From play it pauses the night until it closes; from the pause sheet it
  // goes back to the sheet.
  const openMap = useCallback(
    (from: "play" | "pause") => {
      if (from === "play") {
        if (loop.status !== "live" && loop.status !== "intro") return;
        loop.setPaused(true);
      }
      gate.current.map = from;
      setMap(from);
    },
    [loop],
  );
  const closeMap = useCallback(() => {
    const from = gate.current.map;
    gate.current.map = null;
    setMap(null);
    if (from === "play") loop.setPaused(false);
  }, [loop]);
  const toggleMap = useCallback(() => {
    const g = gate.current;
    if (g.errand || g.ended) return;
    if (g.map) closeMap();
    else openMap(g.paused ? "pause" : "play");
  }, [openMap, closeMap]);

  // Keyboard, mouse and touch on the surface.
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const ring = stickRing.current;
    const knob = ring?.querySelector<HTMLElement>("[data-knob]") ?? null;
    let shown = false;
    const onStick = (v: StickVisual) => {
      if (!ring) return;
      if (v.active !== shown) {
        shown = v.active;
        ring.dataset.active = String(v.active);
      }
      if (!v.active) return;
      ring.style.transform = `translate3d(${v.ox}px, ${v.oy}px, 0)`;
      const k = stickKnob(v.x - v.ox, v.y - v.oy, STICK_RADIUS);
      if (knob) knob.style.transform = `translate3d(${k.x.toFixed(1)}px, ${k.y.toFixed(1)}px, 0)`;
    };
    const c = attachControls({
      latch,
      surface: el,
      orbit: (y, p, holding) => handle.current?.orbit(y, p, holding),
      onPause: () => {
        const g = gate.current;
        if (g.errand || g.ended) return;
        // Escape closes the map first.
        if (g.map) closeMap();
        else togglePause();
      },
      onMap: toggleMap,
      enabled: () => {
        const g = gate.current;
        return !autopilot && !g.paused && !g.map && !g.errand && !g.ended && (loop.status === "live" || loop.status === "intro");
      },
      onStick,
    });
    controls.current = c;
    return () => {
      c.detach();
      controls.current = null;
    };
  }, [latch, loop, autopilot, togglePause, closeMap, toggleMap]);

  // A hidden tab (a phone locked, an app switch) or a lost focus pauses (not the autopilot,
  // which a headless check drives), and lets go of every thumb and key, whose lifts the page
  // will never hear. Coming back shows the pause sheet; Resume carries on from there.
  useEffect(() => {
    const onHide = () => {
      controls.current?.release();
      togglePause(true);
    };
    const onVis = () => {
      if (document.hidden) onHide();
    };
    const onBlur = () => {
      if (!autopilot) togglePause(true);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("blur", onBlur);
    };
  }, [togglePause, autopilot]);

  // Choosing shows the outcome on the sheet; "Swing on" sends the choice to the run.
  const chooseErrand = useCallback((id: string) => {
    playSfx("ui-tap", { volume: 0.7 });
    setErrand((e) => (e && !e.chosen ? { ...e, chosen: id } : e));
  }, []);
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
      `cast ms   ${s.castMs.toFixed(2)} (max ${s.castMaxMs.toFixed(2)})`,
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
  const setNorthUp = useCallback((northUp: boolean) => {
    rememberSettings({ northUp });
    setSettings((s) => ({ ...s, northUp }));
  }, []);
  const openMapFromHud = useCallback(() => {
    const g = gate.current;
    // Not over an errand's choice (its keys stay live) or the results.
    if (g.errand || g.ended) return;
    playSfx("ui-tap", { volume: 0.7 });
    openMap(g.paused ? "pause" : "play");
  }, [openMap]);

  const errandStop = errand ? stops[errand.index] : null;
  const introStop = hudIndex !== null && hudMode === "intro" && hudStatus !== "loading" ? stops[hudIndex] : null;
  const countdown = hudCountdown;
  const modal = paused || !!map;
  /** No pulsing or breathing: the steady camera, or the device asks for less motion. */
  const still = settings.steady || reducedMotion;
  const nextStop = hudIndex !== null && hudIndex < stops.length ? stops[hudIndex] : null;
  const hint = touch
    ? { title: "Hold the right side to web", body: "Let go while you’re rising for a perfect swing. Your webs aim for the next stop; drag on the left to run and steer." }
    : { title: "Hold Space or the mouse to web", body: "Let go while you’re rising for a perfect swing. WASD steers; click into the game to look around with the mouse, and press Esc to free the cursor." };

  return (
    // No browser gestures over the night (scroll, zoom, double-tap zoom, pull to refresh);
    // the sheets' own scrollers still scroll. NIGHT_CSS stops the page bouncing behind it.
    <div data-night className="absolute inset-0 touch-none">
      <style href="wgp-night" precedence="medium">
        {NIGHT_CSS}
      </style>
      {/* Long presses select nothing and open no callout or context menu. */}
      <div className="absolute inset-0 select-none [-webkit-touch-callout:none]" inert={modal} onContextMenu={(e) => e.preventDefault()}>
        <div
          ref={surface}
          className="absolute inset-0 touch-none select-none [-webkit-touch-callout:none]"
          role="application"
          aria-label={
            touch
              ? "The city. Hold the right side to web; drag on the left to steer; the buttons by your right thumb use powers."
              : "The city. Hold Space or the mouse to web; WASD steers; keys 1 to 4 use powers; G calls Gwei; Escape pauses."
          }
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
            paused={modal}
            tap={tap}
          />
          {/* The floating stick: its reach (the ring), where the thumb landed (the dot: inside it the stick is centred) and the knob under the thumb. */}
          <div
            ref={stickRing}
            aria-hidden
            data-stick
            data-active="false"
            className="pointer-events-none absolute left-0 top-0 opacity-0 will-change-transform data-[active=true]:opacity-100 motion-safe:transition-[opacity] motion-safe:duration-150 motion-safe:data-[active=true]:duration-0"
          >
            <span
              className="absolute block rounded-full border-[2.5px] border-dashed border-game-paper/80 bg-game-ink/25"
              style={{ left: -STICK_RADIUS, top: -STICK_RADIUS, width: 2 * STICK_RADIUS, height: 2 * STICK_RADIUS }}
            />
            <span
              className="absolute block rounded-full border-2 border-game-paper bg-game-ink/50"
              style={{ left: -STICK_DEAD_ZONE, top: -STICK_DEAD_ZONE, width: 2 * STICK_DEAD_ZONE, height: 2 * STICK_DEAD_ZONE }}
            />
            <span data-knob className="absolute -left-[26px] -top-[26px] block size-[52px] rounded-full border-[2.5px] border-game-ink bg-game-paper shadow-[var(--game-shadow-sm)] will-change-transform" />
          </div>
        </div>
        {/* Under the waypoint and the HUD, so the numbers never hide them. */}
        {debug ? (
          <pre
            ref={stats}
            aria-live="off"
            className="pointer-events-none absolute right-3 top-[52%] rounded-[12px] border-2 border-game-ink bg-game-paper px-3 py-2 font-mono text-xs leading-5 text-game-ink opacity-90 shadow-[var(--game-shadow-sm)] sm:right-4 sm:top-1/2 sm:-translate-y-1/2"
          />
        ) : null}
        {!ended && hudIndex !== null ? <Waypoint tap={tap} city={run.sim.city} stops={stops} index={hudIndex} still={still} touch={touch} /> : null}
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
            combo={<ComboMeter tap={tap} store={hudStore} />}
            minimap={
              <Minimap
                tap={tap}
                city={run.sim.city}
                stops={stops}
                heroColor={colors.suit}
                northUp={settings.northUp}
                onNorthUp={setNorthUp}
                onOpen={openMapFromHud}
                still={still}
                touch={touch}
                nextLabel={nextStop ? stopName(nextStop) : null}
                hidden={phone && villainKind !== null}
              />
            }
          />
        ) : null}
        {!ended && introStop?.kind === "fight" ? <EncounterBanner stop={introStop} index={hudIndex!} total={stops.length} /> : null}
        {!ended && hudMode === "won" && villainKind ? <WonCaption villain={villainKind} /> : null}
        {countdown && !ended ? (
          // Off the hero, who stands in the middle: below the feet, or above the head on a phone held sideways.
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[calc(50%+128px)] flex justify-center short:top-[calc(50%-112px)]">
            <span key={countdown} className="animate-rise num grid size-24 place-items-center rounded-full border-[3px] border-game-ink bg-game-paper text-[56px] font-bold leading-none text-game-ink shadow-[var(--game-shadow)]">
              {countdown}
            </span>
          </div>
        ) : null}
      </div>
      {errandStop?.kind === "errand" && !paused && !ended ? <ErrandSheet stop={errandStop} chosen={errand!.chosen} onChoose={chooseErrand} onLeave={leaveErrand} /> : null}
      {paused && !map && !ended ? (
        <PauseMenu
          loadout={loadout}
          mode="3d"
          touch={touch}
          onResume={() => togglePause(false)}
          onMap={() => openMap("pause")}
          settings={<SettingsPanel settings={settings} onTier={pickTier} onSteady={setSteady} />}
        />
      ) : null}
      {map && !ended ? (
        <CityMap
          city={run.sim.city}
          stops={stops}
          results={results}
          frame={loop.view}
          hero={colors}
          northUp={settings.northUp}
          onNorthUp={setNorthUp}
          onClose={closeMap}
          still={still}
          touch={touch}
        />
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
