"use client";

/**
 * The City being played: the outing's loop (outside React), free roam's controls, the
 * lazy-loaded scene, and the City HUD and sheets over it.
 *
 * - Filing: what the outing found is filed when it finds something (a beat later), every two
 *   minutes, when the city pauses and when the page goes away (game3d/session/roam.ts). Near
 *   the end of an outing's log (MAX_TICKS) it files and the next outing carries on from where
 *   the hero stood.
 * - Sim events become scene effects (the web's, and the city's finds through the scene
 *   handle), sound, toasts and screen-reader lines.
 * - `?autopilot=1` (development) hands the input to game-core's roam bot playing its tour;
 *   `?debug=1` shows the renderer's numbers. Either exposes `window.__wgpCity` for headless checks.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_TICKS } from "@wgp/game-core/sim3d/constants";
import { FOLKS, RELAY_NAMES, TASKS, VIEW_NAMES, type TaskId } from "@wgp/game-core/city";
import { newRoamBot, roamBotFrame, roamTour, roamWorld } from "@wgp/game-core/sim3d/roam";
import type { CastId } from "@wgp/game-core/cast";

import type { SuitColors } from "@/components/cast";
import type { LoopEvent3D } from "@/game3d/session";

import { playSfx, setAmbience, setAudioPaused, stopMusic } from "@/audio/player";
import { STICK_DEAD_ZONE, STICK_RADIUS, stickKnob, viewFromPose, type StickVisual } from "@/game3d/input";
import { attachRoamControls, RoamLatch, type RoamControls } from "@/game3d/input/roam";
import { FrameTap } from "@/game3d/nav/tap";
import { detectTier, QUALITY_PRESETS, type QualityTier } from "@/game3d/scene/quality";
import type { SceneHandle, SceneStats } from "@/game3d/scene/Scene";
import { sceneEffects } from "@/game3d/session/effects";
import { fileOuting, nextSession, type RoamSession } from "@/game3d/session/roam";
import { RoamLoop, type RoamLoopEvent } from "@/game3d/session/roam-loop";
import { useCoarsePointer, useReducedMotion } from "@/sim/ui/hooks";

import { initialSettings, rememberSettings, SettingsPanel, type GraphicsChoice, type PlaySettings } from "../patrol/settings";
import { Loading } from "../patrol/status";
import { ActPrompt, CornerButtons, FirstHint, MoveButtons, pageToast, SpeechBubble, TaskTracker, Toasts, useRoamHud, type Toast } from "./hud";
import { RoamMap } from "./map";
import { RoamPause } from "./pause";

const Stage = dynamic(() => import("./stage"), { ssr: false, loading: () => <Loading label="Heading into the city…" /> });

declare global {
  interface Window {
    __wgpCity?: Record<string, unknown>;
  }
}

const CITY_CSS = `
html:has([data-city]), html:has([data-city]) body { overscroll-behavior: none; overflow: hidden; }
[data-city], [data-city] * { -webkit-tap-highlight-color: transparent; }
`;

/** The allies on their roofs (their bodies come with the city's zones). */
const CAST: CastId[] = ["aunt-mainnet", "uncle-gen", "mary-jpeg", "bearson"];
/** File a beat after a find, and at least this often while playing. */
const FILE_AFTER_FIND_MS = 1200;
const FILE_EVERY_MS = 120_000;
/** Past this many ticks the outing files and the next one starts (on the next standing moment). */
const ROLL_AT = MAX_TICKS - 60 * 45;
/** "the crane’s apex" → "The crane’s apex". */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function CitySurface({ session: first, colors, autopilot, debug }: { session: RoamSession; colors: SuitColors; autopilot: boolean; debug: boolean }) {
  const session = useRef(first);
  const [loop] = useState(() => new RoamLoop(first.run));
  const [latch] = useState(() => new RoamLatch());
  const [tap] = useState(() => new FrameTap());
  const hud = useRoamHud(loop.hud);
  const handle = useRef<SceneHandle | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const stickRing = useRef<HTMLDivElement>(null);
  const stats = useRef<HTMLPreElement>(null);
  const controls = useRef<RoamControls | null>(null);
  const touch = useCoarsePointer();
  const reducedMotion = useReducedMotion();
  const [settings, setSettings] = useState<PlaySettings>(initialSettings);
  const [paused, setPaused] = useState(false);
  const [map, setMap] = useState<"play" | "pause" | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [announce, setAnnounce] = useState("");
  const [filing, setFiling] = useState<string | null>(null);
  const [sprintToggle, setSprintToggle] = useState(false);
  /** roam-3: when the last relay hold began, and when its let-go was last explained (ms). */
  const holdFrom = useRef(0);
  const resetToast = useRef(-Infinity);
  /** roam-3: how far the relay being held is unplugged (0–1), read every frame by the HUD's rings. */
  const holdProgress = useCallback(() => loop.view.roam?.relay?.progress ?? 0, [loop]);
  const gate = useRef({ paused, map });
  useEffect(() => {
    gate.current = { paused, map };
    if (paused || map) controls.current?.release();
  }, [paused, map]);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = performance.now() + Math.random();
    setToasts((list) => [...list.slice(-4), { ...t, id }]);
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 5200);
  }, []);

  /* ---------------------------------------------------------------- filing */

  const fileTimer = useRef<number | null>(null);
  const fileNow = useCallback(
    async (opts: { keepalive?: boolean } = {}) => {
      const s = session.current;
      const res = await fileOuting(s, opts);
      if (res.kind === "filed") {
        const g = res.gains;
        if (g.xp > 0) toast({ tone: "xp", title: `+${g.xp} XP`, body: res.verified ? "Filed with the server." : "Saved in this browser. Sign in to keep it everywhere." });
        setFiling(res.verified ? "Filed with the server: what you found is kept." : "Saved in this browser.");
      } else if (res.kind === "failed") setFiling(`${res.message} It’ll try again.`);
      else if (res.kind === "stale") setFiling("This city moved on in another tab. Reload to pick up from there.");
      else if (res.kind === "old-rules") {
        // Played under older rules: nothing of it filed, the record keeps everything it had.
        if (res.fresh && res.record && s === session.current) {
          const next = nextSession(s, res.record);
          session.current = next;
          loop.replace(next.run);
          handle.current?.cut();
          toast({ tone: "info", title: "A fresh outing", body: "The city’s rules changed. Everything you’d filed is kept." });
          setFiling("A fresh outing from where the city stands.");
        } else setFiling("The city’s been updated. Reload to carry on; everything you’ve filed is kept.");
      }
      return res;
    },
    [toast, loop],
  );
  const fileSoon = useCallback(() => {
    if (fileTimer.current !== null) return;
    fileTimer.current = window.setTimeout(() => {
      fileTimer.current = null;
      void fileNow();
    }, FILE_AFTER_FIND_MS);
  }, [fileNow]);

  /* ---------------------------------------------------------------- the loop */

  useEffect(() => {
    let mem = newRoamBot(roamTour(roamWorld()));
    loop.setSource(autopilot ? (run) => roamBotFrame(run.sim, mem) : () => latch.take(viewFromPose(handle.current?.pose()), performance.now() / 1000));
    const effects = sceneEffects(() => handle.current);
    const w = roamWorld();
    const onEvent = (ev: RoamLoopEvent) => {
      if (!ev.type.startsWith("roam-") && ev.type !== "status") effects(ev as LoopEvent3D);
      handle.current?.roam?.(ev);
      switch (ev.type) {
        case "thwip":
          playSfx("thwip", { volume: 0.6 });
          break;
        case "land":
          if (ev.speed > 900) playSfx("street-thud", { volume: 0.4 });
          break;
        case "roam-talk": {
          const f = FOLKS[w.folks[ev.folk].key];
          playSfx("ui-tap", { volume: 0.6 });
          if (f) setAnnounce(`${f.name}: ${f.lines[ev.line]?.replace("{left}", "")}`);
          break;
        }
        case "roam-task":
          if (ev.done) {
            playSfx("level-up", { volume: 0.7 });
            toast({ tone: "task", title: `Task done: ${TASKS[ev.task as TaskId].title}`, body: TASKS[ev.task as TaskId].blurb });
            setAnnounce(`Task done: ${TASKS[ev.task as TaskId].title}.`);
          } else if (ev.stage === 1) {
            toast({ tone: "info", title: `New task: ${TASKS[ev.task as TaskId].title}`, body: TASKS[ev.task as TaskId].blurb });
            setAnnounce(`New task: ${TASKS[ev.task as TaskId].blurb}`);
          }
          fileSoon();
          break;
        case "roam-item":
          playSfx("loot", { volume: 0.6 });
          if (ev.task === "crosschain") {
            // roam-3: a relay unplugged.
            const where = sentence(RELAY_NAMES[w.relays[ev.item].key]);
            toast({ tone: "info", title: `Relay ${ev.got} of ${ev.of} unplugged`, body: ev.got < ev.of ? `${where} has gone dark.` : `${where} has gone dark. Tell Uncle Gen.` });
            setAnnounce(`Relay ${ev.got} of ${ev.of} unplugged: ${where}.`);
          } else {
            toast({ tone: "info", title: ev.task === "pixels" ? `Pixel ${ev.got} of ${ev.of}` : `Photo ${ev.got} of ${ev.of}`, body: ev.task === "pixels" ? "Mary’s a little less lossy." : "Bearson will want that one." });
            setAnnounce(ev.task === "pixels" ? `Pixel ${ev.got} of ${ev.of}.` : `Photo ${ev.got} of ${ev.of}.`);
          }
          fileSoon();
          break;
        case "roam-relay":
          // roam-3: holding interact on one of Doc's relays.
          if (ev.state === "hold") {
            holdFrom.current = performance.now();
            playSfx("chain-sweep", { volume: 0.35 });
            setAnnounce("Unplugging. Keep holding.");
          } else if (ev.state === "spark") playSfx("pow", { volume: 0.4, rate: 1.3 });
          else if (ev.state === "unplugged") playSfx("villain-hit", { volume: 0.6 });
          else if (ev.state === "reset") {
            setAnnounce("Let go too soon. The relay’s live again.");
            // Once it's been fought a while, say why (at most every few seconds).
            const now = performance.now();
            if (now - holdFrom.current > 400 && now - resetToast.current > 8000) {
              resetToast.current = now;
              toast({ tone: "info", title: "It’s live again", body: "Hold until the ring fills. It sparks; you don’t let go." });
            }
          }
          break;
        case "roam-page":
          playSfx("newspaper", { volume: 0.7 });
          toast(pageToast(ev.page, ev.got, ev.of));
          setAnnounce(`Daily Rug page ${ev.got} of ${ev.of}.`);
          fileSoon();
          break;
        case "roam-sync":
          playSfx("release-perfect", { volume: 0.7 });
          toast({ tone: "sync", title: `Synced: ${VIEW_NAMES[w.views[ev.view].district]}`, body: "Its district’s pages are on the map now." });
          setAnnounce(`Synced the ${VIEW_NAMES[w.views[ev.view].district]}.`);
          fileSoon();
          break;
        case "roam-bot":
          if (ev.state === "caught") {
            playSfx("pow", { volume: 0.7 });
            setAnnounce("Caught the pickpocket bot. Take the wallet back to Dev.");
          } else setAnnounce("The pickpocket bot is on the roofs. Catch it.");
          break;
        case "roam-splash":
          playSfx("street-thud", { volume: 0.5 });
          break;
        case "roam-car-hit":
          // roam-2: knocked down by a car (the scene bursts and shakes; he gets up on his own).
          playSfx("pow", { volume: 0.55 + 0.35 * Math.min(1, ev.speed / 330) });
          playSfx("street-thud", { volume: 0.4 });
          setAnnounce("Hit by a car. Getting up.");
          break;
        case "teleport":
          handle.current?.cut();
          break;
      }
    };
    const off = loop.bus.on(onEvent);
    loop.start();
    setAmbience("city-night", { fade: 2 });
    const every = window.setInterval(() => void fileNow(), FILE_EVERY_MS);
    // Near the end of an outing's log: file it and carry on in the next, standing where it ended.
    const roll = window.setInterval(() => {
      const s = session.current;
      const run = s.run;
      if (run.codes.length < ROLL_AT) return;
      if (run.sim.roam!.body.move !== "ground" && run.codes.length < MAX_TICKS - 60) return;
      void fileNow({}).then((res) => {
        if (res.kind !== "filed" && res.kind !== "idle") return;
        const record = res.kind === "filed" ? res.record : null;
        if (!record) return;
        const next = nextSession(s, record);
        session.current = next;
        mem = newRoamBot([]);
        loop.replace(next.run);
      });
    }, 1000);
    const onHide = () => void fileNow({ keepalive: true });
    window.addEventListener("pagehide", onHide);

    if (debug || autopilot) {
      window.__wgpCity = {
        loop,
        latch,
        session: () => session.current,
        handle: () => handle.current,
        file: () => fileNow(),
        pause: (p: boolean) => loop.setPaused(p),
        world: w,
        peek: () => {
          const s = session.current.run.sim;
          const r = s.roam!;
          return {
            status: loop.status,
            tick: s.tick,
            move: r.body.move,
            x: Math.round(s.hero.x),
            y: Math.round(s.hero.y),
            z: Math.round(s.hero.z),
            vx: Math.round(s.hero.vx),
            vy: Math.round(s.hero.vy),
            vz: Math.round(s.hero.vz),
            fx: s.hero.fx,
            fz: s.hero.fz,
            rope: !!s.hero.rope,
            sprint: r.body.sprintT > 0,
            stage: [...r.progress.stage],
            items: [...r.progress.items],
            pages: r.progress.pages,
            views: r.progress.views,
            chat: r.chat,
            act: loop.view.roam?.act ?? null,
            bot: { state: r.bot.state, x: Math.round(r.bot.x), y: Math.round(r.bot.y), z: Math.round(r.bot.z) },
            hold: { ...r.hold },
            relay: loop.view.roam?.relay ?? null,
            marks: loop.view.roam?.marks?.map((m) => ({ kind: m.kind, done: m.done, next: m.next })) ?? [],
            input: s.input,
            pose: handle.current?.pose() ?? null,
          };
        },
      };
    }
    return () => {
      off();
      window.clearInterval(every);
      window.clearInterval(roll);
      window.removeEventListener("pagehide", onHide);
      if (fileTimer.current !== null) window.clearTimeout(fileTimer.current);
      void fileNow({ keepalive: true });
      stopMusic();
      setAmbience(null);
      setAudioPaused(false);
      if (debug || autopilot) delete window.__wgpCity;
    };
  }, [loop, latch, autopilot, debug, fileNow, fileSoon, toast]);

  /* ---------------------------------------------------------------- pause and the map */

  const togglePause = useCallback(
    (next?: boolean) => {
      const value = next ?? loop.status !== "paused";
      loop.setPaused(value);
      setPaused(loop.status === "paused");
      setAudioPaused(loop.status === "paused");
      if (value) void fileNow();
    },
    [loop, fileNow],
  );
  const openMap = useCallback(
    (from: "play" | "pause") => {
      if (from === "play") loop.setPaused(true);
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
    if (g.map) closeMap();
    else openMap(g.paused ? "pause" : "play");
  }, [openMap, closeMap]);

  /* ---------------------------------------------------------------- controls */

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
    const c = attachRoamControls({
      latch,
      surface: el,
      orbit: (y, p, holding) => handle.current?.orbit(y, p, holding),
      onPause: () => {
        if (gate.current.map) closeMap();
        else togglePause();
      },
      onMap: toggleMap,
      enabled: () => !autopilot && !gate.current.paused && !gate.current.map && loop.status === "live",
      onStick,
    });
    controls.current = c;
    return () => {
      c.detach();
      controls.current = null;
    };
  }, [latch, loop, autopilot, togglePause, closeMap, toggleMap]);

  // A hidden tab or a lost focus pauses (not the autopilot).
  useEffect(() => {
    const onHide = () => {
      controls.current?.release();
      if (!autopilot) togglePause(true);
    };
    const onVis = () => {
      if (document.hidden) onHide();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onHide);
    };
  }, [togglePause, autopilot]);

  // The touch sprint toggle: on until pressed again (or the thumb leaves the stick a while).
  const setSprint = useCallback(
    (on: boolean) => {
      latch.setSprint("toggle", on);
      setSprintToggle(on);
    },
    [latch],
  );
  useEffect(() => {
    if (!sprintToggle) return;
    const t = window.setInterval(() => {
      if (hud && hud.move === "ground" && session.current.run.sim.input.mag === 0) setSprint(false);
    }, 1500);
    return () => window.clearInterval(t);
  }, [sprintToggle, hud, setSprint]);

  /* ---------------------------------------------------------------- settings */

  const onStats = useCallback((s: SceneStats) => {
    (window as Window & { __wgpScene?: SceneStats }).__wgpScene = s;
    const el = stats.current;
    if (!el) return;
    el.textContent = [`tier      ${s.tier}`, `fps       ${s.fps.toFixed(0)}`, `calls     ${s.calls}`, `triangles ${s.triangles.toLocaleString("en-US")}`, `cast ms   ${s.castMs.toFixed(2)}`].join("\n");
  }, []);
  const onTierSuggest = useCallback((t: QualityTier) => setSettings((s) => (s.adaptive ? { ...s, tier: t } : s)), []);
  const pickTier = (choice: GraphicsChoice) => {
    if (choice === "auto") {
      rememberSettings({ tier: null });
      setSettings((s) => ({ ...s, tier: detectTier(), adaptive: true }));
      return;
    }
    rememberSettings({ tier: choice });
    setSettings((s) => ({ ...s, tier: choice, adaptive: false }));
  };
  const setSteady = (steady: boolean) => {
    rememberSettings({ steady });
    setSettings((s) => ({ ...s, steady }));
  };

  const modal = paused || !!map;
  const still = settings.steady || reducedMotion;
  const city = first.run.sim.city;
  const heroSuit = colors;

  return (
    <div data-city className="absolute inset-0 touch-none">
      <style href="wgp-city" precedence="medium">
        {CITY_CSS}
      </style>
      <div className="absolute inset-0 select-none [-webkit-touch-callout:none]" inert={modal} onContextMenu={(e) => e.preventDefault()}>
        <div
          ref={surface}
          className="absolute inset-0 touch-none select-none"
          role="application"
          aria-label={
            touch
              ? "The city. Drag on the left to run; hold the right side to swing; the buttons by your right thumb jump, zip, talk and sprint."
              : "The city. WASD runs, Shift sprints, Space jumps, F or the mouse swings, Q zips, E talks, Escape pauses."
          }
        >
          <Stage
            loop={loop}
            city={city}
            handle={handle}
            quality={QUALITY_PRESETS[settings.tier]}
            heroColors={heroSuit}
            cast={CAST}
            reducedMotion={settings.steady}
            onStats={debug ? onStats : undefined}
            onTierSuggest={settings.adaptive ? onTierSuggest : undefined}
            paused={modal}
            tap={tap}
          />
          <div ref={stickRing} aria-hidden data-active="false" className="pointer-events-none absolute left-0 top-0 opacity-0 will-change-transform data-[active=true]:opacity-100 motion-safe:transition-[opacity] motion-safe:duration-150">
            <span className="absolute block rounded-full border-[2.5px] border-dashed border-game-paper/80 bg-game-ink/25" style={{ left: -STICK_RADIUS, top: -STICK_RADIUS, width: 2 * STICK_RADIUS, height: 2 * STICK_RADIUS }} />
            <span className="absolute block rounded-full border-2 border-game-paper bg-game-ink/50" style={{ left: -STICK_DEAD_ZONE, top: -STICK_DEAD_ZONE, width: 2 * STICK_DEAD_ZONE, height: 2 * STICK_DEAD_ZONE }} />
            <span data-knob className="absolute -left-[26px] -top-[26px] block size-[52px] rounded-full border-[2.5px] border-game-ink bg-game-paper shadow-[var(--game-shadow-sm)] will-change-transform" />
          </div>
        </div>
        {debug ? <pre ref={stats} aria-live="off" className="pointer-events-none absolute right-3 top-[52%] rounded-[12px] border-2 border-game-ink bg-game-paper px-3 py-2 font-mono text-xs leading-5 text-game-ink opacity-90" /> : null}
        {hud ? (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-3 pt-[max(12px,env(safe-area-inset-top))] sm:px-4">
              <TaskTracker hud={hud} />
              <div className="flex flex-col items-end gap-3">
                <CornerButtons onMap={() => openMap("play")} onPause={() => togglePause(true)} />
                <Toasts toasts={toasts} />
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 pb-[max(16px,env(safe-area-inset-bottom))]">
              <FirstHint touch={touch} hud={hud} />
              <SpeechBubble hud={hud} />
              <ActPrompt hud={hud} touch={touch} progress={holdProgress} />
            </div>
            {touch ? (
              <div className="pointer-events-none absolute bottom-0 right-0 pb-[max(16px,env(safe-area-inset-bottom))] pr-[max(16px,env(safe-area-inset-right))]">
                <MoveButtons
                  hud={hud}
                  onJump={() => latch.push(1)}
                  onZip={() => latch.push(2)}
                  onAct={(down) => latch.setAct("touch", down)}
                  holdProgress={holdProgress}
                  onDrop={() => latch.push(5)}
                  onSprint={setSprint}
                  sprintOn={sprintToggle}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {paused && !map ? (
        <RoamPause onResume={() => togglePause(false)} onMap={() => openMap("pause")} touch={touch} filing={filing} settings={<SettingsPanel settings={settings} onTier={pickTier} onSteady={setSteady} />} />
      ) : null}
      {map ? <RoamMap city={city} frame={loop.view} hero={heroSuit} onClose={closeMap} still={still} touch={touch} /> : null}
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
